const express = require('express');
const { pool } = require('../config/database');
const { asyncHandler } = require('../lib/dbHelpers');

const router = express.Router();

router.post('/:tokenId/bulk-link-songs', asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    const { songIds } = req.body;

    if (!songIds || !Array.isArray(songIds) || songIds.length === 0) {
        return res.status(400).json({ error: 'songIds array is required' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let linkedCount = 0;

        for (const songId of songIds) {
            const checkResult = await client.query(
                'SELECT 1 FROM metadata.assets_songs WHERE asset_id = $1 AND song_id = $2',
                [tokenId, songId]
            );

            if (checkResult.rows.length === 0) {
                await client.query(
                    'INSERT INTO metadata.assets_songs (asset_id, song_id, is_primary) VALUES ($1, $2, $3)',
                    [tokenId, songId, false]
                );
                linkedCount++;
            }
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Successfully linked token to ${linkedCount} songs`,
            linkedCount
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk link token error:', err);
        res.status(500).json({ error: 'Failed to link token to songs: ' + err.message });
    } finally {
        client.release();
    }
}));

router.post('/:tokenId/fix-relations', asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    const { songIds = [], markProcessed = true } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let linkedCount = 0;

        for (const songId of songIds) {
            const checkResult = await client.query(
                'SELECT 1 FROM metadata.assets_songs WHERE asset_id = $1 AND song_id = $2',
                [tokenId, songId]
            );

            if (checkResult.rows.length === 0) {
                await client.query(
                    'INSERT INTO metadata.assets_songs (asset_id, song_id, is_primary) VALUES ($1, $2, $3)',
                    [tokenId, songId, false]
                );
                linkedCount++;
            }
        }

        if (markProcessed) {
            await client.query(
                'INSERT INTO cip60.processing_status (asset_id, status, has_valid_songs) VALUES ($1, $2, $3) ON CONFLICT (asset_id) DO UPDATE SET status = $2, has_valid_songs = $3, processed_at = CURRENT_TIMESTAMP',
                [tokenId, 'processed', linkedCount > 0 || songIds.length > 0]
            );
        }

        await client.query('COMMIT');

        let message = '';
        if (linkedCount > 0 && markProcessed) {
            message = `Linked token to ${linkedCount} songs and marked as processed`;
        } else if (linkedCount > 0) {
            message = `Linked token to ${linkedCount} songs`;
        } else if (markProcessed) {
            message = 'Token marked as processed';
        } else {
            message = 'No changes made';
        }

        res.json({
            success: true,
            message,
            linkedCount
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Fix token relations error:', err);
        res.status(500).json({ error: 'Failed to fix token relations: ' + err.message });
    } finally {
        client.release();
    }
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
            'SELECT asset_id FROM metadata.assets_songs WHERE asset_id = ANY($1) LIMIT 1',
            [ids]
        );

        if (checkResult.rows.length > 0) {
            throw new Error('Cannot delete tokens with associated songs');
        }

        const namesResult = await client.query(
            'SELECT asset_name FROM cip60.assets WHERE id = ANY($1)',
            [ids]
        );

        const deleteResult = await client.query(
            'DELETE FROM cip60.assets WHERE id = ANY($1)',
            [ids]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Successfully deleted ${deleteResult.rowCount} tokens`,
            deletedCount: deleteResult.rowCount,
            deletedNames: namesResult.rows.map(row => row.asset_name)
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk delete tokens error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    const checkResult = await pool.query(
        'SELECT count(*) FROM metadata.assets_songs WHERE asset_id = $1',
        [id]
    );

    if (parseInt(checkResult.rows[0].count) > 0) {
        throw new Error('Cannot delete token with associated songs');
    }

    const result = await pool.query(
        'DELETE FROM cip60.assets WHERE id = $1 RETURNING asset_name',
        [id]
    );

    if (result.rows.length === 0) {
        throw new Error('Token not found');
    }

    res.json({ success: true, message: `Token "${result.rows[0].asset_name}" deleted successfully` });
}));

router.post('/:id/process', asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
        await pool.query(
            'INSERT INTO cip60.processing_status (asset_id, status, has_valid_songs) VALUES ($1, $2, $3) ON CONFLICT (asset_id) DO UPDATE SET status = $2, has_valid_songs = $3, processed_at = CURRENT_TIMESTAMP',
            [id, 'processed', true]
        );

        res.json({
            success: true,
            message: 'Token marked as processed'
        });
    } catch (err) {
        console.error('Process token error:', err);
        res.status(500).json({ error: err.message });
    }
}));

