const express = require('express');
const { pool } = require('../config/database');
const { asyncHandler, bulkDeleteEntities, deleteSingleEntity } = require('../lib/dbHelpers');

const router = express.Router();

router.get('/search', asyncHandler(async (req, res) => {
    const { q } = req.query;
    const query = `
        SELECT id, name, ipi, isni
        FROM metadata.contributor
        WHERE name ILIKE $1
        ORDER BY name
        LIMIT 20
    `;
    const result = await pool.query(query, [`%${q}%`]);
    res.json(result.rows);
}));

router.get('/', asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, search = '' } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = search ? 'WHERE name ILIKE $1' : '';
    const values = search ? [`%${search}%`] : [];

    const result = await pool.query(
        `SELECT id, name, ipi, isni FROM metadata.contributor ${whereClause} ORDER BY name LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset]
    );

    res.json(result.rows);
}));

router.post('/', asyncHandler(async (req, res) => {
    const { name, ipi, isni } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO metadata.contributor (name, ipi, isni) VALUES ($1, $2, $3) RETURNING *',
            [name, ipi || null, isni || null]
        );

        res.json({
            success: true,
            contributor: result.rows[0]
        });
    } catch (err) {
        console.error('Create contributor error:', err);
        res.status(500).json({ error: err.message });
    }
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, ipi, isni } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }

    try {
        const result = await pool.query(
            'UPDATE metadata.contributor SET name = $1, ipi = $2, isni = $3 WHERE id = $4 RETURNING *',
            [name, ipi || null, isni || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Contributor not found' });
        }

        res.json({
            success: true,
            contributor: result.rows[0]
        });
    } catch (err) {
        console.error('Update contributor error:', err);
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
            'metadata.contributor',
            'metadata.song_contributors',
            'contributor_id'
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Successfully deleted ${result.deletedCount} contributors`,
            ...result
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk delete contributors error:', err);
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
        'metadata.contributor',
        'metadata.song_contributors',
        'contributor_id'
    );
    res.json({ success: true, message: `Contributor "${name}" deleted successfully` });
}));

module.exports = router;
