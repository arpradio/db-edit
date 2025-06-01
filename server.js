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

// === SEARCH ENDPOINTS ===

app.get('/api/songs/search', async (req, res) => {
  try {
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
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/artists/search', async (req, res) => {
  try {
    const { q } = req.query;
    const result = await pool.query(
      'SELECT id, name FROM metadata.artists WHERE name ILIKE $1 ORDER BY name LIMIT 20',
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Artist search error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/genres/search', async (req, res) => {
  try {
    const { q } = req.query;
    const result = await pool.query(
      'SELECT id, name FROM metadata.genres WHERE name ILIKE $1 ORDER BY name LIMIT 20',
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Genre search error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// === SONG ENDPOINTS ===

app.get('/api/songs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const songQuery = `
      SELECT s.*, 
             array_agg(DISTINCT jsonb_build_object('name', a.name, 'role', sa.role)) 
               FILTER (WHERE a.id IS NOT NULL) as artists,
             array_agg(DISTINCT g.name) FILTER (WHERE g.id IS NOT NULL) as genres
      FROM metadata.songs s
      LEFT JOIN metadata.song_artists sa ON s.id = sa.song_id
      LEFT JOIN metadata.artists a ON sa.artist_id = a.id
      LEFT JOIN metadata.song_genres sg ON s.id = sg.song_id
      LEFT JOIN metadata.genres g ON sg.genre_id = g.id
      WHERE s.id = $1
      GROUP BY s.id
    `;
    
    const result = await pool.query(songQuery, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get song error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/songs/:id/update', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { artists, genres, title, duration, validation_status } = req.body;
    
    const songUpdates = {};
    if (title !== undefined) songUpdates.title = title;
    if (duration !== undefined) songUpdates.duration = duration;
    if (validation_status !== undefined) songUpdates.validation_status = validation_status;
    
    if (Object.keys(songUpdates).length > 0) {
      const updateFields = Object.keys(songUpdates).map((key, index) => `${key} = $${index + 2}`).join(', ');
      const updateValues = [id, ...Object.values(songUpdates)];
      
      await client.query(
        `UPDATE metadata.songs SET ${updateFields}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        updateValues
      );
    }
    
    if (artists) {
      await client.query('DELETE FROM metadata.song_artists WHERE song_id = $1', [id]);
      
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
          [id, artistId, role]
        );
      }
    }
    
    if (genres) {
      await client.query('DELETE FROM metadata.song_genres WHERE song_id = $1', [id]);
      
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
          [id, genreId]
        );
      }
    }
    
    await client.query('COMMIT');
    
    res.json({ success: true, message: 'Song updated successfully' });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update error:', err);
    res.status(500).json({ error: 'Failed to update song' });
  } finally {
    client.release();
  }
});

// === QUALITY & STATS ENDPOINTS ===

app.get('/api/quality/counts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM get_quality_counts()');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Quality counts error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.get('/api/quality/issues/:type', async (req, res) => {
  try {
    const { type } = req.params;
    let query;
    
    switch (type) {
      case 'no-artists':
        query = 'SELECT * FROM find_songs_without_artists(100)';
        break;
        
      case 'no-genres':
        query = 'SELECT * FROM find_songs_without_genres(100)';
        break;
        
      case 'no-audio':
        query = `
          SELECT s.id as song_id, s.title as song_title
          FROM metadata.songs s
          LEFT JOIN metadata.audio_files af ON s.id = af.song_id
          WHERE af.song_id IS NULL
          ORDER BY s.title LIMIT 100
        `;
        break;
        
      case 'no-duration':
        query = `
          SELECT s.id as song_id, s.title as song_title
          FROM metadata.songs s
          WHERE s.duration IS NULL OR trim(s.duration) = ''
          ORDER BY s.title LIMIT 100
        `;
        break;
        
      case 'orphan-artists':
        query = `
          SELECT a.id, a.name
          FROM metadata.artists a
          LEFT JOIN metadata.song_artists sa ON a.id = sa.artist_id
          WHERE sa.artist_id IS NULL
          ORDER BY a.name LIMIT 100
        `;
        break;
        
      case 'orphan-genres':
        query = `
          SELECT g.id, g.name
          FROM metadata.genres g
          LEFT JOIN metadata.song_genres sg ON g.id = sg.genre_id
          WHERE sg.genre_id IS NULL
          ORDER BY g.name LIMIT 100
        `;
        break;
        
      default:
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
  } catch (err) {
    console.error('Quality issues error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM get_song_stats()');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.get('/api/debug/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM test_database_health()');
    res.json({
      status: 'connected',
      tests: result.rows
    });
  } catch (err) {
    console.error('Health check error:', err);
    res.status(500).json({ 
      status: 'error',
      error: err.message,
      code: err.code
    });
  }
});

// === BULK DELETE ENDPOINTS (MUST COME BEFORE SINGLE DELETE) ===

app.delete('/api/artists/bulk-delete', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { ids } = req.body;
    console.log('Bulk delete artists request:', { ids });
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty IDs array' });
    }
    
    // Check if any artists have associated songs
    const checkResult = await client.query(
      'SELECT artist_id FROM metadata.song_artists WHERE artist_id = ANY($1) LIMIT 1',
      [ids]
    );
    
    if (checkResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'Cannot delete artists with associated songs',
        conflictingId: checkResult.rows[0].artist_id
      });
    }
    
    // Get artist names for response
    const namesResult = await client.query(
      'SELECT name FROM metadata.artists WHERE id = ANY($1)',
      [ids]
    );
    
    // Delete all artists
    const deleteResult = await client.query(
      'DELETE FROM metadata.artists WHERE id = ANY($1)',
      [ids]
    );
    
    await client.query('COMMIT');
    
    console.log('Bulk delete success:', deleteResult.rowCount);
    
    res.json({ 
      success: true, 
      message: `Successfully deleted ${deleteResult.rowCount} artists`,
      deletedCount: deleteResult.rowCount,
      deletedNames: namesResult.rows.map(row => row.name)
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk delete artists error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  } finally {
    client.release();
  }
});

