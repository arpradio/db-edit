CREATE OR REPLACE VIEW app.song_full_details AS
SELECT 
    s.id,
    s.title,
    s.duration,
    s.is_explicit,
    s.is_ai_generated,
    string_agg(DISTINCT a.name, ', ' ORDER BY a.name) as artists,
    string_agg(DISTINCT g.name, ', ' ORDER BY g.name) as genres,
    s.validation_status,
    s.created_at,
    s.updated_at
FROM metadata.songs s
LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
LEFT JOIN metadata.artists a ON sa.artist_id = a.id
LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
LEFT JOIN metadata.genres g ON sg.genre_id = g.id
GROUP BY s.id, s.title, s.duration, s.is_explicit, s.is_ai_generated, 
         s.validation_status, s.created_at, s.updated_at;

CREATE OR REPLACE VIEW app.artist_song_roles AS
SELECT 
    sa.song_id,
    sa.artist_id,
    a.name as artist_name,
    s.title as song_title,
    sa.role,
    sa.created_at
FROM metadata.song_artists sa
JOIN metadata.artists a ON sa.artist_id = a.id
JOIN metadata.songs s ON sa.song_id = s.id;

CREATE OR REPLACE FUNCTION app.update_song_artist(
    p_song_id integer,
    p_old_artist_name text,
    p_new_artist_name text,
    p_role text DEFAULT 'primary'
) RETURNS void AS $$
DECLARE
    v_old_artist_id integer;
    v_new_artist_id integer;
BEGIN
    SELECT id INTO v_old_artist_id FROM metadata.artists WHERE name = p_old_artist_name;
    
    SELECT id INTO v_new_artist_id FROM metadata.artists WHERE name = p_new_artist_name;
    IF v_new_artist_id IS NULL THEN
        INSERT INTO metadata.artists (name) VALUES (p_new_artist_name) RETURNING id INTO v_new_artist_id;
    END IF;
    
    IF v_old_artist_id IS NOT NULL THEN
        UPDATE metadata.song_artists 
        SET artist_id = v_new_artist_id 
        WHERE song_id = p_song_id AND artist_id = v_old_artist_id AND role = p_role;
    ELSE
        INSERT INTO metadata.song_artists (song_id, artist_id, role) 
        VALUES (p_song_id, v_new_artist_id, p_role);
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION app.update_song_genres(
    p_song_id integer,
    p_genre_names text[]
) RETURNS void AS $$
DECLARE
    v_genre_name text;
    v_genre_id integer;
BEGIN
    DELETE FROM metadata.song_genres WHERE song_id = p_song_id;
    
    FOREACH v_genre_name IN ARRAY p_genre_names
    LOOP
        SELECT id INTO v_genre_id FROM metadata.genres WHERE name = v_genre_name;
        IF v_genre_id IS NULL THEN
            INSERT INTO metadata.genres (name) VALUES (v_genre_name) RETURNING id INTO v_genre_id;
        END IF;
        
        INSERT INTO metadata.song_genres (song_id, genre_id) VALUES (p_song_id, v_genre_id);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 1. Replace an artist for a song
CREATE OR REPLACE FUNCTION edit_song_artist(
    song_id_param integer,
    old_artist_name text,
    new_artist_name text
) RETURNS text AS $$
DECLARE
    old_artist_id integer;
    new_artist_id integer;
    affected_rows integer;
BEGIN
    -- Get old artist ID
    SELECT id INTO old_artist_id 
    FROM metadata.artists 
    WHERE name = old_artist_name;
    
    -- Get or create new artist
    SELECT id INTO new_artist_id 
    FROM metadata.artists 
    WHERE name = new_artist_name;
    
    IF new_artist_id IS NULL THEN
        INSERT INTO metadata.artists (name) 
        VALUES (new_artist_name) 
        RETURNING id INTO new_artist_id;
    END IF;
    
    -- Update the relationship
    UPDATE metadata.song_artists 
    SET artist_id = new_artist_id 
    WHERE song_id = song_id_param AND artist_id = old_artist_id;
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    
    RETURN format('Updated %s rows. Artist changed from "%s" to "%s" for song ID %s', 
                  affected_rows, old_artist_name, new_artist_name, song_id_param);
