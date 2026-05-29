const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Middleware to validate JWT token from Authorization header.
 * Expects: Authorization: Bearer <token>
 */
function validateJwt(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({ error: 'Access denied. Invalid authorization format. Use: Bearer <token>' });
    }

    const token = parts[1];

    if (!JWT_SECRET) {
        console.error('[Auth] JWT_SECRET is not defined in environment variables.');
        return res.status(500).json({ error: 'Server configuration error.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired.' });
        }
        return res.status(401).json({ error: 'Invalid token.' });
    }
}

module.exports = { validateJwt };
