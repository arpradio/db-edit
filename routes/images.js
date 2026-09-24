const express = require('express');
const { pool } = require('../config/database');
const { asyncHandler } = require('../lib/dbHelpers');

const router = express.Router();

router.get('/search', asyncHandler(async (req, res) => {
    const { q } = req.query;

    const query = `
        SELECT id, image_url, image_type, ipfs_cid
        FROM metadata.images
        WHERE image_url ILIKE $1 OR ipfs_cid ILIKE $1
        ORDER BY id DESC
        LIMIT 20
    `;

    const result = await pool.query(query, [`%${q}%`]);
    res.json(result.rows);
}));

router.delete('/bulk-delete', asyncHandler(async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            throw new Error('Invalid or empty IDs array');
        }

        const checkResult = await client.query(
            'SELECT image_id FROM metadata.asset_images WHERE image_id = ANY($1) LIMIT 1',
            [ids]
        );

        if (checkResult.rows.length > 0) {
            throw new Error('Cannot delete images with associated assets');
        }

        const namesResult = await client.query(
            'SELECT image_url FROM metadata.images WHERE id = ANY($1)',
            [ids]
        );

        const deleteResult = await client.query(
            'DELETE FROM metadata.images WHERE id = ANY($1)',
            [ids]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Successfully deleted ${deleteResult.rowCount} images`,
            deletedCount: deleteResult.rowCount,
            deletedNames: namesResult.rows.map(row => row.image_url || 'Untitled Image')
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk delete images error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    const checkResult = await pool.query(
        'SELECT count(*) FROM metadata.asset_images WHERE image_id = $1',
        [id]
    );

    if (parseInt(checkResult.rows[0].count) > 0) {
        throw new Error('Cannot delete image with associated assets');
    }

    const result = await pool.query(
        'DELETE FROM metadata.images WHERE id = $1 RETURNING image_url',
        [id]
    );

    if (result.rows.length === 0) {
        throw new Error('Image not found');
    }

    res.json({ success: true, message: `Image deleted successfully` });
}));

module.exports = router;
