import { APIClient } from './api.js';

const RECONNECT_INTERVAL_MS = 4000;
// Once polling has taken over, retry the WebSocket less often
const FALLBACK_RECONNECT_INTERVAL_MS = 30000;
const POLL_INTERVAL_MS = 5000;
// Slots of lag still treated as synced (roughly one block interval)
const SYNCED_SLOT_TOLERANCE = 60;

function formatNumber(value) {
    return typeof value === 'number' ? value.toLocaleString() : '-';
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

export class IndexerPanel {
    static socket = null;
    static reconnectTimer = null;
    static relayConnected = false;
    static upstreamConnected = null;
    static synced = null;
    // HTTP polling stands in when a proxy or tunnel won't carry the WebSocket (common over WAN)
    static pollTimer = null;
    static pollConnected = false;

    static init() {
        IndexerPanel.connect();
    }

    static connect() {
        const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
        const socket = new WebSocket(`${protocol}${location.host}/ws/indexer`);
        IndexerPanel.socket = socket;

        socket.addEventListener('open', () => {
            IndexerPanel.relayConnected = true;
            IndexerPanel.stopPolling();
            IndexerPanel.renderStatus();
        });

        socket.addEventListener('message', (event) => {
            try {
                const message = JSON.parse(event.data);
                IndexerPanel.handleMessage(message);
            } catch (error) {
                console.error('Failed to parse indexer message:', error);
            }
        });

        socket.addEventListener('close', () => {
            IndexerPanel.relayConnected = false;
            IndexerPanel.startPolling();
            IndexerPanel.renderStatus();
            IndexerPanel.scheduleReconnect();
        });

        socket.addEventListener('error', () => {
            socket.close();
        });
    }

    static scheduleReconnect() {
        if (IndexerPanel.reconnectTimer) return;
        const delay = IndexerPanel.pollConnected ? FALLBACK_RECONNECT_INTERVAL_MS : RECONNECT_INTERVAL_MS;
        IndexerPanel.reconnectTimer = setTimeout(() => {
            IndexerPanel.reconnectTimer = null;
            IndexerPanel.connect();
        }, delay);
    }

    static startPolling() {
        if (IndexerPanel.pollTimer) return;
        IndexerPanel.poll();
        IndexerPanel.pollTimer = setInterval(IndexerPanel.poll, POLL_INTERVAL_MS);
    }

    static stopPolling() {
        clearInterval(IndexerPanel.pollTimer);
        IndexerPanel.pollTimer = null;
        IndexerPanel.pollConnected = false;
    }

    static async poll() {
        try {
            const status = await APIClient.get('/api/indexer/status');
            if (!IndexerPanel.pollTimer) return; // WebSocket took over while this was in flight
            IndexerPanel.pollConnected = true;
            IndexerPanel.upstreamConnected = status.enabled ? status.upstreamConnected : false;
            status.messages.forEach(message => IndexerPanel.handleMessage(message));
        } catch (error) {
            IndexerPanel.pollConnected = false;
        }
        IndexerPanel.renderStatus();
    }

    static handleMessage(message) {
        if (message.type === 'progress') {
            IndexerPanel.renderProgress(message.data);
        } else if (message.type === 'ogmios-health') {
            IndexerPanel.renderOgmiosHealth(message.data);
        } else if (message.type === 'relay-status') {
            IndexerPanel.upstreamConnected = message.data.connected;
            IndexerPanel.renderStatus();
        }
    }

    // Collapses relay, upstream, and sync state into the single header badge.
    static renderStatus() {
        let label;
        let statusClass;

        const reachable = IndexerPanel.relayConnected || IndexerPanel.pollConnected;

        if (!reachable) {
            label = 'Relay offline';
            statusClass = 'disconnected';
        } else if (IndexerPanel.upstreamConnected === false) {
            label = 'Indexer unreachable';
            statusClass = 'disconnected';
        } else if (IndexerPanel.synced !== null) {
            label = IndexerPanel.synced ? 'Synced' : 'Syncing';
            statusClass = IndexerPanel.synced ? 'caught_up' : 'syncing';
        } else if (IndexerPanel.upstreamConnected) {
            label = 'Connected';
            statusClass = 'connected';
        } else {
            label = 'Connecting...';
            statusClass = 'connecting';
        }

        const badge = document.getElementById('indexerStatus');
        if (badge) {
            badge.textContent = label;
            badge.className = `status-badge status-${statusClass}`;
            badge.title = IndexerPanel.relayConnected ? 'Live (WebSocket)'
                : IndexerPanel.pollConnected ? `Polling every ${POLL_INTERVAL_MS / 1000}s (WebSocket unavailable)` : '';
        }

        const header = document.getElementById('indexerHeader');
        if (header) {
            const offline = !reachable || IndexerPanel.upstreamConnected === false;
            header.classList.toggle('indexer-offline', offline);
        }
    }

    static renderProgress(data) {
        setText('indexerCurrentSlot', formatNumber(data.currentSlot));
        setText('indexerNetworkTip', formatNumber(data.networkTip));

        if (data.currentSlot && data.networkTip) {
            const percent = Math.min(100, (data.currentSlot / data.networkTip) * 100);
            IndexerPanel.setProgressBar(percent);
            IndexerPanel.synced = data.networkTip - data.currentSlot <= SYNCED_SLOT_TOLERANCE;
            IndexerPanel.renderStatus();
        }
    }

    static setProgressBar(percent) {
        const bar = document.getElementById('indexerProgressBarFill');
        if (bar) bar.style.width = `${percent.toFixed(2)}%`;
        setText('indexerProgressPercent', `${percent.toFixed(2)}%`);
    }

    // Fields mirror Ogmios' GET /health response, relayed by the db-edit server.
    static renderOgmiosHealth(health) {
        const row = document.getElementById('ogmiosHealthRow');
        if (row) row.hidden = false;

        const statusEl = document.getElementById('ogmiosConnectionStatus');
        if (!health || !health.reachable) {
            if (statusEl) {
                statusEl.textContent = 'unreachable';
                statusEl.className = 'ogmios-unreachable';
            }
            return;
        }

        if (statusEl) {
            statusEl.textContent = health.connectionStatus ?? '-';
            statusEl.className = health.connectionStatus === 'connected' ? '' : 'ogmios-unreachable';
        }

        const sync = health.networkSynchronization;
        setText('ogmiosNetworkSync', typeof sync === 'number' ? `${(sync * 100).toFixed(2)}%` : '-');
        setText('ogmiosNetwork', health.network ?? '-');
        setText('ogmiosEra', health.currentEra ?? '-');
        setText('ogmiosEpoch', health.currentEpoch !== undefined
            ? `${formatNumber(health.currentEpoch)} (slot ${formatNumber(health.slotInEpoch)})`
            : '-');
        setText('ogmiosBlockHeight', formatNumber(health.lastKnownTip?.height));
        setText('ogmiosLastTipUpdate', health.lastTipUpdate ? new Date(health.lastTipUpdate).toLocaleTimeString() : '-');
        setText('ogmiosVersion', health.version ? `Ogmios ${health.version}` : '-');
    }
}
