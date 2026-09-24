const express = require('express');
const { pool } = require('../config/database');
const { asyncHandler } = require('../lib/dbHelpers');

const router = express.Router();

router.put('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { file_url, file_type, ipfs_cid } = req.body;

    if (!file_url || !file_type) {
        return res.status(400).json({ error: 'file_url and file_type are required' });
    }

    try {
        const result = await pool.query(
            'UPDATE metadata.audio_files SET file_url = $1, file_type = $2, ipfs_cid = $3 WHERE id = $4 RETURNING *',
            [file_url, file_type, ipfs_cid || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Audio file not found' });
        }

        res.json({
            success: true,
            audio_file: result.rows[0]
        });
    } catch (err) {
        console.error('Update audio file error:', err);
        res.status(500).json({ error: err.message });
    }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            'DELETE FROM metadata.audio_files WHERE id = $1 RETURNING file_url',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Audio file not found' });
        }

        res.json({
            success: true,
            message: `Audio file deleted successfully`
        });
    } catch (err) {
        console.error('Delete audio file error:', err);
        res.status(500).json({ error: err.message });
    }
}));

module.exports = router;
