const jwt = require('jsonwebtoken');
const jwksRsa = require('jwks-rsa');
const { logToFile } = require('../utils/logger');
const config = require('../config');

// JWKS client to fetch Microsoft's public signing keys
const jwksClient = jwksRsa({
    jwksUri: `https://login.microsoftonline.com/${config.entra.tenantId}/discovery/v2.0/keys`,
    cache: true,
    cacheMaxAge: 86400000, // 24 hours
    rateLimit: true
});

/**
 * Get signing key from Microsoft JWKS endpoint.
 */
function getSigningKey(header) {
    return new Promise((resolve, reject) => {
        jwksClient.getSigningKey(header.kid, (err, key) => {
            if (err) {
                logToFile(`[Entra] JWKS Error: ${err.message}`);
                return reject(err);
            }
            resolve(key.getPublicKey());
        });
    });
}

/**
 * Verify an Entra ID access token.
 * Returns the decoded token payload (name, email, etc.) if valid.
 */
async function verifyEntraToken(token) {
    // First, decode the header to get the kid (key ID)
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded || !decoded.header) {
        throw new Error('Invalid token format');
    }

    // Get the public key from Microsoft
    const publicKey = await getSigningKey(decoded.header);

    // Verify the token with Microsoft's public key
    return new Promise((resolve, reject) => {
        jwt.verify(token, publicKey, {
            algorithms: ['RS256'],
            issuer: `https://login.microsoftonline.com/${config.entra.tenantId}/v2.0`,
            audience: config.entra.clientId
        }, (err, payload) => {
            if (err) {
                logToFile(`[Entra] Token verification failed: ${err.message}`);
                return reject(err);
            }
            resolve(payload);
        });
    });
}

module.exports = { verifyEntraToken };
