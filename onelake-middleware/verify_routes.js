const express = require('express');
const app = express();

try {
    const apiRoutes = require('./src/routes/api');
    console.log('Successfully required ./src/routes/api');

    app.use('/api', apiRoutes);

    console.log('--- Registered API Routes ---');
    apiRoutes.stack.forEach(function (r) {
        if (r.route && r.route.path) {
            console.log(r.route.path);
        }
    });
    console.log('-----------------------------');

    const proIoTController = require('./src/controllers/proIoTController');
    if (typeof proIoTController.getServiceObjects === 'function') {
        console.log('proIoTController.getServiceObjects is a function.');
    } else {
        console.error('ERROR: proIoTController.getServiceObjects is NOT a function!');
    }

} catch (error) {
    console.error('Error loading routes:', error);
}
