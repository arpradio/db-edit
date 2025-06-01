-- Additional helper functions for the web editor
-- Run this after your main database schema

-- Create optimized indexes for data quality queries
CREATE INDEX IF NOT EXISTS idx_song_artists_song_coverage 
ON metadata.song_artists(song_id);

CREATE INDEX IF NOT EXISTS idx_song_genres_song_coverage 
ON metadata.song_genres(song_id);

CREATE INDEX IF NOT EXISTS idx_audio_files_song_coverage 
ON metadata.audio_files(song_id);

CREATE INDEX IF NOT EXISTS idx_song_artists_artist_coverage 
ON metadata.song_artists(artist_id);

CREATE INDEX IF NOT EXISTS idx_song_genres_genre_coverage 
ON metadata.song_genres(genre_id);

-- Index for songs validation status queries
CREATE INDEX IF NOT EXISTS idx_songs_validation_status 
ON metadata.songs(validation_status);

-- Index for songs duration queries
CREATE INDEX IF NOT EXISTS idx_songs_duration 
ON metadata.songs(duration) WHERE duration IS NULL OR duration = '';

-- Create indexes for better search performance
CREATE INDEX IF NOT EXISTS idx_songs_title_search 
ON metadata.songs USING gin(to_tsvector('english', title));

CREATE INDEX IF NOT EXISTS idx_artists_name_search 
ON metadata.artists USING gin(to_tsvector('english', name));

CREATE INDEX IF NOT EXISTS idx_genres_name_search 
ON metadata.genres USING gin(to_tsvector('english', name));

-- Function to get song statistics (simplified for performance)
CREATE OR REPLACE FUNCTION get_song_stats()
RETURNS TABLE(
    total_songs bigint,
    total_artists bigint,
    total_genres bigint,
    verified_songs bigint,
    unverified_songs bigint,
    pending_songs bigint
) 
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT count(*) FROM metadata.songs),
        (SELECT count(*) FROM metadata.artists),
        (SELECT count(*) FROM metadata.genres),
        (SELECT count(*) FROM metadata.songs WHERE validation_status = 'verified'),
        (SELECT count(*) FROM metadata.songs WHERE validation_status = 'unverified'),
        (SELECT count(*) FROM metadata.songs WHERE validation_status = 'pending');
END;
$function$;

-- Function to get data quality counts (optimized)
CREATE OR REPLACE FUNCTION get_quality_counts()
RETURNS TABLE(
    no_artists bigint,
    no_genres bigint,
    no_audio bigint,
    no_duration bigint,
    orphan_artists bigint,
    orphan_genres bigint
) 
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT count(*) FROM metadata.songs s 
         LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id 
         WHERE sa.song_id IS NULL),
        (SELECT count(*) FROM metadata.songs s 
         LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id 
         WHERE sg.song_id IS NULL),
        (SELECT count(*) FROM metadata.songs s 
         LEFT JOIN metadata.audio_files af ON s.id = af.song_id 
         WHERE af.song_id IS NULL),
        (SELECT count(*) FROM metadata.songs WHERE duration IS NULL OR trim(duration) = ''),
        (SELECT count(*) FROM metadata.artists a 
         LEFT JOIN metadata.song_artists sa ON a.id = sa.artist_id 
         WHERE sa.artist_id IS NULL),
        (SELECT count(*) FROM metadata.genres g 
         LEFT JOIN metadata.song_genres sg ON g.id = sg.genre_id 
         WHERE sg.genre_id IS NULL);
END;
$function$;

-- Test function to verify database connectivity and basic queries
CREATE OR REPLACE FUNCTION test_database_health()
RETURNS TABLE(
    test_name text,
    result text,
    count_value bigint
) 
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT 'songs_table'::text, 'count'::text, count(*) FROM metadata.songs
    UNION ALL
    SELECT 'artists_table'::text, 'count'::text, count(*) FROM metadata.artists
    UNION ALL
    SELECT 'genres_table'::text, 'count'::text, count(*) FROM metadata.genres
    UNION ALL
    SELECT 'song_artists_table'::text, 'count'::text, count(*) FROM metadata.song_artists
    UNION ALL
    SELECT 'song_genres_table'::text, 'count'::text, count(*) FROM metadata.song_genres
    UNION ALL
    SELECT 'audio_files_table'::text, 'count'::text, count(*) FROM metadata.audio_files;