app.delete('/api/genres/bulk-delete', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { ids } = req.body;
    console.log('Bulk delete genres request:', { ids });
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Invalid or empty IDs array' });
    }
    
    // Check if any genres have associated songs
    const checkResult = await client.query(
      'SELECT genre_id FROM metadata.song_genres WHERE genre_id = ANY($1) LIMIT 1',
      [ids]
    );
    
    if (checkResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'Cannot delete genres with associated songs',
        conflictingId: checkResult.rows[0].genre_id
      });
    }
    
    // Get genre names for response
    const namesResult = await client.query(
      'SELECT name FROM metadata.genres WHERE id = ANY($1)',
      [ids]
    );
    
    // Delete all genres
    const deleteResult = await client.query(
      'DELETE FROM metadata.genres WHERE id = ANY($1)',
      [ids]
    );
    
    await client.query('COMMIT');
    
    console.log('Bulk delete success:', deleteResult.rowCount);
    
    res.json({ 
      success: true, 
      message: `Successfully deleted ${deleteResult.rowCount} genres`,
      deletedCount: deleteResult.rowCount,
      deletedNames: namesResult.rows.map(row => row.name)
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk delete genres error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  } finally {
    client.release();
  }
});

// === SINGLE DELETE ENDPOINTS (MUST COME AFTER BULK DELETE) ===

app.delete('/api/artists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Single delete artist request:', { id });
    
    // Check if artist has any songs
    const checkResult = await pool.query(
      'SELECT count(*) FROM metadata.song_artists WHERE artist_id = $1',
      [id]
    );
    
    if (parseInt(checkResult.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete artist with associated songs' });
    }
    
    const result = await pool.query(
      'DELETE FROM metadata.artists WHERE id = $1 RETURNING name',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Artist not found' });
    }
    
    res.json({ success: true, message: `Artist "${result.rows[0].name}" deleted successfully` });
  } catch (err) {
    console.error('Delete artist error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

app.delete('/api/genres/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Single delete genre request:', { id });
    
    // Check if genre has any songs
    const checkResult = await pool.query(
      'SELECT count(*) FROM metadata.song_genres WHERE genre_id = $1',
      [id]
    );
    
    if (parseInt(checkResult.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete genre with associated songs' });
    }
    
    const result = await pool.query(
      'DELETE FROM metadata.genres WHERE id = $1 RETURNING name',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Genre not found' });
    }
    
    res.json({ success: true, message: `Genre "${result.rows[0].name}" deleted successfully` });
  } catch (err) {
    console.error('Delete genre error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// === START SERVER ===

app.listen(PORT, () => {
  console.log(`Music DB Editor running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to access the editor`);
  console.log('\nAPI Routes loaded in this order:');
  console.log('  DELETE /api/artists/bulk-delete (bulk operations)');
  console.log('  DELETE /api/genres/bulk-delete (bulk operations)');
  console.log('  DELETE /api/artists/:id (single operations)');
  console.log('  DELETE /api/genres/:id (single operations)');
});