const express = require('express');
const { pool } = require('../config/database');
const { asyncHandler } = require('../lib/dbHelpers');

const router = express.Router();

router.get('/search', asyncHandler(async (req, res) => {
    const { q = '' } = req.query;
    const query = `
        SELECT DISTINCT s.id, s.title, s.duration, s.validation_status, s.isrc, s.iswc, s.is_explicit, s.is_ai_generated,
               array_agg(DISTINCT jsonb_build_object('name', a.name, 'isni', a.isni)) FILTER (WHERE a.name IS NOT NULL) as artists,
               array_agg(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL) as genres,
               array_agg(DISTINCT jsonb_build_object('id', af.id, 'url', af.file_url, 'type', af.file_type)) FILTER (WHERE af.id IS NOT NULL) as audio_files,
               array_agg(DISTINCT jsonb_build_object('id', mt.id, 'name', mt.name, 'policy_id', mt.policy_id, 'asset_name', mt.asset_name)) FILTER (WHERE mt.id IS NOT NULL) as tokens
        FROM metadata.songs s
        LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
        LEFT JOIN metadata.artists a ON sa.artist_id = a.id
        LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
        LEFT JOIN metadata.genres g ON sg.genre_id = g.id
        LEFT JOIN metadata.audio_files af ON s.id = af.song_id
        LEFT JOIN metadata.assets_songs asongs ON s.id = asongs.song_id
        LEFT JOIN cip60.music_tokens mt ON asongs.asset_id = mt.id
        WHERE s.title ILIKE $1 OR a.name ILIKE $1 OR g.name ILIKE $1
        GROUP BY s.id, s.title, s.duration, s.validation_status, s.isrc, s.iswc, s.is_explicit, s.is_ai_generated
        ORDER BY s.title
        LIMIT 50
    `;

    const result = await pool.query(query, [`%${q}%`]);
    res.json(result.rows);
}));

router.get('/search-for-token', asyncHandler(async (req, res) => {
    const { q = '', tokenId } = req.query;
    const query = `
        SELECT DISTINCT s.id, s.title, s.validation_status,
               string_agg(DISTINCT a.name, ', ') as artists,
               CASE WHEN aso.asset_id IS NOT NULL THEN true ELSE false END as already_linked
        FROM metadata.songs s
        LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
        LEFT JOIN metadata.artists a ON sa.artist_id = a.id
        LEFT JOIN metadata.assets_songs aso ON s.id = aso.song_id AND aso.asset_id = $2
        WHERE s.title ILIKE $1 OR a.name ILIKE $1
        GROUP BY s.id, s.title, s.validation_status, aso.asset_id
        ORDER BY already_linked ASC, s.title
        LIMIT 20
    `;

    const result = await pool.query(query, [`%${q}%`, tokenId]);
    res.json(result.rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    const songQuery = `
        SELECT s.id, s.title, s.duration, s.validation_status, s.isrc, s.iswc, s.is_explicit, s.is_ai_generated,
               array_agg(DISTINCT jsonb_build_object('name', a.name, 'isni', a.isni)) FILTER (WHERE a.name IS NOT NULL) as artists,
               array_agg(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL) as genres,
               array_agg(DISTINCT jsonb_build_object('id', af.id, 'url', af.file_url, 'type', af.file_type, 'ipfs_cid', af.ipfs_cid)) FILTER (WHERE af.id IS NOT NULL) as audio_files,
               array_agg(DISTINCT jsonb_build_object('id', mt.id, 'name', mt.name, 'policy_id', mt.policy_id, 'asset_name', mt.asset_name)) FILTER (WHERE mt.id IS NOT NULL) as tokens
        FROM metadata.songs s
        LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
        LEFT JOIN metadata.artists a ON sa.artist_id = a.id
        LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
        LEFT JOIN metadata.genres g ON sg.genre_id = g.id
        LEFT JOIN metadata.audio_files af ON s.id = af.song_id
        LEFT JOIN metadata.assets_songs asongs ON s.id = asongs.song_id
        LEFT JOIN cip60.music_tokens mt ON asongs.asset_id = mt.id
        WHERE s.id = $1
        GROUP BY s.id, s.title, s.duration, s.validation_status, s.isrc, s.iswc, s.is_explicit, s.is_ai_generated
    `;

    const result = await pool.query(songQuery, [id]);

    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Song not found' });
    }

    res.json(result.rows[0]);
}));

