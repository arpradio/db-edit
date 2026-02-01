-- Migration to ensure all references use metadata.assets_songs
-- This migration recreates functions with the correct table references
-- The assets_songs table is in the metadata schema per arpradio-schemas.sql

-- Drop and recreate get_quality_counts function with correct table references
DROP FUNCTION IF EXISTS get_quality_counts();

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

-- Drop and recreate find_songs_without_images function with correct table references
DROP FUNCTION IF EXISTS find_songs_without_images(INTEGER);

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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_quality_counts() TO postgres;
GRANT EXECUTE ON FUNCTION find_songs_without_images(INTEGER) TO postgres;
