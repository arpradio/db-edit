const express = require('express');
const { pool } = require('../config/database');
const { asyncHandler, bulkDeleteEntities, deleteSingleEntity } = require('../lib/dbHelpers');

const router = express.Router();

router.get('/search', asyncHandler(async (req, res) => {
    const { q } = req.query;
    const result = await pool.query(
        'SELECT id, name FROM metadata.genres WHERE name ILIKE $1 ORDER BY name LIMIT 20',
        [`%${q}%`]
    );
    res.json(result.rows);
}));

router.delete('/bulk-delete', asyncHandler(async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { ids } = req.body;
        const result = await bulkDeleteEntities(
            client,
            ids,
            'metadata.genres',
            'metadata.song_genres',
            'genre_id'
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Successfully deleted ${result.deletedCount} genres`,
            ...result
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk delete genres error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const name = await deleteSingleEntity(
        pool,
        id,
        'metadata.genres',
        'metadata.song_genres',
        'genre_id'
    );
    res.json({ success: true, message: `Genre "${name}" deleted successfully` });
}));

module.exports = router;
