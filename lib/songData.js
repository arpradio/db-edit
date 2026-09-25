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

module.exports = { updateSongData };
