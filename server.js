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
        SELECT DISTINCT s.id, s.title, s.duration, s.validation_status, s.isrc, s.iswc,
               array_agg(DISTINCT jsonb_build_object('name', a.name, 'isni', a.isni)) FILTER (WHERE a.name IS NOT NULL) as artists,
               array_agg(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL) as genres,
               array_agg(DISTINCT jsonb_build_object('id', af.id, 'url', af.file_url, 'type', af.file_type)) FILTER (WHERE af.id IS NOT NULL) as audio_files,
               array_agg(DISTINCT jsonb_build_object('id', ast.id, 'name', ast.asset_name, 'policy_id', ast.policy_id)) FILTER (WHERE ast.id IS NOT NULL) as tokens
        FROM metadata.songs s
        LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
        LEFT JOIN metadata.artists a ON sa.artist_id = a.id
        LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
        LEFT JOIN metadata.genres g ON sg.genre_id = g.id
        LEFT JOIN metadata.audio_files af ON s.id = af.song_id
        LEFT JOIN cip60.assets_songs asongs ON s.id = asongs.song_id
        LEFT JOIN cip60.assets ast ON asongs.asset_id = ast.id
        WHERE s.title ILIKE $1 OR a.name ILIKE $1 OR g.name ILIKE $1
        GROUP BY s.id, s.title, s.duration, s.validation_status, s.isrc, s.iswc
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
        LEFT JOIN cip60.assets_songs aso ON s.id = aso.song_id AND aso.asset_id = $2
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
                'SELECT 1 FROM cip60.assets_songs WHERE asset_id = $1 AND song_id = $2',
                [tokenId, songId]
            );
            
            if (checkResult.rows.length === 0) {
                await client.query(
                    'INSERT INTO cip60.assets_songs (asset_id, song_id, is_primary) VALUES ($1, $2, $3)',
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
                'SELECT 1 FROM cip60.assets_songs WHERE asset_id = $1 AND song_id = $2',
                [tokenId, songId]
            );
            
            if (checkResult.rows.length === 0) {
                await client.query(
                    'INSERT INTO cip60.assets_songs (asset_id, song_id, is_primary) VALUES ($1, $2, $3)',
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

app.get('/api/quality/issues/orphan-tokens', asyncHandler(async (req, res) => {
    const query = `
        SELECT a.id, a.asset_name as name, a.policy_id, a.release_title
        FROM cip60.assets a
        LEFT JOIN cip60.assets_songs aso ON a.id = aso.asset_id
        WHERE aso.asset_id IS NULL
        ORDER BY a.release_title, a.asset_name
        LIMIT 100
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
}));

app.get('/api/quality/issues/unprocessed-tokens', asyncHandler(async (req, res) => {
    const query = `
        SELECT a.id, a.asset_name as name, a.policy_id, a.release_title
        FROM cip60.assets a
        LEFT JOIN cip60.processing_status ps ON a.id = ps.asset_id
        WHERE ps.asset_id IS NULL
        ORDER BY a.indexed_at DESC
        LIMIT 100
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
}));

app.get('/api/quality/issues/failed-tokens', asyncHandler(async (req, res) => {
    const query = `
        SELECT a.id, a.asset_name as name, a.policy_id, a.release_title, ps.status
        FROM cip60.assets a
        JOIN cip60.processing_status ps ON a.id = ps.asset_id
        WHERE ps.status = 'failed' OR ps.has_valid_songs = false
        ORDER BY ps.processed_at DESC
        LIMIT 100
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
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
        SELECT s.id, s.title, s.duration, s.validation_status, s.isrc, s.iswc,
               array_agg(DISTINCT jsonb_build_object('name', a.name, 'isni', a.isni)) FILTER (WHERE a.name IS NOT NULL) as artists,
               array_agg(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL) as genres,
               array_agg(DISTINCT jsonb_build_object('id', af.id, 'url', af.file_url, 'type', af.file_type, 'ipfs_cid', af.ipfs_cid)) FILTER (WHERE af.id IS NOT NULL) as audio_files,
               array_agg(DISTINCT jsonb_build_object('id', ast.id, 'name', ast.asset_name, 'policy_id', ast.policy_id, 'release_title', ast.release_title)) FILTER (WHERE ast.id IS NOT NULL) as tokens
        FROM metadata.songs s
        LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
        LEFT JOIN metadata.artists a ON sa.artist_id = a.id
        LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
        LEFT JOIN metadata.genres g ON sg.genre_id = g.id
        LEFT JOIN metadata.audio_files af ON s.id = af.song_id
        LEFT JOIN cip60.assets_songs asongs ON s.id = asongs.song_id
        LEFT JOIN cip60.assets ast ON asongs.asset_id = ast.id
        WHERE s.id = $1
        GROUP BY s.id, s.title, s.duration, s.validation_status, s.isrc, s.iswc
    `;
    
    const result = await pool.query(songQuery, [id]);
    
    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Song not found' });
    }
    
    res.json(result.rows[0]);
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
    const { artists, genres, title, duration, validation_status, isrc, iswc } = changes;
    
    const songUpdates = {};
    if (title !== undefined) songUpdates.title = title;
    if (duration !== undefined) songUpdates.duration = duration;
    if (validation_status !== undefined) songUpdates.validation_status = validation_status;
    if (isrc !== undefined) songUpdates.isrc = isrc;
    if (iswc !== undefined) songUpdates.iswc = iswc;
    
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
            LEFT JOIN cip60.assets_songs asongs ON s.id = asongs.song_id
            WHERE asongs.song_id IS NULL
            ORDER BY s.title LIMIT 100
        `,
        'no-copyright': 'SELECT * FROM find_songs_without_copyright(100)',
        'no-images': 'SELECT * FROM find_songs_without_images(100)',
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
        'orphan-tokens': 'SELECT * FROM find_tokens_without_songs(100)',
        'orphan-images': 'SELECT * FROM find_orphaned_images(100)',
        'unprocessed-tokens': 'SELECT * FROM find_unprocessed_tokens(100)',
        'failed-tokens': 'SELECT * FROM find_failed_tokens(100)',
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
                return { id: row.token_id, name: row.token_name, policy_id: row.policy_id, release_title: row.release_title };
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
            'SELECT asset_id FROM cip60.assets_songs WHERE asset_id = ANY($1) LIMIT 1',
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
        'SELECT count(*) FROM cip60.assets_songs WHERE asset_id = $1',
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
        const result = await pool.query(
            'INSERT INTO metadata.audio_files (song_id, file_url, file_type, ipfs_cid) VALUES ($1, $2, $3, $4) RETURNING *',
            [songId, file_url, file_type, ipfs_cid || null]
        );
        
        res.json({ 
            success: true, 
            audio_file: result.rows[0] 
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

app.post('/api/songs/:songId/tokens/:tokenId/link', asyncHandler(async (req, res) => {
    const { songId, tokenId } = req.params;
    const { is_primary = false } = req.body;
    
    try {
        await pool.query(
            'INSERT INTO cip60.assets_songs (asset_id, song_id, is_primary) VALUES ($1, $2, $3) ON CONFLICT (asset_id, song_id) DO UPDATE SET is_primary = $3',
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
            'DELETE FROM cip60.assets_songs WHERE asset_id = $1 AND song_id = $2',
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
        'SELECT id, asset_name, policy_id, release_title FROM cip60.assets WHERE asset_name ILIKE $1 OR release_title ILIKE $1 ORDER BY asset_name LIMIT 20',
        [`%${q}%`]
    );
    res.json(result.rows);
}));

app.get('/api/contributors', asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, search = '' } = req.query;
    const offset = (page - 1) * limit;
    
    const whereClause = search ? 'WHERE name ILIKE $1' : '';
    const values = search ? [`%${search}%`] : [];
    
    const result = await pool.query(
        `SELECT id, name, ipi, isni FROM metadata.contributors ${whereClause} ORDER BY name LIMIT ${values.length + 1} OFFSET ${values.length + 2}`,
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
            'INSERT INTO metadata.contributors (name, ipi, isni) VALUES ($1, $2, $3) RETURNING *',
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
            'UPDATE metadata.contributors SET name = $1, ipi = $2, isni = $3 WHERE id = $4 RETURNING *',
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
            'SELECT name FROM metadata.contributors WHERE id = ANY($1)',
            [ids]
        );
        
        const deleteResult = await client.query(
            'DELETE FROM metadata.contributors WHERE id = ANY($1)',
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
            'DELETE FROM metadata.contributors WHERE id = $1 RETURNING name',
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

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
});

app.listen(PORT, () => {
    console.log(`Music DB Editor running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to access the editor`);
});