router.post('/:tokenId/link-song', asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    const { title, url } = req.body;

    if (!title && !url) {
        return res.status(400).json({ error: 'Either title or url is required' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let songId;
        let created = false;

        const searchValue = title || url;
        const existingSong = await client.query(
            `SELECT id FROM metadata.songs WHERE title ILIKE $1 LIMIT 1`,
            [searchValue]
        );

        if (existingSong.rows.length > 0) {
            songId = existingSong.rows[0].id;
        } else {
            const newSong = await client.query(
                'INSERT INTO metadata.songs (title, validation_status) VALUES ($1, $2) RETURNING id',
                [searchValue, 'draft']
            );
            songId = newSong.rows[0].id;
            created = true;

            if (url && url.startsWith('http')) {
                await client.query(
                    'INSERT INTO metadata.audio_files (song_id, file_url, file_type) VALUES ($1, $2, $3)',
                    [songId, url, 'unknown']
                );
            }
        }

        await client.query(
            'INSERT INTO metadata.assets_songs (asset_id, song_id, is_primary) VALUES ($1, $2, $3) ON CONFLICT (asset_id, song_id) DO NOTHING',
            [tokenId, songId, false]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: created ? 'Song created and linked successfully' : 'Song linked successfully',
            song_id: songId,
            created: created
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Link song to token error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}));

router.get('/search', asyncHandler(async (req, res) => {
    const { q } = req.query;
    const result = await pool.query(
        'SELECT id, asset_name, policy_id, name FROM cip60.music_tokens WHERE asset_name ILIKE $1 OR name ILIKE $1 ORDER BY name, asset_name LIMIT 20',
        [`%${q}%`]
    );
    res.json(result.rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    const tokenQuery = `
        SELECT mt.id, mt.asset_name, mt.policy_id, mt.name,
               mt.metadata,
               mt.data_label,
               cip60.asset_fingerprint(mt.policy_id::text, mt.asset_name::text) AS asset_fingerprint,
               (cip60.extract_metadata_fields(mt.metadata)).release_type AS release_type,
               (cip60.extract_metadata_fields(mt.metadata)).image_urls AS image_urls,
               array_agg(DISTINCT jsonb_build_object(
                   'id', s.id,
                   'title', s.title,
                   'artists', (SELECT array_agg(a.name) FROM metadata.song_artists sa
                              JOIN metadata.artists a ON sa.artist_id = a.id
                              WHERE sa.song_id = s.id),
                   'genres', (SELECT array_agg(g.name) FROM metadata.song_genres sg
                             JOIN metadata.genres g ON sg.genre_id = g.id
                             WHERE sg.song_id = s.id),
                   'is_primary', aso.is_primary
               )) FILTER (WHERE s.id IS NOT NULL) as songs,
               array_agg(DISTINCT jsonb_build_object(
                   'id', i.id,
                   'image_url', i.image_url,
                   'image_type', i.image_type,
                   'is_primary', ai.is_primary
               )) FILTER (WHERE i.id IS NOT NULL) as images
        FROM cip60.music_tokens mt
        LEFT JOIN metadata.assets_songs aso ON mt.id = aso.asset_id
        LEFT JOIN metadata.songs s ON aso.song_id = s.id
        LEFT JOIN metadata.asset_images ai ON mt.id = ai.asset_id
        LEFT JOIN metadata.images i ON ai.image_id = i.id
        WHERE mt.id = $1
        GROUP BY mt.id, mt.asset_name, mt.policy_id, mt.name, mt.metadata, mt.data_label
    `;

    const result = await pool.query(tokenQuery, [id]);

    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Token not found' });
    }

    res.json(result.rows[0]);
}));

router.post('/:tokenId/images', asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    const { image_url, image_type = 'cover', is_primary = false } = req.body;

    if (!image_url) {
        return res.status(400).json({ error: 'image_url is required' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let imageResult = await client.query(
            'SELECT id FROM metadata.images WHERE image_url = $1',
            [image_url]
        );

        let imageId;
        if (imageResult.rows.length > 0) {
            imageId = imageResult.rows[0].id;
        } else {
            const newImage = await client.query(
                'INSERT INTO metadata.images (image_url, image_type) VALUES ($1, $2) RETURNING id',
                [image_url, image_type]
            );
            imageId = newImage.rows[0].id;
        }

        await client.query(
            'INSERT INTO metadata.asset_images (asset_id, image_id, is_primary) VALUES ($1, $2, $3) ON CONFLICT (asset_id, image_id) DO UPDATE SET is_primary = $3',
            [tokenId, imageId, is_primary]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'Image linked to token successfully',
            image_id: imageId
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Link image to token error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}));

router.delete('/:tokenId/images/:imageId', asyncHandler(async (req, res) => {
    const { tokenId, imageId } = req.params;

    try {
        const result = await pool.query(
            'DELETE FROM metadata.asset_images WHERE asset_id = $1 AND image_id = $2',
            [tokenId, imageId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Image link not found' });
        }

        res.json({
            success: true,
            message: 'Image unlinked from token successfully'
        });
    } catch (err) {
        console.error('Unlink image from token error:', err);
        res.status(500).json({ error: err.message });
    }
}));

router.put('/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { policy_id, asset_name } = req.body;

    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (policy_id !== undefined) {
        updates.push(`policy_id = $${paramIndex++}`);
        values.push(policy_id);
    }
    if (asset_name !== undefined) {
        updates.push(`asset_name = $${paramIndex++}`);
        values.push(asset_name);
    }

    if (updates.length === 0) {
        return res.status(400).json({ error: 'At least one field (policy_id or asset_name) is required' });
    }

    updates.push(`updated_at = $${paramIndex++}`);
    values.push(Date.now());

    values.push(id);

    try {
        const query = `UPDATE cip60.assets SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, policy_id, asset_name`;
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Token not found' });
        }

        res.json({
            success: true,
            message: 'Token updated successfully',
            token: result.rows[0]
        });
    } catch (err) {
        console.error('Update token error:', err);
        res.status(500).json({ error: err.message });
    }
}));

router.post('/bulk-add-audio', asyncHandler(async (req, res) => {
    const { tokenIds, audioUrl, audioType, ipfsCid } = req.body;

    if (!tokenIds || !Array.isArray(tokenIds) || tokenIds.length === 0) {
        return res.status(400).json({ error: 'tokenIds array is required' });
    }

    if (!audioUrl) {
        return res.status(400).json({ error: 'audioUrl is required' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let songsCreated = 0;
        let songsLinked = 0;
        let audioFilesAdded = 0;

        for (const tokenId of tokenIds) {
            const tokenResult = await client.query(
                'SELECT id, name, asset_name FROM cip60.music_tokens WHERE id = $1',
                [tokenId]
            );

            if (tokenResult.rows.length === 0) {
                console.warn(`Token ${tokenId} not found, skipping`);
                continue;
            }

            const token = tokenResult.rows[0];
            const songTitle = token.name || token.asset_name || `Token ${tokenId}`;

            const existingLinkResult = await client.query(
                'SELECT song_id FROM metadata.assets_songs WHERE asset_id = $1 LIMIT 1',
                [tokenId]
            );

            let songId;

            if (existingLinkResult.rows.length > 0) {
                songId = existingLinkResult.rows[0].song_id;
            } else {
                const newSongResult = await client.query(
                    'INSERT INTO metadata.songs (title, validation_status) VALUES ($1, $2) RETURNING id',
                    [songTitle, 'unverified']
                );
                songId = newSongResult.rows[0].id;
                songsCreated++;

                await client.query(
                    'INSERT INTO metadata.assets_songs (asset_id, song_id, is_primary) VALUES ($1, $2, $3)',
                    [tokenId, songId, true]
                );
                songsLinked++;
            }

            const existingAudioResult = await client.query(
                'SELECT id FROM metadata.audio_files WHERE song_id = $1 AND file_type = $2',
                [songId, audioType]
            );

            if (existingAudioResult.rows.length > 0) {
                await client.query(
                    'UPDATE metadata.audio_files SET file_url = $1, ipfs_cid = $2 WHERE id = $3',
                    [audioUrl, ipfsCid || null, existingAudioResult.rows[0].id]
                );
            } else {
                await client.query(
                    'INSERT INTO metadata.audio_files (song_id, file_url, file_type, ipfs_cid) VALUES ($1, $2, $3, $4)',
                    [songId, audioUrl, audioType, ipfsCid || null]
                );
            }
            audioFilesAdded++;
        }

        await client.query('COMMIT');

        const messageParts = [];
        if (songsCreated > 0) messageParts.push(`created ${songsCreated} songs`);
        if (songsLinked > 0) messageParts.push(`linked ${songsLinked} tokens to songs`);
        messageParts.push(`added audio to ${audioFilesAdded} tokens`);

        res.json({
            success: true,
            message: `Successfully ${messageParts.join(', ')}`,
            songsCreated,
            songsLinked,
            audioFilesAdded
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk add audio error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}));

module.exports = router;
