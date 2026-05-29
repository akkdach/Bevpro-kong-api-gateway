const oneLakeService = require('../services/oneLakeService');
const config = require('../config');
const { logToFile } = require('../utils/logger');

// Allowed Views whitelist for security
const ALLOWED_VIEWS = ['Service_BN04_Install', 'Service_BN09_Remove', 'Service_BN15_Refurbish'];

class FSRProtalController {
    async getOrders(req, res) {
        try {
            // Default to Refurbish if not specified
            const viewName = req.query.view || 'Service_BN15_Refurbish';
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[FSRProtal] API Request: /api/fsr-protal/orders?view=${viewName}&page=${page}&limit=${limit}`);

            // Validation
            if (!ALLOWED_VIEWS.includes(viewName)) {
                throw new Error(`Invalid View Name. Allowed: ${ALLOWED_VIEWS.join(', ')}`);
            }

            // Fetch Data from Parquet (HTTPS Port 443 - Same as IoT)
            let allDataFromParquet = await oneLakeService.getData(config.oneLake.fsrProtal);

            // Log column names for debugging (first time only)
            if (allDataFromParquet.length > 0) {
                const sampleRow = allDataFromParquet[0];
                logToFile(`[FSRProtal] Available columns: ${Object.keys(sampleRow).slice(0, 20).join(', ')}...`);

                // Log specific fields that might indicate job type
                logToFile(`[FSRProtal] Sample: bpc_service=${sampleRow.bpc_service}, bpc_jobtype=${sampleRow.bpc_jobtype}, bpc_storecode=${sampleRow.bpc_storecode}`);
            }

            // Define filter mapping based on SQL View logic
            const filterMap = {
                'Service_BN04_Install': {
                    bpc_serviceordertypecode: 'BN04',
                    bpc_maintenanceactivitytypecode: 'PLM',
                    bpc_serviceobjectgroup: 'NB2C'
                },
                'Service_BN09_Remove': {
                    bpc_serviceordertypecode: 'BN09',
                    bpc_maintenanceactivitytypecode: 'RME',
                    bpc_serviceobjectgroup: 'NB2C'
                },
                'Service_BN15_Refurbish': {
                    bpc_serviceordertypecode: 'BN15',
                    bpc_maintenanceactivitytypecode: 'REQ',
                    bpc_serviceobjectgroup: 'NB2C'
                }
            };

            // Apply filter based on viewName
            const filterCriteria = filterMap[viewName];

            // Filter by all 3 criteria (same as SQL Views)
            let filteredData = allDataFromParquet.filter(row => {
                return row.bpc_serviceordertypecode === filterCriteria.bpc_serviceordertypecode
                    && row.bpc_maintenanceactivitytypecode === filterCriteria.bpc_maintenanceactivitytypecode
                    && row.bpc_serviceobjectgroup === filterCriteria.bpc_serviceobjectgroup;
            });

            logToFile(`[FSRProtal] Filtered ${filteredData.length} records from ${allDataFromParquet.length} total (View: ${viewName}, Filter: ${filterCriteria.bpc_serviceordertypecode}+${filterCriteria.bpc_maintenanceactivitytypecode}+${filterCriteria.bpc_serviceobjectgroup})`);

            // Pagination
            const total = filteredData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = filteredData.slice(startIndex, endIndex);

            logToFile(`[FSRProtal] Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                data: slicedData,
                total: total,
                page: page,
                limit: limit,
                view: viewName
            });
        } catch (err) {
            logToFile(`[FSRProtal] API Error: ${err.message}`);
            res.status(500).json({ error: err.message });
        }
    }
}

module.exports = new FSRProtalController();
