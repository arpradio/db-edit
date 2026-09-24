const express = require('express');
const { pool } = require('../config/database');
const { asyncHandler } = require('../lib/dbHelpers');

const router = express.Router();

router.get('/counts', asyncHandler(async (req, res) => {
    const [baseResult, contributorsResult] = await Promise.all([
        pool.query('SELECT * FROM get_quality_counts()'),
        pool.query(`
            SELECT COUNT(*)::BIGINT as no_contributors
            FROM metadata.songs s
            LEFT JOIN metadata.song_contributors sc ON s.id = sc.song_id
            WHERE sc.song_id IS NULL
        `)
    ]);
    res.json({ ...baseResult.rows[0], no_contributors: parseInt(contributorsResult.rows[0].no_contributors, 10) });
}));

router.get('/issues/:type', asyncHandler(async (req, res) => {
    const { type } = req.params;
    let query;

    const queries = {
        'no-artists': 'SELECT * FROM find_songs_without_artists(100)',
        'no-genres': 'SELECT * FROM find_songs_without_genres(100)',
        'no-audio': `
            SELECT s.id as song_id, s.title as song_title
            FROM metadata.songs s
            LEFT JOIN metadata.audio_files af ON s.id = af.song_id
            WHERE af.song_id IS NULL
            ORDER BY s.title LIMIT 100
        `,
        'no-duration': `
            SELECT s.id as song_id, s.title as song_title
            FROM metadata.songs s
            WHERE s.duration IS NULL OR trim(s.duration) = ''
            ORDER BY s.title LIMIT 100
        `,
        'no-isrc': `
            SELECT s.id as song_id, s.title as song_title
            FROM metadata.songs s
            WHERE s.isrc IS NULL OR trim(s.isrc) = ''
            ORDER BY s.title LIMIT 100
        `,
        'no-iswc': `
            SELECT s.id as song_id, s.title as song_title
            FROM metadata.songs s
            WHERE s.iswc IS NULL OR trim(s.iswc) = ''
            ORDER BY s.title LIMIT 100
        `,
        'no-tokens': `
            SELECT s.id as song_id, s.title as song_title
            FROM metadata.songs s
            LEFT JOIN metadata.assets_songs asongs ON s.id = asongs.song_id
            WHERE asongs.song_id IS NULL
            ORDER BY s.title LIMIT 100
        `,
        'no-contributors': `
            SELECT s.id as song_id, s.title as song_title
            FROM metadata.songs s
            LEFT JOIN metadata.song_contributors sc ON s.id = sc.song_id
            WHERE sc.song_id IS NULL
            ORDER BY s.title LIMIT 100
        `,
        'no-copyright': 'SELECT * FROM find_songs_without_copyright(100)',
        'no-images': `
            SELECT a.id as asset_id, a.policy_id, a.asset_name
            FROM cip60.assets a
            LEFT JOIN metadata.asset_images ai ON a.id = ai.asset_id
            WHERE ai.asset_id IS NULL
            ORDER BY a.asset_name LIMIT 100
        `,
        'orphan-artists': `
            SELECT a.id, a.name
            FROM metadata.artists a
            LEFT JOIN metadata.song_artists sa ON a.id = sa.artist_id
            WHERE sa.artist_id IS NULL
            ORDER BY a.name LIMIT 100
        `,
        'orphan-genres': `
            SELECT g.id, g.name
            FROM metadata.genres g
            LEFT JOIN metadata.song_genres sg ON g.id = sg.genre_id
            WHERE sg.genre_id IS NULL
            ORDER BY g.name LIMIT 100
        `,
        'orphan-contributors': `
            SELECT c.id, c.name
            FROM metadata.contributor c
            LEFT JOIN metadata.song_contributors sc ON c.id = sc.contributor_id
            WHERE sc.contributor_id IS NULL
            ORDER BY c.name LIMIT 100
        `,
        'orphan-tokens': `
            SELECT mt.id, mt.name, mt.policy_id, mt.asset_name
            FROM cip60.music_tokens mt
            LEFT JOIN metadata.assets_songs aso ON mt.id = aso.asset_id
            WHERE aso.asset_id IS NULL
            ORDER BY mt.name, mt.asset_name
            LIMIT 100
        `,
        'orphan-images': 'SELECT * FROM find_orphaned_images(100)',
        'unprocessed-tokens': `
            SELECT mt.id, mt.name, mt.policy_id, mt.asset_name
            FROM cip60.music_tokens mt
            LEFT JOIN cip60.processing_status ps ON mt.id = ps.asset_id
            WHERE ps.asset_id IS NULL
            ORDER BY mt.id DESC
            LIMIT 100
        `,
        'failed-tokens': `
            SELECT mt.id, mt.name, mt.policy_id, mt.asset_name, ps.status
            FROM cip60.music_tokens mt
            JOIN cip60.processing_status ps ON mt.id = ps.asset_id
            WHERE ps.status = 'failed' OR ps.has_valid_songs = false
            ORDER BY ps.processed_at DESC
            LIMIT 100
        `,
        'artists-no-isni': 'SELECT * FROM find_artists_without_isni(100)'
    };

    query = queries[type];
    if (!query) {
        return res.status(400).json({ error: 'Invalid issue type' });
    }

    try {
        const result = await pool.query(query);

        const normalizedRows = result.rows.map(row => {
            if (row.song_id && row.song_title) {
                return { id: row.song_id, title: row.song_title };
            }
            if (row.token_id && row.token_name) {
                return { id: row.token_id, name: row.token_name, policy_id: row.policy_id, asset_name: row.asset_name };
            }
            if (row.image_id && row.image_url) {
                return { id: row.image_id, name: row.image_url, image_type: row.image_type };
            }
            if (row.artist_id && row.artist_name) {
                return { id: row.artist_id, name: row.artist_name };
            }
            return row;
        });

        res.json(normalizedRows);
    } catch (error) {
        console.error('Query error for type:', type, error);
        res.status(500).json({ error: 'Database query failed: ' + error.message });
    }
}));

module.exports = router;
