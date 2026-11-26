// Login security: one admin account configured through .env, in-memory sessions
// held in an HttpOnly cookie, login rate limiting, and an Origin check on writes.
const crypto = require('crypto');
const path = require('path');
const express = require('express');

const COOKIE_NAME = 'dbedit_session';
const SCRYPT_KEYLEN = 64;
const IDLE_TIMEOUT_MS = (parseInt(process.env.SESSION_IDLE_MINUTES, 10) || 60) * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = (parseInt(process.env.SESSION_MAX_HOURS, 10) || 12) * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const sessions = new Map();       // token -> { username, createdAt, lastSeen }
const failedLogins = new Map();   // ip -> { count, firstAt, lockedUntil }

// Format: scrypt$<salt hex>$<hash hex>
function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
    const [scheme, saltHex, hashHex] = (stored || '').split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
}

function safeEqualStrings(a, b) {
    // Hash first so lengths match and comparison time doesn't leak the username
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function getAuthConfig() {
    return {
        disabled: process.env.AUTH_DISABLED === 'true',
        username: process.env.ADMIN_USERNAME || '',
        passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
        secureCookie: process.env.COOKIE_SECURE
            ? process.env.COOKIE_SECURE === 'true'
            : process.env.NODE_ENV === 'production'
    };
}

function assertAuthConfigured(config) {
    if (config.disabled) {
        console.warn('WARNING: AUTH_DISABLED=true — the editor is open to anyone who can reach it.');
        return;
    }
    if (!config.username || !config.passwordHash.startsWith('scrypt$')) {
        console.error('Login is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH in .env.');
        console.error('Generate the hash with:  npm run hash-password');
        process.exit(1);
    }
}

function parseCookies(header) {
    const out = {};
    (header || '').split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx < 0) return;
        out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    return out;
}

function getSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;

    const now = Date.now();
    if (now - session.lastSeen > IDLE_TIMEOUT_MS || now - session.createdAt > ABSOLUTE_TIMEOUT_MS) {
        sessions.delete(token);
        return null;
    }
    session.lastSeen = now;
    return { token, ...session };
}

function setSessionCookie(res, token, secure) {
    const parts = [
        `${COOKIE_NAME}=${token}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        `Max-Age=${Math.floor(ABSOLUTE_TIMEOUT_MS / 1000)}`
    ];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res, secure) {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
}

function clientIp(req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

function isLockedOut(ip) {
    const entry = failedLogins.get(ip);
    if (!entry) return 0;
    if (entry.lockedUntil && entry.lockedUntil > Date.now()) return entry.lockedUntil - Date.now();
    if (Date.now() - entry.firstAt > LOCKOUT_MS) failedLogins.delete(ip);
    return 0;
}

function recordFailure(ip) {
    const now = Date.now();
    const entry = failedLogins.get(ip) || { count: 0, firstAt: now, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILED_ATTEMPTS) entry.lockedUntil = now + LOCKOUT_MS;
    failedLogins.set(ip, entry);
}

// Periodically drop expired sessions and stale rate-limit entries
setInterval(() => {
    const now = Date.now();
    for (const [token, s] of sessions) {
        if (now - s.lastSeen > IDLE_TIMEOUT_MS || now - s.createdAt > ABSOLUTE_TIMEOUT_MS) sessions.delete(token);
    }
    for (const [ip, e] of failedLogins) {
        if (now - e.firstAt > LOCKOUT_MS && (!e.lockedUntil || e.lockedUntil < now)) failedLogins.delete(ip);
    }
}, 5 * 60 * 1000).unref();

function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
}

// Blocks cross-site writes: a state-changing request must come from this same origin
function sameOriginWrites(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin) return next(); // non-browser clients; the session cookie still applies
    try {
        const originUrl = new URL(origin);
        if (originUrl.host === req.headers.host) return next();
        // Behind a reverse proxy (TRUST_PROXY set) the Host header may be rewritten;
        // req.hostname then reflects X-Forwarded-Host, the name the browser actually used
        if (req.app.get('trust proxy') && originUrl.hostname === req.hostname) return next();
    } catch { /* fall through */ }
    res.status(403).json({ error: 'Cross-origin request blocked' });
}

function createAuth(config = getAuthConfig()) {
    const router = express.Router();
    const loginPage = path.join(__dirname, '..', 'public', 'login.html');

    router.get('/login', (req, res) => {
        if (config.disabled || getSession(req)) return res.redirect('/');
        res.sendFile(loginPage);
    });

    router.post('/api/auth/login', express.json(), (req, res) => {
        if (config.disabled) return res.json({ success: true });

        const ip = clientIp(req);
        const waitMs = isLockedOut(ip);
        if (waitMs) {
            return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(waitMs / 60000)} minute(s).` });
        }

        const { username = '', password = '' } = req.body || {};
        const userOk = safeEqualStrings(username, config.username);
        // Always run the password check so a wrong username costs the same time
        const passOk = verifyPassword(String(password), config.passwordHash);

        if (!userOk || !passOk) {
            recordFailure(ip);
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        failedLogins.delete(ip);
        const token = crypto.randomBytes(32).toString('hex');
        const now = Date.now();
        sessions.set(token, { username: config.username, createdAt: now, lastSeen: now });
        setSessionCookie(res, token, config.secureCookie);
        res.json({ success: true, username: config.username });
    });

    router.post('/api/auth/logout', (req, res) => {
        const session = getSession(req);
        if (session) sessions.delete(session.token);
        clearSessionCookie(res, config.secureCookie);
        res.json({ success: true });
    });

    router.get('/api/auth/me', (req, res) => {
        if (config.disabled) return res.json({ username: null, authDisabled: true });
        const session = getSession(req);
        if (!session) return res.status(401).json({ error: 'Not logged in' });
        res.json({ username: session.username });
    });

    // Everything registered after this requires a session
    function requireAuth(req, res, next) {
        if (config.disabled) return next();
        // Assets the login page itself needs
        if (req.path === '/css/styles.css' || req.path === '/arpradio.png') return next();
        if (getSession(req)) return next();

        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Not logged in' });
        }
        res.redirect('/login');
    }

    function isUpgradeAuthorized(request) {
        return config.disabled || Boolean(getSession(request));
    }

    return { router, requireAuth, isUpgradeAuthorized };
}

module.exports = {
    createAuth,
    getAuthConfig,
    assertAuthConfigured,
    hashPassword,
    securityHeaders,
    sameOriginWrites
};
