const WebSocket = require('ws');
const { WebSocketServer } = require('ws');

const RELAY_PATH = '/ws/indexer';

// INDEXER_WS_URL wins if set; otherwise the URL is built from INDEXER_HOST/INDEXER_PORT
// (INDEXER_PORT should match arp-indexer's PROGRESS_PORT).
function getIndexerConfig(env = process.env) {
    const enabled = !['false', '0', 'off', 'no'].includes(String(env.INDEXER_ENABLED ?? 'true').toLowerCase());
    const host = env.INDEXER_HOST || 'localhost';
    const port = env.INDEXER_PORT || '3001';
    const url = env.INDEXER_WS_URL || `ws://${host}:${port}`;
    const reconnectMs = parseInt(env.INDEXER_RECONNECT_MS, 10) || 5000;
    // Ogmios /health polling is optional; unset OGMIOS_HEALTH_URL disables it.
    const ogmiosHealthUrl = env.OGMIOS_HEALTH_URL || null;
    const ogmiosHealthIntervalMs = parseInt(env.OGMIOS_HEALTH_INTERVAL_MS, 10) || 10000;
    return { enabled, url, reconnectMs, ogmiosHealthUrl, ogmiosHealthIntervalMs };
}

class IndexerRelay {
    constructor(upstreamUrl, reconnectMs) {
        this.upstreamUrl = upstreamUrl;
        this.reconnectMs = reconnectMs;
        this.upstream = null;
        this.reconnectTimer = null;
        // Latest message per type, so a new client gets both stats and progress immediately
        this.lastMessages = new Map();
        this.wss = new WebSocketServer({ noServer: true });
        this.clients = new Set();

        this.wss.on('connection', (ws) => {
            this.clients.add(ws);

            this.lastMessages.forEach((message) => ws.send(message));
            ws.send(JSON.stringify({ type: 'relay-status', data: { connected: this._upstreamConnected() } }));

            ws.on('close', () => this.clients.delete(ws));
            ws.on('error', () => this.clients.delete(ws));
        });

        this._connectUpstream();
    }

    _upstreamConnected() {
        return !!this.upstream && this.upstream.readyState === WebSocket.OPEN;
    }

    _connectUpstream() {
        console.log(`[indexer-relay] connecting to ${this.upstreamUrl}`);
        const upstream = new WebSocket(this.upstreamUrl);
        this.upstream = upstream;

        upstream.on('open', () => {
            console.log('[indexer-relay] connected to indexer progress server');
            this._broadcastLocal({ type: 'relay-status', data: { connected: true } });
        });

        upstream.on('message', (data) => {
            const message = data.toString();
            try {
                const { type } = JSON.parse(message);
                if (type) this.lastMessages.set(type, message);
            } catch {
                // Non-JSON payloads are relayed but not cached
            }
            this._broadcastRaw(message);
        });

        upstream.on('error', (err) => {
            console.warn('[indexer-relay] upstream error:', err.message || err.code);
        });

        upstream.on('close', () => {
            this._broadcastLocal({ type: 'relay-status', data: { connected: false } });
            this._scheduleReconnect();
        });
    }

    _scheduleReconnect() {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._connectUpstream();
        }, this.reconnectMs);
    }

    _broadcastRaw(message) {
        this.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    _broadcastLocal(message) {
        this._broadcastRaw(JSON.stringify(message));
    }

    // Broadcasts a locally-sourced message and caches it for newly-connecting clients.
    publish(type, data) {
        const message = JSON.stringify({ type, data });
        this.lastMessages.set(type, message);
        this._broadcastRaw(message);
    }

    startOgmiosHealthPolling(url, intervalMs) {
        const poll = async () => {
            try {
                const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                this.publish('ogmios-health', { reachable: true, ...(await response.json()) });
            } catch (err) {
                console.warn('[indexer-relay] ogmios health error:', err.message || err.code);
                this.publish('ogmios-health', { reachable: false });
            }
        };
        console.log(`[indexer-relay] polling ogmios health at ${url} every ${intervalMs}ms`);
        poll();
        this.ogmiosHealthTimer = setInterval(poll, intervalMs);
    }

    handleUpgrade(request, socket, head) {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss.emit('connection', ws, request);
        });
    }

    close() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.ogmiosHealthTimer) clearInterval(this.ogmiosHealthTimer);
        if (this.upstream) this.upstream.terminate();
        this.clients.forEach((client) => client.terminate());
        this.clients.clear();
        this.wss.close();
    }
}

function attachIndexerRelay(server, config = getIndexerConfig()) {
    const relay = config.enabled ? new IndexerRelay(config.url, config.reconnectMs) : null;
    if (relay && config.ogmiosHealthUrl) {
        relay.startOgmiosHealthPolling(config.ogmiosHealthUrl, config.ogmiosHealthIntervalMs);
    }

    server.on('upgrade', (request, socket, head) => {
        const { pathname } = new URL(request.url, `http://${request.headers.host}`);
        if (pathname !== RELAY_PATH) return;
        if (relay) {
            relay.handleUpgrade(request, socket, head);
        } else {
            socket.destroy();
        }
    });

    return relay;
}

module.exports = { attachIndexerRelay, getIndexerConfig, RELAY_PATH };
