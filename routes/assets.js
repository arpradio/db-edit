const express = require('express');
const { pool } = require('../config/database');
const { asyncHandler } = require('../lib/dbHelpers');

const router = express.Router();

router.get('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    const assetQuery = `
        SELECT
            mt.id,
            mt.policy_id,
            mt.asset_name,
            mt.name,
            mt.metadata,
            mt.data_label,
            cip60.asset_fingerprint(mt.policy_id::text, mt.asset_name::text) AS asset_fingerprint,
            (cip60.extract_metadata_fields(mt.metadata)).release_type AS release_type,
            (cip60.extract_metadata_fields(mt.metadata)).image_urls AS image_urls,
            json_agg(
                json_build_object(
                    'id', s.id,
                    'title', s.title
                )
            ) FILTER (WHERE s.id IS NOT NULL) as songs
        FROM cip60.music_tokens mt
        LEFT JOIN metadata.assets_songs asongs ON mt.id = asongs.asset_id
        LEFT JOIN metadata.songs s ON asongs.song_id = s.id
        WHERE mt.id = $1
        GROUP BY mt.id, mt.policy_id, mt.asset_name, mt.name, mt.metadata, mt.data_label
    `;

    const result = await pool.query(assetQuery, [id]);

    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Asset not found' });
    }

    res.json(result.rows[0]);
}));

router.get('/:id/images', asyncHandler(async (req, res) => {
    const { id } = req.params;

    const query = `
        SELECT
            i.id,
            i.image_url,
            i.image_type,
            i.ipfs_cid,
            ai.is_primary
        FROM metadata.images i
        JOIN metadata.asset_images ai ON i.id = ai.image_id
        WHERE ai.asset_id = $1
        ORDER BY ai.is_primary DESC, i.id
    `;

    const result = await pool.query(query, [id]);
    res.json(result.rows);
}));

router.post('/:id/images', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { imageId, isPrimary } = req.body;

    if (isPrimary) {
        await pool.query(
            'UPDATE metadata.asset_images SET is_primary = false WHERE asset_id = $1',
            [id]
        );
    }

    await pool.query(
        'INSERT INTO metadata.asset_images (asset_id, image_id, is_primary) VALUES ($1, $2, $3) ON CONFLICT (asset_id, image_id) DO UPDATE SET is_primary = $3',
        [id, imageId, isPrimary || false]
    );

    res.json({ success: true });
}));

router.delete('/:assetId/images/:imageId', asyncHandler(async (req, res) => {
    const { assetId, imageId } = req.params;

    await pool.query(
        'DELETE FROM metadata.asset_images WHERE asset_id = $1 AND image_id = $2',
        [assetId, imageId]
    );

    res.json({ success: true });
}));

module.exports = router;
