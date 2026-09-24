const express = require('express');
const { pool } = require('../config/database');
const { asyncHandler } = require('../lib/dbHelpers');

const router = express.Router();

router.get('/stats', asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT * FROM get_song_stats()');
    res.json(result.rows[0]);
}));

router.get('/debug/health', asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT * FROM test_database_health()');
    res.json({
        status: 'connected',
        tests: result.rows
    });
}));

module.exports = router;