router.post('/:id/contributors', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { contributorIds, roles } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query('DELETE FROM metadata.song_contributors WHERE song_id = $1', [id]);

        for (let i = 0; i < contributorIds.length; i++) {
            await client.query(
                'INSERT INTO metadata.song_contributors (song_id, contributor_id, role) VALUES ($1, $2, $3)',
                [id, contributorIds[i], roles[i] || 'contributor']
            );
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}));

router.post('/bulk-update', asyncHandler(async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { songs, changes } = req.body;
        const results = [];

        for (const songId of songs) {
            await updateSongData(client, songId, changes);
            results.push(songId);
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Successfully updated ${results.length} songs`,
            updatedSongs: results
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk update error:', err);
        res.status(500).json({ error: 'Failed to update songs: ' + err.message });
    } finally {
        client.release();
    }
}));

router.post('/:id/update', asyncHandler(async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { id } = req.params;
        await updateSongData(client, id, req.body);

        await client.query('COMMIT');

        res.json({ success: true, message: 'Song updated successfully' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Update error:', err);
        res.status(500).json({ error: 'Failed to update song: ' + err.message });
    } finally {
        client.release();
    }
}));

async function updateSongData(client, songId, changes) {
    const { artists, genres, title, duration, validation_status, isrc, iswc, is_explicit, is_ai_generated } = changes;

    const songUpdates = {};
    if (title !== undefined) songUpdates.title = title;
    if (duration !== undefined) songUpdates.duration = duration;
    if (validation_status !== undefined) songUpdates.validation_status = validation_status;
    if (isrc !== undefined) songUpdates.isrc = isrc;
    if (iswc !== undefined) songUpdates.iswc = iswc;
    if (is_explicit !== undefined) songUpdates.is_explicit = is_explicit;
    if (is_ai_generated !== undefined) songUpdates.is_ai_generated = is_ai_generated;

    if (Object.keys(songUpdates).length > 0) {
        const updateFields = Object.keys(songUpdates).map((key, index) => `${key} = $${index + 2}`).join(', ');
        const updateValues = [songId, ...Object.values(songUpdates)];

        await client.query(
            `UPDATE metadata.songs SET ${updateFields}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            updateValues
        );
    }

    if (artists) {
        await client.query('DELETE FROM metadata.song_artists WHERE song_id = $1', [songId]);

        for (const artistData of artists) {
            const artistName = typeof artistData === 'string' ? artistData : artistData.name;
            const artistIsni = typeof artistData === 'object' ? artistData.isni : null;
            const role = typeof artistData === 'object' ? artistData.role || 'primary' : 'primary';

            let artistResult = await client.query(
                'SELECT id FROM metadata.artists WHERE name = $1',
                [artistName]
            );

            if (artistResult.rows.length === 0) {
                artistResult = await client.query(
                    'INSERT INTO metadata.artists (name, isni) VALUES ($1, $2) RETURNING id',
                    [artistName, artistIsni]
                );
            } else if (artistIsni) {
                await client.query(
                    'UPDATE metadata.artists SET isni = $1 WHERE id = $2',
                    [artistIsni, artistResult.rows[0].id]
                );
            }

            const artistId = artistResult.rows[0].id;

            await client.query(
                'INSERT INTO metadata.song_artists (song_id, artist_id, role) VALUES ($1, $2, $3)',
                [songId, artistId, role]
            );
        }
    }

    if (genres) {
        await client.query('DELETE FROM metadata.song_genres WHERE song_id = $1', [songId]);

        for (const genreName of genres) {
            let genreResult = await client.query(
                'SELECT id FROM metadata.genres WHERE name = $1',
                [genreName]
            );

            if (genreResult.rows.length === 0) {
                genreResult = await client.query(
                    'INSERT INTO metadata.genres (name) VALUES ($1) RETURNING id',
                    [genreName]
                );
            }

            const genreId = genreResult.rows[0].id;

            await client.query(
                'INSERT INTO metadata.song_genres (song_id, genre_id) VALUES ($1, $2)',
                [songId, genreId]
            );
        }
    }
}

