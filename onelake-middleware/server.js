const express = require('express');
const crypto = require('crypto');
global.crypto = crypto;
const cors = require('cors');
const config = require('./src/config');
const { logToFile } = require('./src/utils/logger');

const apiRoutes = require('./src/routes/api');
const { validateJwt } = require('./src/middleware/authMiddleware');
const { validateBasicAuth, validateSyncBasicAuth } = require('./src/middleware/basicAuthMiddleware');
const fsrProtalController = require('./src/controllers/fsrProtalController_graphql');

const app = express();

// Middleware
app.use(cors()); // Allow all origins
app.use(express.json({ limit: '100mb' }));

// Swagger API Docs (public - no auth required)
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./src/config/swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'OneLake Middleware API Docs',
    customCss: '.swagger-ui .topbar { display: none }'
}));

// Test Login Page (public)
const path = require('path');
app.get('/test-login', (req, res) => res.sendFile(path.join(__dirname, 'test_login.html')));

// Routes with Basic Auth (registered before JWT middleware)
app.get('/api/request-status/:referencedPoNumber', validateBasicAuth, (req, res) => fsrProtalController.getRequestStatus(req, res));

// Sync Data Route (Protected by Basic Auth for easy automated triggering)
const syncController = require('./src/controllers/syncController');
app.post('/api/sync/service-order-table-sync', validateSyncBasicAuth, (req, res) => syncController.syncServiceOrderTable(req, res));
app.post('/api/sync/service-order-line-sync', validateSyncBasicAuth, (req, res) => syncController.syncServiceOrderLine(req, res));
app.post('/api/sync/service-object-table-sync', validateSyncBasicAuth, (req, res) => syncController.syncServiceObjectTable(req, res));
app.post('/api/sync/pickingroute-sync', validateSyncBasicAuth, (req, res) => syncController.syncPickingroute(req, res));
app.post('/api/sync/reasontable-sync', validateSyncBasicAuth, (req, res) => syncController.syncReasontable(req, res));
app.post('/api/sync/logisticspostaladdress-sync', validateSyncBasicAuth, (req, res) => syncController.syncLogisticspostaladdress(req, res));
app.post('/api/sync/logisticslocation-sync', validateSyncBasicAuth, (req, res) => syncController.syncLogisticslocation(req, res));
app.post('/api/sync/inventtransorigin-sync', validateSyncBasicAuth, (req, res) => syncController.syncInventtransorigin(req, res));
app.post('/api/sync/inventtransfertable-sync', validateSyncBasicAuth, (req, res) => syncController.syncInventtransfertable(req, res));
app.post('/api/sync/inventtransferline-sync', validateSyncBasicAuth, (req, res) => syncController.syncInventtransferline(req, res));
app.post('/api/sync/inventtrans-sync', validateSyncBasicAuth, (req, res) => syncController.syncInventtrans(req, res));
app.post('/api/sync/inventtable-sync', validateSyncBasicAuth, (req, res) => syncController.syncInventtable(req, res));
app.post('/api/sync/inventsum-sync', validateSyncBasicAuth, (req, res) => syncController.syncInventsum(req, res));
app.post('/api/sync/hcmworker-sync', validateSyncBasicAuth, (req, res) => syncController.syncHcmworker(req, res));
app.post('/api/sync/dirpersonname-sync', validateSyncBasicAuth, (req, res) => syncController.syncDirpersonname(req, res));
app.post('/api/sync/dirperson-sync', validateSyncBasicAuth, (req, res) => syncController.syncDirperson(req, res));
app.post('/api/sync/custtable-sync', validateSyncBasicAuth, (req, res) => syncController.syncCusttable(req, res));
app.post('/api/sync/maintenanceactivitytype-sync', validateSyncBasicAuth, (req, res) => syncController.syncMaintenanceactivitytype(req, res));

// Entra ID Login (public - no JWT required)
const jwt = require('jsonwebtoken');
const { verifyEntraToken } = require('./src/middleware/entraAuthMiddleware');

app.post('/api/auth/login', async (req, res) => {
    try {
        const { token: entraToken } = req.body;

        if (!entraToken) {
            return res.status(400).json({ error: 'Entra token is required in request body' });
        }

        logToFile(`[Auth] Login attempt with Entra token...`);

        // Verify the Entra ID token with Microsoft
        const entraPayload = await verifyEntraToken(entraToken);

        logToFile(`[Auth] Entra token verified. User: ${entraPayload.preferred_username || entraPayload.email}`);

        // Issue our own JWT with user info from Entra
        const internalToken = jwt.sign({
            user: entraPayload.preferred_username || entraPayload.email,
            name: entraPayload.name,
            email: entraPayload.preferred_username || entraPayload.email,
            entraId: entraPayload.oid // Azure Object ID
        }, process.env.JWT_SECRET, { expiresIn: '24h' });

        res.json({
            token: internalToken,
            user: {
                name: entraPayload.name,
                email: entraPayload.preferred_username || entraPayload.email
            }
        });

    } catch (error) {
        logToFile(`[Auth] Login failed: ${error.message}`);
        res.status(401).json({ error: 'Invalid Entra token', details: error.message });
    }
});

// Get current user info (JWT protected)
app.get('/api/auth/me', validateJwt, (req, res) => {
    res.json({
        user: req.user.user,
        name: req.user.name,
        email: req.user.email
    });
});

// Routes (JWT protected)
app.use('/api', validateJwt, apiRoutes);

// Health Check
app.get('/', (req, res) => res.send('OneLake ADLS Middleware Running (MVC)'));


// Start Server
app.listen(config.port, () => {
    logToFile(`Server running on http://localhost:${config.port}`);
    logToFile(`[ProIoT] Config Loaded. Path: ${config.oneLake.proIoT.tableUrl}`);
    logToFile(`[FSRProtal] Config Loaded. DB: ${config.sql.database}`);
    
    // Initialize Cron Jobs — DISABLED: รอกำหนดเวลา Sync ใหม่
    // const { initCronJobs } = require('./src/jobs/cronJobs');
    // initCronJobs();
});
