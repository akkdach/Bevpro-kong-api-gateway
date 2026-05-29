const cacheService = require('../services/cacheService');
const graphqlService = require('../services/graphqlService');
const { logToFile } = require('../utils/logger');

class CacheController {
    /**
     * POST /api/cache-income
     * Body: { fromMonth: "2026-01", toMonth: "2026-02" }
     * Fetches data from GraphQL, computes summary, stores in memory
     */
    async cacheData(req, res) {
        try {
            const { fromMonth, toMonth } = req.body;

            if (!fromMonth || !toMonth) {
                return res.status(400).json({
                    success: false,
                    message: 'fromMonth and toMonth are required (format: YYYY-MM)',
                });
            }

            logToFile(`[CacheController] Caching data for ${fromMonth} to ${toMonth}`);

            // Build date range
            const fromDate = `${fromMonth}-01T00:00:00.000Z`;
            const [toYear, toMonthNum] = toMonth.split('-').map(Number);
            const lastDay = new Date(toYear, toMonthNum, 0).getDate();
            const toDate = `${toMonth}-${String(lastDay).padStart(2, '0')}T23:59:59.000Z`;

            logToFile(`[CacheController] Fetching income data from ${fromDate} to ${toDate}`);

            const allData = await graphqlService.executeServiceOrderIncome({
                FromDate: fromDate,
                ToDate: toDate,
            });

            if (!allData || allData.length === 0) {
                return res.json({
                    success: false,
                    message: `ไม่พบข้อมูลในช่วง ${fromMonth} ถึง ${toMonth}`,
                });
            }

            logToFile(`[CacheController] Fetched ${allData.length} records, computing summary...`);

            const result = cacheService.cacheData(fromMonth, toMonth, allData);

            res.json({
                success: true,
                message: `Cached ${result.recordCount} records as summary`,
                ...result,
            });
        } catch (error) {
            logToFile(`[CacheController] Error caching data: ${error.message}`);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * GET /api/cache-income/list
     */
    async listCached(req, res) {
        try {
            const items = cacheService.listCached();
            res.json({ success: true, count: items.length, items });
        } catch (error) {
            logToFile(`[CacheController] Error listing cache: ${error.message}`);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * GET /api/cache-income/summary/:key
     * key = "2026-01_to_2026-02"
     */
    async getCachedSummary(req, res) {
        try {
            const { key } = req.params;
            // Parse key to fromMonth, toMonth
            const match = key.match(/^(\d{4}-\d{2})_to_(\d{4}-\d{2})$/);
            if (!match) {
                return res.status(400).json({ success: false, message: 'Invalid key format. Expected: YYYY-MM_to_YYYY-MM' });
            }

            const cached = cacheService.getCachedSummary(match[1], match[2]);
            if (!cached) {
                return res.status(404).json({ success: false, message: `Cache not found: ${key}` });
            }

            res.json({ success: true, ...cached });
        } catch (error) {
            logToFile(`[CacheController] Error reading cache: ${error.message}`);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    /**
     * DELETE /api/cache-income/:key
     */
    async deleteCache(req, res) {
        try {
            const { key } = req.params;
            cacheService.deleteCache(key);
            res.json({ success: true, message: `Deleted cache: ${key}` });
        } catch (error) {
            logToFile(`[CacheController] Error deleting cache: ${error.message}`);
            const status = error.message.includes('not found') ? 404 : 500;
            res.status(status).json({ success: false, message: error.message });
        }
    }
}

module.exports = new CacheController();