END;
$$ LANGUAGE plpgsql;

-- 2. Add an artist to a song
CREATE OR REPLACE FUNCTION add_song_artist(
    song_id_param integer,
    artist_name text,
    artist_role text DEFAULT 'primary'
) RETURNS text AS $$
DECLARE
    artist_id_val integer;
BEGIN
    -- Get or create artist
    SELECT id INTO artist_id_val 
    FROM metadata.artists 
    WHERE name = artist_name;
    
    IF artist_id_val IS NULL THEN
        INSERT INTO metadata.artists (name) 
        VALUES (artist_name) 
        RETURNING id INTO artist_id_val;
    END IF;
    
    -- Add the relationship
    INSERT INTO metadata.song_artists (song_id, artist_id, role) 
    VALUES (song_id_param, artist_id_val, artist_role)
    ON CONFLICT (song_id, artist_id, role) DO NOTHING;
    
    RETURN format('Added "%s" as %s artist for song ID %s', 
                  artist_name, artist_role, song_id_param);
END;
$$ LANGUAGE plpgsql;

-- 3. Remove an artist from a song
CREATE OR REPLACE FUNCTION remove_song_artist(
    song_id_param integer,
    artist_name text
) RETURNS text AS $$
DECLARE
    artist_id_val integer;
    affected_rows integer;
BEGIN
    SELECT id INTO artist_id_val 
    FROM metadata.artists 
    WHERE name = artist_name;
    
    DELETE FROM metadata.song_artists 
    WHERE song_id = song_id_param AND artist_id = artist_id_val;
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    
    RETURN format('Removed "%s" from song ID %s (%s relationships deleted)', 
                  artist_name, song_id_param, affected_rows);
END;
$$ LANGUAGE plpgsql;

-- 4. Update all genres for a song (replaces existing)
CREATE OR REPLACE FUNCTION update_song_genres(
    song_id_param integer,
    genre_names text[]
) RETURNS text AS $$
DECLARE
    genre_name text;
    genre_id_val integer;
    genre_count integer := 0;
BEGIN
    -- Remove all existing genres for this song
    DELETE FROM metadata.song_genres WHERE song_id = song_id_param;
    
    -- Add new genres
    FOREACH genre_name IN ARRAY genre_names
    LOOP
        -- Get or create genre
        SELECT id INTO genre_id_val 
        FROM metadata.genres 
        WHERE name = genre_name;
        
        IF genre_id_val IS NULL THEN
            INSERT INTO metadata.genres (name) 
            VALUES (genre_name) 
            RETURNING id INTO genre_id_val;
        END IF;
        
        -- Add the relationship
        INSERT INTO metadata.song_genres (song_id, genre_id) 
        VALUES (song_id_param, genre_id_val);
        
        genre_count := genre_count + 1;
    END LOOP;
    
    RETURN format('Updated genres for song ID %s: %s genres assigned', 
                  song_id_param, genre_count);
END;
$$ LANGUAGE plpgsql;

-- 5. View function to see current song relationships
CREATE OR REPLACE FUNCTION get_song_details(song_id_param integer)
RETURNS TABLE(
    song_title text,
    artists text,
    genres text,
    duration text,
    status text
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.title,
        string_agg(DISTINCT a.name || ' (' || sa.role || ')', ', ' ORDER BY a.name) as artists,
        string_agg(DISTINCT g.name, ', ' ORDER BY g.name) as genres,
        s.duration,
        s.validation_status
    FROM metadata.songs s
    LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
    LEFT JOIN metadata.artists a ON sa.artist_id = a.id
    LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
    LEFT JOIN metadata.genres g ON sg.genre_id = g.id
    WHERE s.id = song_id_param
    GROUP BY s.id, s.title, s.duration, s.validation_status;
END;
$$ LANGUAGE plpgsql;