const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER;
const BASIC_AUTH_PASS = process.env.BASIC_AUTH_PASS;

const SYNC_AUTH_USER = (process.env.SYNC_AUTH_USER || 'Bevpro101').trim();
const SYNC_AUTH_PASS = (process.env.SYNC_AUTH_PASS || 'Bevpro2017@').trim();

/**
 * Middleware to validate Basic Authentication.
 * Expects: Authorization: Basic <base64(username:password)>
 * Returns WWW-Authenticate header so browsers show login popup.
 */
function validateBasicAuth(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
        res.set('WWW-Authenticate', 'Basic realm="Request Status API"');
        return res.status(401).json({ STATUS: 'ERROR', MESSAGE: 'Access denied. No credentials provided.' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Basic') {
        res.set('WWW-Authenticate', 'Basic realm="Request Status API"');
        return res.status(401).json({ STATUS: 'ERROR', MESSAGE: 'Access denied. Invalid authorization format. Use: Basic <base64(username:password)>' });
    }

    if (!BASIC_AUTH_USER || !BASIC_AUTH_PASS) {
        console.error('[Auth] BASIC_AUTH_USER or BASIC_AUTH_PASS is not defined in environment variables.');
        return res.status(500).json({ STATUS: 'ERROR', MESSAGE: 'Server configuration error.' });
    }

    try {
        const decoded = Buffer.from(parts[1], 'base64').toString('utf-8');
        const [username, password] = decoded.split(':');

        if (username === BASIC_AUTH_USER && password === BASIC_AUTH_PASS) {
            next();
        } else {
            res.set('WWW-Authenticate', 'Basic realm="Request Status API"');
            return res.status(401).json({ STATUS: 'ERROR', MESSAGE: 'Invalid credentials.' });
        }
    } catch (err) {
        res.set('WWW-Authenticate', 'Basic realm="Request Status API"');
        return res.status(401).json({ STATUS: 'ERROR', MESSAGE: 'Invalid authorization header.' });
    }
}

/**
 * Middleware to validate Basic Authentication for Sync Endpoints.
 * Expects: Authorization: Basic <base64(username:password)>
 */
function validateSyncBasicAuth(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
        res.set('WWW-Authenticate', 'Basic realm="Sync API"');
        return res.status(401).json({ STATUS: 'ERROR', MESSAGE: 'Access denied. No credentials provided.' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Basic') {
        res.set('WWW-Authenticate', 'Basic realm="Sync API"');
        return res.status(401).json({ STATUS: 'ERROR', MESSAGE: 'Access denied. Invalid authorization format. Use: Basic <base64(username:password)>' });
    }

    try {
        const decoded = Buffer.from(parts[1], 'base64').toString('utf-8');
        const [username, password] = decoded.split(':');

        if (username.trim() === SYNC_AUTH_USER && password.trim() === SYNC_AUTH_PASS) {
            next();
        } else {
            console.log(`[Auth] Sync API login failed for user: '${username}'`);
            res.set('WWW-Authenticate', 'Basic realm="Sync API"');
            return res.status(401).json({ STATUS: 'ERROR', MESSAGE: 'Invalid credentials.' });
        }
    } catch (err) {
        res.set('WWW-Authenticate', 'Basic realm="Sync API"');
        return res.status(401).json({ STATUS: 'ERROR', MESSAGE: 'Invalid authorization header.' });
    }
}

module.exports = { validateBasicAuth, validateSyncBasicAuth };
