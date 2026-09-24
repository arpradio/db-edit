require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { attachIndexerRelay, getIndexerConfig, RELAY_PATH } = require('./lib/indexerRelay');

const app = express();
const PORT = process.env.PORT || 3000;
const indexerConfig = getIndexerConfig();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use('/api/songs', require('./routes/songs'));
app.use('/api/artists', require('./routes/artists'));
app.use('/api/genres', require('./routes/genres'));
app.use('/api/tokens', require('./routes/tokens'));
app.use('/api/assets', require('./routes/assets'));
app.use('/api/images', require('./routes/images'));
app.use('/api/audio-files', require('./routes/audio-files'));
app.use('/api/contributors', require('./routes/contributors'));
app.use('/api/quality', require('./routes/quality'));
app.use('/api', require('./routes/stats'));

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
});

const server = http.createServer(app);
attachIndexerRelay(server, indexerConfig);

server.listen(PORT, () => {
    console.log(`Music DB Editor running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to access the editor`);
    if (indexerConfig.enabled) {
        console.log(`Relaying indexer progress from ${indexerConfig.url} at ws://localhost:${PORT}${RELAY_PATH}`);
    } else {
        console.log('Indexer relay disabled (INDEXER_ENABLED=false)');
    }
});
