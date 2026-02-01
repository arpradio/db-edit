require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

app.get('/api/songs/search', asyncHandler(async (req, res) => {
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

app.get('/api/songs/search-for-token', asyncHandler(async (req, res) => {
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

app.post('/api/tokens/:tokenId/bulk-link-songs', asyncHandler(async (req, res) => {
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

app.post('/api/tokens/:tokenId/fix-relations', asyncHandler(async (req, res) => {
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

app.get('/api/artists/search', asyncHandler(async (req, res) => {
    const { q } = req.query;
    const result = await pool.query(
        'SELECT id, name, isni FROM metadata.artists WHERE name ILIKE $1 ORDER BY name LIMIT 20',
        [`%${q}%`]
    );
    res.json(result.rows);
}));

app.get('/api/genres/search', asyncHandler(async (req, res) => {
    const { q } = req.query;
    const result = await pool.query(
        'SELECT id, name FROM metadata.genres WHERE name ILIKE $1 ORDER BY name LIMIT 20',
        [`%${q}%`]
    );
    res.json(result.rows);
}));

app.get('/api/contributors/search', asyncHandler(async (req, res) => {
    const { q } = req.query;
    const result = await pool.query(
        'SELECT id, name, isni, ipi FROM metadata.contributors WHERE name ILIKE $1 ORDER BY name LIMIT 20',
        [`%${q}%`]
    );
    res.json(result.rows);
}));

app.get('/api/songs/:id', asyncHandler(async (req, res) => {
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

app.get('/api/assets/:id', asyncHandler(async (req, res) => {
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

app.get('/api/assets/:id/images', asyncHandler(async (req, res) => {
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

app.get('/api/images/search', asyncHandler(async (req, res) => {
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

app.post('/api/assets/:id/images', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { imageId, isPrimary } = req.body;

    // If this is marked as primary, unset any existing primary images for this asset
    if (isPrimary) {
        await pool.query(
            'UPDATE metadata.asset_images SET is_primary = false WHERE asset_id = $1',
            [id]
        );
    }

    // Link the image to the asset
    await pool.query(
        'INSERT INTO metadata.asset_images (asset_id, image_id, is_primary) VALUES ($1, $2, $3) ON CONFLICT (asset_id, image_id) DO UPDATE SET is_primary = $3',
        [id, imageId, isPrimary || false]
    );

    res.json({ success: true });
}));

app.delete('/api/assets/:assetId/images/:imageId', asyncHandler(async (req, res) => {
    const { assetId, imageId } = req.params;

    await pool.query(
        'DELETE FROM metadata.asset_images WHERE asset_id = $1 AND image_id = $2',
        [assetId, imageId]
    );

    res.json({ success: true });
}));

app.get('/api/contributors/search', asyncHandler(async (req, res) => {
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

app.post('/api/songs/:id/contributors', asyncHandler(async (req, res) => {
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

app.post('/api/songs/bulk-update', asyncHandler(async (req, res) => {
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

app.post('/api/songs/:id/update', asyncHandler(async (req, res) => {
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

app.get('/api/quality/counts', asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT * FROM get_quality_counts()');
    res.json(result.rows[0]);
}));

app.get('/api/quality/issues/:type', asyncHandler(async (req, res) => {
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

app.get('/api/stats', asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT * FROM get_song_stats()');
    res.json(result.rows[0]);
}));

app.get('/api/debug/health', asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT * FROM test_database_health()');
    res.json({
        status: 'connected',
        tests: result.rows
    });
}));

async function bulkDeleteEntities(client, ids, tableName, relationTable, relationColumn) {
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        throw new Error('Invalid or empty IDs array');
    }
    
    const checkResult = await client.query(
        `SELECT ${relationColumn} FROM ${relationTable} WHERE ${relationColumn} = ANY($1) LIMIT 1`,
        [ids]
    );
    
    if (checkResult.rows.length > 0) {
        throw new Error(`Cannot delete ${tableName} with associated songs`);
    }
    
    const namesResult = await client.query(
        `SELECT name FROM ${tableName} WHERE id = ANY($1)`,
        [ids]
    );
    
    const deleteResult = await client.query(
        `DELETE FROM ${tableName} WHERE id = ANY($1)`,
        [ids]
    );
    
    return {
        deletedCount: deleteResult.rowCount,
        deletedNames: namesResult.rows.map(row => row.name)
    };
}

app.delete('/api/artists/bulk-delete', asyncHandler(async (req, res) => {
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

app.delete('/api/genres/bulk-delete', asyncHandler(async (req, res) => {
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

async function deleteSingleEntity(entityId, tableName, relationTable, relationColumn) {
    const checkResult = await pool.query(
        `SELECT count(*) FROM ${relationTable} WHERE ${relationColumn} = $1`,
        [entityId]
    );
    
    if (parseInt(checkResult.rows[0].count) > 0) {
        throw new Error(`Cannot delete ${tableName.split('.')[1]} with associated songs`);
    }
    
    const result = await pool.query(
        `DELETE FROM ${tableName} WHERE id = $1 RETURNING name`,
        [entityId]
    );
    
    if (result.rows.length === 0) {
        throw new Error(`${tableName.split('.')[1]} not found`);
    }
    
    return result.rows[0].name;
}

app.delete('/api/artists/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const name = await deleteSingleEntity(
        id, 
        'metadata.artists', 
        'metadata.song_artists', 
        'artist_id'
    );
    res.json({ success: true, message: `Artist "${name}" deleted successfully` });
}));

app.delete('/api/genres/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const name = await deleteSingleEntity(
        id, 
        'metadata.genres', 
        'metadata.song_genres', 
        'genre_id'
    );
    res.json({ success: true, message: `Genre "${name}" deleted successfully` });
}));

app.delete('/api/tokens/bulk-delete', asyncHandler(async (req, res) => {
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

app.delete('/api/tokens/:id', asyncHandler(async (req, res) => {
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

app.delete('/api/images/bulk-delete', asyncHandler(async (req, res) => {
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

app.delete('/api/images/:id', asyncHandler(async (req, res) => {
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

app.post('/api/tokens/:id/process', asyncHandler(async (req, res) => {
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

app.put('/api/artists/:id/isni', asyncHandler(async (req, res) => {
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

app.delete('/api/songs/bulk-delete', asyncHandler(async (req, res) => {
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

app.delete('/api/songs/:id', asyncHandler(async (req, res) => {
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

app.post('/api/songs/:songId/audio-files', asyncHandler(async (req, res) => {
    const { songId } = req.params;
    const { file_url, file_type, ipfs_cid } = req.body;

    if (!file_url || !file_type) {
        return res.status(400).json({ error: 'file_url and file_type are required' });
    }

    try {
        // Check if audio file with this URL already exists
        const existingFileByUrl = await pool.query(
            'SELECT * FROM metadata.audio_files WHERE file_url = $1',
            [file_url]
        );

        // Check if this song already has a file of this type
        const existingFileByType = await pool.query(
            'SELECT * FROM metadata.audio_files WHERE song_id = $1 AND file_type = $2',
            [songId, file_type]
        );

        let audioFile;

        if (existingFileByUrl.rows.length > 0) {
            const existingFile = existingFileByUrl.rows[0];

            // File URL exists - check if it's already linked to this song
            if (existingFile.song_id === parseInt(songId)) {
                return res.json({
                    success: true,
                    message: 'Audio file already linked to this song',
                    audio_file: existingFile
                });
            }

            // File URL exists for a different song
            // We need to delete the existing entry for this song+type combination first
            if (existingFileByType.rows.length > 0) {
                await pool.query(
                    'DELETE FROM metadata.audio_files WHERE song_id = $1 AND file_type = $2',
                    [songId, file_type]
                );
            }

            // Now update the file to link to this song
            const updateResult = await pool.query(
                'UPDATE metadata.audio_files SET song_id = $1, file_type = $2, ipfs_cid = $3 WHERE file_url = $4 RETURNING *',
                [songId, file_type, ipfs_cid || null, file_url]
            );
            audioFile = updateResult.rows[0];
        } else {
            // File URL doesn't exist - but check if song already has this file type
            if (existingFileByType.rows.length > 0) {
                // Update the existing file
                const updateResult = await pool.query(
                    'UPDATE metadata.audio_files SET file_url = $1, ipfs_cid = $2 WHERE song_id = $3 AND file_type = $4 RETURNING *',
                    [file_url, ipfs_cid || null, songId, file_type]
                );
                audioFile = updateResult.rows[0];
            } else {
                // Create new entry
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

app.put('/api/audio-files/:id', asyncHandler(async (req, res) => {
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

app.delete('/api/audio-files/:id', asyncHandler(async (req, res) => {
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

app.post('/api/tokens/:tokenId/link-song', asyncHandler(async (req, res) => {
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

        // Search for existing song by title or URL
        const searchValue = title || url;
        const existingSong = await client.query(
            `SELECT id FROM metadata.songs WHERE title ILIKE $1 LIMIT 1`,
            [searchValue]
        );

        if (existingSong.rows.length > 0) {
            // Song exists, use it
            songId = existingSong.rows[0].id;
        } else {
            // Create new song
            const newSong = await client.query(
                'INSERT INTO metadata.songs (title, validation_status) VALUES ($1, $2) RETURNING id',
                [searchValue, 'draft']
            );
            songId = newSong.rows[0].id;
            created = true;

            // If URL was provided, create an audio file entry
            if (url && url.startsWith('http')) {
                await client.query(
                    'INSERT INTO metadata.audio_files (song_id, file_url, file_type) VALUES ($1, $2, $3)',
                    [songId, url, 'unknown']
                );
            }
        }

        // Link song to token
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

app.post('/api/songs/:songId/tokens/:tokenId/link', asyncHandler(async (req, res) => {
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

app.delete('/api/songs/:songId/tokens/:tokenId/unlink', asyncHandler(async (req, res) => {
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

app.get('/api/tokens/search', asyncHandler(async (req, res) => {
    const { q } = req.query;
    const result = await pool.query(
        'SELECT id, asset_name, policy_id, name FROM cip60.music_tokens WHERE asset_name ILIKE $1 OR name ILIKE $1 ORDER BY name, asset_name LIMIT 20',
        [`%${q}%`]
    );
    res.json(result.rows);
}));

app.get('/api/tokens/:id', asyncHandler(async (req, res) => {
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

app.post('/api/tokens/:tokenId/images', asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    const { image_url, image_type = 'cover', is_primary = false } = req.body;

    if (!image_url) {
        return res.status(400).json({ error: 'image_url is required' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Check if image already exists
        let imageResult = await client.query(
            'SELECT id FROM metadata.images WHERE image_url = $1',
            [image_url]
        );

        let imageId;
        if (imageResult.rows.length > 0) {
            imageId = imageResult.rows[0].id;
        } else {
            // Create new image
            const newImage = await client.query(
                'INSERT INTO metadata.images (image_url, image_type) VALUES ($1, $2) RETURNING id',
                [image_url, image_type]
            );
            imageId = newImage.rows[0].id;
        }

        // Link image to token
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

app.delete('/api/tokens/:tokenId/images/:imageId', asyncHandler(async (req, res) => {
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

app.put('/api/tokens/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { policy_id, asset_name } = req.body;

    // Build update query dynamically based on provided fields
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

    // Add updated_at timestamp
    updates.push(`updated_at = $${paramIndex++}`);
    values.push(Date.now());

    // Add the ID as the last parameter
    values.push(id);

    try {
        // Update the base assets table (not the view)
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

app.get('/api/contributors', asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, search = '' } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = search ? 'WHERE name ILIKE $1' : '';
    const values = search ? [`%${search}%`] : [];

    const result = await pool.query(
        `SELECT id, name, ipi, isni FROM metadata.contributor ${whereClause} ORDER BY name LIMIT ${values.length + 1} OFFSET ${values.length + 2}`,
        [...values, limit, offset]
    );

    res.json(result.rows);
}));

app.post('/api/contributors', asyncHandler(async (req, res) => {
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

app.put('/api/contributors/:id', asyncHandler(async (req, res) => {
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

app.delete('/api/contributors/bulk-delete', asyncHandler(async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            throw new Error('Invalid or empty IDs array');
        }

        const namesResult = await client.query(
            'SELECT name FROM metadata.contributor WHERE id = ANY($1)',
            [ids]
        );

        const deleteResult = await client.query(
            'DELETE FROM metadata.contributor WHERE id = ANY($1)',
            [ids]
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Successfully deleted ${deleteResult.rowCount} contributors`,
            deletedCount: deleteResult.rowCount,
            deletedNames: namesResult.rows.map(row => row.name)
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Bulk delete contributors error:', err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
}));

app.delete('/api/contributors/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            'DELETE FROM metadata.contributor WHERE id = $1 RETURNING name',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Contributor not found' });
        }

        res.json({
            success: true,
            message: `Contributor "${result.rows[0].name}" deleted successfully`
        });
    } catch (err) {
        console.error('Delete contributor error:', err);
        res.status(500).json({ error: err.message });
    }
}));

app.post('/api/tokens/bulk-add-audio', asyncHandler(async (req, res) => {
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
            // Get token details
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

            // Check if token is already linked to a song
            const existingLinkResult = await client.query(
                'SELECT song_id FROM metadata.assets_songs WHERE asset_id = $1 LIMIT 1',
                [tokenId]
            );

            let songId;

            if (existingLinkResult.rows.length > 0) {
                // Token already linked to a song, use that song
                songId = existingLinkResult.rows[0].song_id;
            } else {
                // Create a new song for this token
                const newSongResult = await client.query(
                    'INSERT INTO metadata.songs (title, validation_status) VALUES ($1, $2) RETURNING id',
                    [songTitle, 'unverified']
                );
                songId = newSongResult.rows[0].id;
                songsCreated++;

                // Link token to the new song
                await client.query(
                    'INSERT INTO metadata.assets_songs (asset_id, song_id, is_primary) VALUES ($1, $2, $3)',
                    [tokenId, songId, true]
                );
                songsLinked++;
            }

            // Check if song already has an audio file of this type
            const existingAudioResult = await client.query(
                'SELECT id FROM metadata.audio_files WHERE song_id = $1 AND file_type = $2',
                [songId, audioType]
            );

            if (existingAudioResult.rows.length > 0) {
                // Update existing audio file
                await client.query(
                    'UPDATE metadata.audio_files SET file_url = $1, ipfs_cid = $2 WHERE id = $3',
                    [audioUrl, ipfsCid || null, existingAudioResult.rows[0].id]
                );
            } else {
                // Add new audio file to the song
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

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
});

app.listen(PORT, () => {
    console.log(`Music DB Editor running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to access the editor`);
});