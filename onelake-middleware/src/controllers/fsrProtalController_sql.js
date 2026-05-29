const sqlService = require('../services/sqlService');
const { logToFile } = require('../utils/logger');

class FSRProtalController {
    async getOrders(req, res) {
        try {
            const { view, page = 0, limit = 500 } = req.query;
            const viewName = view || 'Service_BN15_Refurbish';

            // Whitelist of allowed views
            const ALLOWED_VIEWS = [
                'Service_BN04_Install',
                'Service_BN09_Remove',
                'Service_BN15_Refurbish'
            ];

            if (!ALLOWED_VIEWS.includes(viewName)) {
                return res.status(400).json({ error: 'Invalid view name' });
            }

            logToFile(`[FSRProtal-SQL] API Request: /api/fsr-protal/orders?view=${viewName}&page=${page}&limit=${limit}`);

            // Query SQL View directly (Port 1433)
            const allData = await sqlService.getViewData(viewName);

            logToFile(`[FSRProtal-SQL] Retrieved ${allData.length} records from SQL View: ${viewName}`);

            // Pagination
            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            logToFile(`[FSRProtal-SQL] Response: Returning ${slicedData.length} records (from total ${total})`);

            res.json({
                data: slicedData,
                total: total,
                page: parseInt(page),
                limit: parseInt(limit)
            });

        } catch (error) {
            logToFile(`[FSRProtal-SQL] Error: ${error.message}`);
            res.status(500).json({
                error: 'Failed to fetch orders from SQL',
                details: error.message
            });
        }
    }

    async getBomReferbush(req, res) {
        try {
            logToFile(`[FSRProtal-SQL] API Request: /api/fsr-protal/bom-referbush`);

            // Require the service dynamically or at the top of the file
            const qasSqlService = require('../services/qasSqlService');
            
            // Query SQL View directly from BevproFsQas
            const allData = await qasSqlService.getBomReferbush();

            logToFile(`[FSRProtal-SQL] Retrieved ${allData.length} records from BOM_Referbush`);

            res.json({
                data: allData,
                total: allData.length
            });

        } catch (error) {
            logToFile(`[FSRProtal-SQL] Error: ${error.message}`);
            res.status(500).json({
                error: 'Failed to fetch BOM_Referbush from BevproFsQas SQL',
                details: error.message
            });
        }
    }
    async getWorker(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 100;

            logToFile(`[FSRProtal-SQL] API Request: /api/worker?page=${page}&limit=${limit}`);

            const qasSqlService = require('../services/qasSqlService');
            const allData = await qasSqlService.getWorker();

            logToFile(`[FSRProtal-SQL] Retrieved ${allData.length} records from worker`);

            const total = allData.length;
            const startIndex = page * limit;
            const endIndex = startIndex + limit;
            const slicedData = allData.slice(startIndex, endIndex);

            res.json({
                success: true,
                data: slicedData,
                total,
                page,
                limit
            });

        } catch (error) {
            logToFile(`[FSRProtal-SQL] Error: ${error.message}`);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch worker from BevproFsQas SQL',
                details: error.message
            });
        }
    }
    async getWorkLog(req, res) {
        try {
            const page = parseInt(req.query.page) || 0;
            const limit = req.query.limit ? parseInt(req.query.limit) : null;

            logToFile(`[FSRProtal-SQL] API Request: /api/work-log?page=${page}&limit=${limit || 'all'}`);

            const prodSqlService = require('../services/prodSqlService');
            const allData = await prodSqlService.getWorkLog();

            logToFile(`[FSRProtal-SQL] Retrieved ${allData.length} records from work_log`);

            const total = allData.length;
            let responseData = allData;

            if (limit) {
                const startIndex = page * limit;
                const endIndex = startIndex + limit;
                responseData = allData.slice(startIndex, endIndex);
            }

            res.json({
                success: true,
                data: responseData,
                total,
                page,
                limit: limit || total
            });

        } catch (error) {
            logToFile(`[FSRProtal-SQL] Error: ${error.message}`);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch work_log from BevproFsProd SQL',
                details: error.message
            });
        }
    }
    async getWorkCenter(req, res) {
        try {
            logToFile(`[FSRProtal-SQL] API Request: /api/work-center`);

            const prodSqlService = require('../services/prodSqlService');
            const allData = await prodSqlService.getWorkCenter();

            logToFile(`[FSRProtal-SQL] Retrieved ${allData.length} records from work_center`);

            res.json({
                success: true,
                data: allData,
                total: allData.length
            });

        } catch (error) {
            logToFile(`[FSRProtal-SQL] Error: ${error.message}`);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch work_center from BevproFsProd SQL',
                details: error.message
            });
        }
    }
    async getVanFuelAvg(req, res) {
        try {
            logToFile(`[FSRProtal-SQL] API Request: /api/van-fuel-avg`);

            const prodSqlService = require('../services/prodSqlService');
            const allData = await prodSqlService.getVanFuelAvg();

            logToFile(`[FSRProtal-SQL] Retrieved ${allData.length} records from van_fuel_avg`);

            res.json({
                success: true,
                data: allData,
                total: allData.length
            });

        } catch (error) {
            logToFile(`[FSRProtal-SQL] Error: ${error.message}`);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch van_fuel_avg from BevproFsProd SQL',
                details: error.message
            });
        }
    }
}

module.exports = new FSRProtalController();
