-- Migration to add missing functions for db-edit application
-- This fixes compatibility issues between schemas.sql and the application code

-- Fix processed_at column type in cip60.processing_status
ALTER TABLE cip60.processing_status
ALTER COLUMN processed_at TYPE timestamp with time zone USING to_timestamp(processed_at);

-- Create get_quality_counts function
CREATE OR REPLACE FUNCTION get_quality_counts()
RETURNS TABLE(
    no_artists BIGINT,
    no_genres BIGINT,
    no_audio BIGINT,
    no_duration BIGINT,
    no_isrc BIGINT,
    no_iswc BIGINT,
    no_tokens BIGINT,
    no_copyright BIGINT,
    no_images BIGINT,
    orphan_artists BIGINT,
    orphan_genres BIGINT,
    orphan_contributors BIGINT,
    orphan_tokens BIGINT,
    orphan_images BIGINT,
    unprocessed_tokens BIGINT,
    failed_tokens BIGINT,
    artists_no_isni BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        -- Songs without artists
        (SELECT COUNT(*) FROM metadata.songs s
         LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
         WHERE sa.song_id IS NULL)::BIGINT,

        -- Songs without genres
        (SELECT COUNT(*) FROM metadata.songs s
         LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
         WHERE sg.song_id IS NULL)::BIGINT,

        -- Songs without audio files
        (SELECT COUNT(*) FROM metadata.songs s
         LEFT JOIN metadata.audio_files af ON s.id = af.song_id
         WHERE af.song_id IS NULL)::BIGINT,

        -- Songs without duration
        (SELECT COUNT(*) FROM metadata.songs WHERE duration IS NULL OR TRIM(duration) = '')::BIGINT,

        -- Songs without ISRC
        (SELECT COUNT(*) FROM metadata.songs WHERE isrc IS NULL OR TRIM(isrc) = '')::BIGINT,

        -- Songs without ISWC
        (SELECT COUNT(*) FROM metadata.songs WHERE iswc IS NULL OR TRIM(iswc) = '')::BIGINT,

        -- Songs without tokens
        (SELECT COUNT(*) FROM metadata.songs s
         LEFT JOIN metadata.assets_songs asongs ON s.id = asongs.song_id
         WHERE asongs.song_id IS NULL)::BIGINT,

        -- Songs without copyright
        (SELECT COUNT(*) FROM metadata.songs
         WHERE (copyright_master IS NULL OR TRIM(copyright_master) = '')
         AND (copyright_composition IS NULL OR TRIM(copyright_composition) = ''))::BIGINT,

        -- Songs without images
        (SELECT COUNT(DISTINCT s.id) FROM metadata.songs s
         LEFT JOIN metadata.assets_songs asongs ON s.id = asongs.song_id
         LEFT JOIN metadata.asset_images ai ON asongs.asset_id = ai.asset_id
         WHERE ai.asset_id IS NULL)::BIGINT,

        -- Orphaned artists
        (SELECT COUNT(*) FROM metadata.artists a
         LEFT JOIN metadata.song_artists sa ON a.id = sa.artist_id
         WHERE sa.artist_id IS NULL)::BIGINT,

        -- Orphaned genres
        (SELECT COUNT(*) FROM metadata.genres g
         LEFT JOIN metadata.song_genres sg ON g.id = sg.genre_id
         WHERE sg.genre_id IS NULL)::BIGINT,

        -- Orphaned contributors
        (SELECT COUNT(*) FROM metadata.contributor c
         LEFT JOIN metadata.song_contributors sc ON c.id = sc.contributor_id
         WHERE sc.contributor_id IS NULL)::BIGINT,

        -- Orphaned tokens
        (SELECT COUNT(*) FROM cip60.music_tokens mt
         LEFT JOIN metadata.assets_songs aso ON mt.id = aso.asset_id
         WHERE aso.asset_id IS NULL)::BIGINT,

        -- Orphaned images
        (SELECT COUNT(*) FROM metadata.images i
         LEFT JOIN metadata.asset_images ai ON i.id = ai.image_id
         WHERE ai.image_id IS NULL)::BIGINT,

        -- Unprocessed tokens
        (SELECT COUNT(*) FROM cip60.music_tokens mt
         LEFT JOIN cip60.processing_status ps ON mt.id = ps.asset_id
         WHERE ps.asset_id IS NULL)::BIGINT,

        -- Failed tokens
        (SELECT COUNT(*) FROM cip60.processing_status
         WHERE status = 'failed' OR has_valid_songs = false)::BIGINT,

        -- Artists without ISNI
        (SELECT COUNT(*) FROM metadata.artists
         WHERE isni IS NULL OR TRIM(isni) = '')::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- Create get_song_stats function
CREATE OR REPLACE FUNCTION get_song_stats()
RETURNS TABLE(
    total_songs BIGINT,
    total_artists BIGINT,
    total_genres BIGINT,
    verified_songs BIGINT,
    unverified_songs BIGINT,
    pending_songs BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*) FROM metadata.songs)::BIGINT,
        (SELECT COUNT(*) FROM metadata.artists)::BIGINT,
        (SELECT COUNT(*) FROM metadata.genres)::BIGINT,
        (SELECT COUNT(*) FROM metadata.songs WHERE validation_status = 'verified')::BIGINT,
        (SELECT COUNT(*) FROM metadata.songs WHERE validation_status = 'unverified')::BIGINT,
        (SELECT COUNT(*) FROM metadata.songs WHERE validation_status = 'pending')::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- Create find_songs_without_artists function
