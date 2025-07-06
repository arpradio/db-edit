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
        SELECT DISTINCT s.id, s.title, s.duration, s.validation_status,
               array_agg(DISTINCT a.name) FILTER (WHERE a.name IS NOT NULL) as artists,
               array_agg(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL) as genres
        FROM metadata.songs s
        LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
        LEFT JOIN metadata.artists a ON sa.artist_id = a.id
        LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
        LEFT JOIN metadata.genres g ON sg.genre_id = g.id
        WHERE s.title ILIKE $1 OR a.name ILIKE $1 OR g.name ILIKE $1
        GROUP BY s.id, s.title, s.duration, s.validation_status
        ORDER BY s.title
        LIMIT 50
    `;
    
    const result = await pool.query(query, [`%${q}%`]);
    res.json(result.rows);
}));

app.get('/api/artists/search', asyncHandler(async (req, res) => {
    const { q } = req.query;
    const result = await pool.query(
        'SELECT id, name FROM metadata.artists WHERE name ILIKE $1 ORDER BY name LIMIT 20',
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

app.get('/api/songs/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    const songQuery = `
        SELECT s.id, s.title, s.duration, s.validation_status,
               array_agg(DISTINCT a.name) FILTER (WHERE a.name IS NOT NULL) as artists,
               array_agg(DISTINCT g.name) FILTER (WHERE g.name IS NOT NULL) as genres
        FROM metadata.songs s
        LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
        LEFT JOIN metadata.artists a ON sa.artist_id = a.id
        LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
        LEFT JOIN metadata.genres g ON sg.genre_id = g.id
        WHERE s.id = $1
        GROUP BY s.id, s.title, s.duration, s.validation_status
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
    const { artists, genres, title, duration, validation_status } = changes;
    
    const songUpdates = {};
    if (title !== undefined) songUpdates.title = title;
    if (duration !== undefined) songUpdates.duration = duration;
    if (validation_status !== undefined) songUpdates.validation_status = validation_status;
    
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
            const role = typeof artistData === 'object' ? artistData.role || 'primary' : 'primary';
            
            let artistResult = await client.query(
                'SELECT id FROM metadata.artists WHERE name = $1',
                [artistName]
            );
            
            if (artistResult.rows.length === 0) {
                artistResult = await client.query(
                    'INSERT INTO metadata.artists (name) VALUES ($1) RETURNING id',
                    [artistName]
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
        `
    };
    
    query = queries[type];
    if (!query) {
        return res.status(400).json({ error: 'Invalid issue type' });
    }
    
    const result = await pool.query(query);
    
    const normalizedRows = result.rows.map(row => {
        if (row.song_id && row.song_title) {
            return { id: row.song_id, title: row.song_title };
        }
        return row;
    });
    
    res.json(normalizedRows);
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

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
});

app.listen(PORT, () => {
    console.log(`Music DB Editor running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to access the editor`);
});