END;
$function$;

-- Simple function to find songs without artists (for testing)
CREATE OR REPLACE FUNCTION find_songs_without_artists(limit_count integer DEFAULT 10)
RETURNS TABLE(
    song_id integer,
    song_title text
) 
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT s.id, s.title
    FROM metadata.songs s
    LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
    WHERE sa.song_id IS NULL
    ORDER BY s.title
    LIMIT limit_count;
END;
$function$;

-- Simple function to find songs without genres (for testing)  
CREATE OR REPLACE FUNCTION find_songs_without_genres(limit_count integer DEFAULT 10)
RETURNS TABLE(
    song_id integer,
    song_title text
) 
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT s.id, s.title
    FROM metadata.songs s
    LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
    WHERE sg.song_id IS NULL
    ORDER BY s.title
    LIMIT limit_count;
END;
$function$;

-- Function to find duplicate artists (for cleanup)
CREATE OR REPLACE FUNCTION find_duplicate_artists()
RETURNS TABLE(
    name text,
    count bigint,
    ids integer[]
) 
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT 
        a.name,
        count(*) as count,
        array_agg(a.id) as ids
    FROM metadata.artists a
    GROUP BY LOWER(trim(a.name))
    HAVING count(*) > 1
    ORDER BY count DESC;
END;
$function$;

-- Function to merge duplicate artists
CREATE OR REPLACE FUNCTION merge_artists(
    keep_artist_id integer,
    remove_artist_ids integer[]
) 
RETURNS text 
LANGUAGE plpgsql
AS $function$
DECLARE
    remove_id integer;
    affected_rows integer := 0;
    current_affected integer;
BEGIN
    FOREACH remove_id IN ARRAY remove_artist_ids
    LOOP
        IF remove_id != keep_artist_id THEN
            -- Update song_artists to point to the kept artist
            UPDATE metadata.song_artists 
            SET artist_id = keep_artist_id 
            WHERE artist_id = remove_id
            AND NOT EXISTS (
                SELECT 1 FROM metadata.song_artists 
                WHERE song_id = metadata.song_artists.song_id 
                AND artist_id = keep_artist_id 
                AND role = metadata.song_artists.role
            );
            
            GET DIAGNOSTICS current_affected = ROW_COUNT;
            affected_rows := affected_rows + current_affected;
            
            -- Delete the duplicate artist
            DELETE FROM metadata.artists WHERE id = remove_id;
        END IF;
    END LOOP;
    
    RETURN format('Merged %s artists, updated %s song relationships', 
                  array_length(remove_artist_ids, 1), affected_rows);
END;
$function$;

-- Function to search songs with full-text search
CREATE OR REPLACE FUNCTION search_songs_fulltext(search_term text)
RETURNS TABLE(
    id integer,
    title text,
    duration text,
    validation_status character varying(20),
    artists text[],
    genres text[],
    rank real
) 
LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT DISTINCT 
        s.id,
        s.title,
        s.duration,
        s.validation_status,
        array_agg(DISTINCT a.name) FILTER (WHERE a.name IS NOT NULL) as artists,
        array_agg(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL) as genres,
        greatest(
            ts_rank(to_tsvector('english', s.title), plainto_tsquery('english', search_term)),
            coalesce(max(ts_rank(to_tsvector('english', a.name), plainto_tsquery('english', search_term))), 0),
            coalesce(max(ts_rank(to_tsvector('english', g.name), plainto_tsquery('english', search_term))), 0)
        ) as rank
    FROM metadata.songs s
    LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
    LEFT JOIN metadata.artists a ON sa.artist_id = a.id
    LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
    LEFT JOIN metadata.genres g ON sg.genre_id = g.id
    WHERE 
        to_tsvector('english', s.title) @@ plainto_tsquery('english', search_term)
        OR to_tsvector('english', a.name) @@ plainto_tsquery('english', search_term)
        OR to_tsvector('english', g.name) @@ plainto_tsquery('english', search_term)
        OR s.title ILIKE '%' || search_term || '%'
        OR a.name ILIKE '%' || search_term || '%'
        OR g.name ILIKE '%' || search_term || '%'
    GROUP BY s.id, s.title, s.duration, s.validation_status
    ORDER BY rank DESC, s.title
    LIMIT 50;
END;
$function$;