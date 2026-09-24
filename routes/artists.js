const express = require('express');
const { pool } = require('../config/database');
const { asyncHandler, bulkDeleteEntities, deleteSingleEntity } = require('../lib/dbHelpers');

const router = express.Router();

router.get('/search', asyncHandler(async (req, res) => {
    const { q } = req.query;
    const result = await pool.query(
        'SELECT id, name, isni FROM metadata.artists WHERE name ILIKE $1 ORDER BY name LIMIT 20',
        [`%${q}%`]
    );
    res.json(result.rows);
}));

router.put('/:id/isni', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isni } = req.body;

    if (!isni || isni.trim().length === 0) {
        return res.status(400).json({ error: 'ISNI is required' });
    }

    try {
        const result = await pool.query(
            'UPDATE metadata.artists SET isni = $1 WHERE id = $2 RETURNING name',
            [isni.trim(), id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Artist not found' });
        }

        res.json({
            success: true,
            message: `ISNI updated for artist "${result.rows[0].name}"`
        });
    } catch (err) {
        console.error('Update ISNI error:', err);
        res.status(500).json({ error: err.message });
    }
}));

router.delete('/bulk-delete', asyncHandler(async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { ids } = req.body;
        const result = await bulkDeleteEntities(
            client,
            ids,
            'metadata.artists',
            'metadata.song_artists',
            'artist_id'
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Successfully deleted ${result.deletedCount} artists`,
            ...result
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk delete artists error:', err);
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
        'metadata.artists',
        'metadata.song_artists',
        'artist_id'
    );
    res.json({ success: true, message: `Artist "${name}" deleted successfully` });
}));

module.exports = router;