router.delete('/bulk-delete', asyncHandler(async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            throw new Error('Invalid or empty IDs array');
        }

        const songsResult = await client.query(
            'SELECT id, title FROM metadata.songs WHERE id = ANY($1)',
            [ids]
        );

        if (songsResult.rows.length === 0) {
            throw new Error('No songs found with provided IDs');
        }

        const deleteResult = await client.query(
            'DELETE FROM metadata.songs WHERE id = ANY($1)',
            [ids]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Successfully deleted ${deleteResult.rowCount} songs`,
            deletedCount: deleteResult.rowCount,
            deletedSongs: songsResult.rows
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk delete songs error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { id } = req.params;

        const songResult = await client.query(
            'SELECT title FROM metadata.songs WHERE id = $1',
            [id]
        );

        if (songResult.rows.length === 0) {
            throw new Error('Song not found');
        }

        await client.query('DELETE FROM metadata.songs WHERE id = $1', [id]);

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Song "${songResult.rows[0].title}" deleted successfully`
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Delete song error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}));

router.post('/:songId/audio-files', asyncHandler(async (req, res) => {
    const { songId } = req.params;
    const { file_url, file_type, ipfs_cid } = req.body;

    if (!file_url || !file_type) {
        return res.status(400).json({ error: 'file_url and file_type are required' });
    }

    try {
        const existingFileByUrl = await pool.query(
            'SELECT * FROM metadata.audio_files WHERE file_url = $1',
            [file_url]
        );

        const existingFileByType = await pool.query(
            'SELECT * FROM metadata.audio_files WHERE song_id = $1 AND file_type = $2',
            [songId, file_type]
        );

        let audioFile;

        if (existingFileByUrl.rows.length > 0) {
            const existingFile = existingFileByUrl.rows[0];

            if (existingFile.song_id === parseInt(songId)) {
                return res.json({
                    success: true,
                    message: 'Audio file already linked to this song',
                    audio_file: existingFile
                });
            }

            if (existingFileByType.rows.length > 0) {
                await pool.query(
                    'DELETE FROM metadata.audio_files WHERE song_id = $1 AND file_type = $2',
                    [songId, file_type]
                );
            }

            const updateResult = await pool.query(
                'UPDATE metadata.audio_files SET song_id = $1, file_type = $2, ipfs_cid = $3 WHERE file_url = $4 RETURNING *',
                [songId, file_type, ipfs_cid || null, file_url]
            );
            audioFile = updateResult.rows[0];
        } else {
            if (existingFileByType.rows.length > 0) {
                const updateResult = await pool.query(
                    'UPDATE metadata.audio_files SET file_url = $1, ipfs_cid = $2 WHERE song_id = $3 AND file_type = $4 RETURNING *',
                    [file_url, ipfs_cid || null, songId, file_type]
                );
                audioFile = updateResult.rows[0];
            } else {
                const insertResult = await pool.query(
                    'INSERT INTO metadata.audio_files (song_id, file_url, file_type, ipfs_cid) VALUES ($1, $2, $3, $4) RETURNING *',
                    [songId, file_url, file_type, ipfs_cid || null]
                );
                audioFile = insertResult.rows[0];
            }
        }

        res.json({
            success: true,
            audio_file: audioFile
        });
    } catch (err) {
        console.error('Add audio file error:', err);
        res.status(500).json({ error: err.message });
    }
}));

router.post('/:songId/tokens/:tokenId/link', asyncHandler(async (req, res) => {
    const { songId, tokenId } = req.params;
    const { is_primary = false } = req.body;

    try {
        await pool.query(
            'INSERT INTO metadata.assets_songs (asset_id, song_id, is_primary) VALUES ($1, $2, $3) ON CONFLICT (asset_id, song_id) DO UPDATE SET is_primary = $3',
            [tokenId, songId, is_primary]
        );

        res.json({
            success: true,
            message: 'Token linked to song successfully'
        });
    } catch (err) {
        console.error('Link token error:', err);
        res.status(500).json({ error: err.message });
    }
}));

router.delete('/:songId/tokens/:tokenId/unlink', asyncHandler(async (req, res) => {
    const { songId, tokenId } = req.params;

    try {
        const result = await pool.query(
            'DELETE FROM metadata.assets_songs WHERE asset_id = $1 AND song_id = $2',
            [tokenId, songId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Token link not found' });
        }

        res.json({
            success: true,
            message: 'Token unlinked from song successfully'
        });
    } catch (err) {
        console.error('Unlink token error:', err);
        res.status(500).json({ error: err.message });
    }
}));

module.exports = router;