CREATE OR REPLACE FUNCTION find_songs_without_artists(result_limit INTEGER DEFAULT 100)
RETURNS TABLE(
    song_id INTEGER,
    song_title TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT s.id, s.title
    FROM metadata.songs s
    LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
    WHERE sa.song_id IS NULL
    ORDER BY s.title
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Create find_songs_without_genres function
CREATE OR REPLACE FUNCTION find_songs_without_genres(result_limit INTEGER DEFAULT 100)
RETURNS TABLE(
    song_id INTEGER,
    song_title TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT s.id, s.title
    FROM metadata.songs s
    LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
    WHERE sg.song_id IS NULL
    ORDER BY s.title
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Create find_songs_without_copyright function
CREATE OR REPLACE FUNCTION find_songs_without_copyright(result_limit INTEGER DEFAULT 100)
RETURNS TABLE(
    song_id INTEGER,
    song_title TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT s.id, s.title
    FROM metadata.songs s
    WHERE (s.copyright_master IS NULL OR TRIM(s.copyright_master) = '')
      AND (s.copyright_composition IS NULL OR TRIM(s.copyright_composition) = '')
    ORDER BY s.title
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Create find_songs_without_images function
CREATE OR REPLACE FUNCTION find_songs_without_images(result_limit INTEGER DEFAULT 100)
RETURNS TABLE(
    song_id INTEGER,
    song_title TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT s.id, s.title
    FROM metadata.songs s
    LEFT JOIN metadata.assets_songs asongs ON s.id = asongs.song_id
    LEFT JOIN metadata.asset_images ai ON asongs.asset_id = ai.asset_id
    WHERE ai.asset_id IS NULL
    ORDER BY s.title
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Create find_orphaned_images function
CREATE OR REPLACE FUNCTION find_orphaned_images(result_limit INTEGER DEFAULT 100)
RETURNS TABLE(
    image_id INTEGER,
    image_url TEXT,
    image_type VARCHAR(20)
) AS $$
BEGIN
    RETURN QUERY
    SELECT i.id, i.image_url, i.image_type
    FROM metadata.images i
    LEFT JOIN metadata.asset_images ai ON i.id = ai.image_id
    WHERE ai.image_id IS NULL
    ORDER BY i.id
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Create find_artists_without_isni function
CREATE OR REPLACE FUNCTION find_artists_without_isni(result_limit INTEGER DEFAULT 100)
RETURNS TABLE(
    artist_id INTEGER,
    artist_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT a.id, a.name
    FROM metadata.artists a
    WHERE a.isni IS NULL OR TRIM(a.isni) = ''
    ORDER BY a.name
    LIMIT result_limit;
END;
$$ LANGUAGE plpgsql;

-- Create test_database_health function
CREATE OR REPLACE FUNCTION test_database_health()
RETURNS TABLE(
    test_name TEXT,
    test_result TEXT,
    test_status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        'Database Connection'::TEXT,
        'Connected successfully'::TEXT,
        'PASS'::TEXT
    UNION ALL
    SELECT
        'Songs Table'::TEXT,
        'Found ' || COUNT(*)::TEXT || ' songs',
        CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'WARN' END
    FROM metadata.songs
    UNION ALL
    SELECT
        'Artists Table'::TEXT,
        'Found ' || COUNT(*)::TEXT || ' artists',
        CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'WARN' END
    FROM metadata.artists
    UNION ALL
    SELECT
        'Genres Table'::TEXT,
        'Found ' || COUNT(*)::TEXT || ' genres',
        CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'WARN' END
    FROM metadata.genres;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION get_quality_counts() TO postgres;
GRANT EXECUTE ON FUNCTION get_song_stats() TO postgres;
GRANT EXECUTE ON FUNCTION find_songs_without_artists(INTEGER) TO postgres;
GRANT EXECUTE ON FUNCTION find_songs_without_genres(INTEGER) TO postgres;
GRANT EXECUTE ON FUNCTION find_songs_without_copyright(INTEGER) TO postgres;
GRANT EXECUTE ON FUNCTION find_songs_without_images(INTEGER) TO postgres;
GRANT EXECUTE ON FUNCTION find_orphaned_images(INTEGER) TO postgres;
GRANT EXECUTE ON FUNCTION find_artists_without_isni(INTEGER) TO postgres;
GRANT EXECUTE ON FUNCTION test_database_health() TO postgres;
