const freezeService = require('../services/freezeService');
const graphqlService = require('../services/graphqlService');
const { logToFile } = require('../utils/logger');

class FreezeController {
    /**
     * POST /api/freeze-income
     * Body: { fromMonth: "2026-01", toMonth: "2026-03" }
     * Backend fetches income data internally and saves to disk (avoids large POST payload).
     */
    async freezeData(req, res) {
        try {
            const { fromMonth, toMonth } = req.body;

            if (!fromMonth || !toMonth) {
                return res.status(400).json({
                    success: false,
                    message: 'fromMonth and toMonth are required (format: YYYY-MM)',
                });
            }

            logToFile(`[FreezeController] Freezing data for ${fromMonth} to ${toMonth}`);

            // Build date range for the API query (first day of fromMonth to last day of toMonth)
            const fromDate = `${fromMonth}-01T00:00:00.000Z`;
            // Calculate last day of toMonth
            const [toYear, toMonthNum] = toMonth.split('-').map(Number);
            const lastDay = new Date(toYear, toMonthNum, 0).getDate();
            const toDate = `${toMonth}-${String(lastDay).padStart(2, '0')}T23:59:59.000Z`;

            logToFile(`[FreezeController] Fetching income data from ${fromDate} to ${toDate}`);

            // Fetch data internally using the same GraphQL service as /api/income
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

            logToFile(`[FreezeController] Fetched ${allData.length} records, saving to disk...`);

            const result = await freezeService.saveData(fromMonth, toMonth, allData);

            res.json({
                success: true,
                message: `Frozen ${result.recordCount} records successfully`,
                ...result,
            });
        } catch (error) {
            logToFile(`[FreezeController] Error freezing data: ${error.message}`);
            res.status(500).json({
                success: false,
                message: error.message,
            });
        }
    }

    /**
     * GET /api/freeze-income/list
     */
    async listFrozenData(req, res) {
        try {
            logToFile(`[FreezeController] Listing frozen data files`);
            const files = await freezeService.listFiles();

            res.json({
                success: true,
                count: files.length,
                files,
            });
        } catch (error) {
            logToFile(`[FreezeController] Error listing files: ${error.message}`);
            res.status(500).json({
                success: false,
                message: error.message,
            });
        }
    }

    /**
     * GET /api/freeze-income/:filename
     */
    async getFrozenData(req, res) {
        try {
            const { filename } = req.params;
            logToFile(`[FreezeController] Loading frozen data: ${filename}`);

            const content = await freezeService.readFile(filename);

            res.json({
                success: true,
                ...content,
            });
        } catch (error) {
            logToFile(`[FreezeController] Error reading file: ${error.message}`);
            const status = error.message.includes('not found') ? 404 : 500;
            res.status(status).json({
                success: false,
                message: error.message,
            });
        }
    }

    /**
     * DELETE /api/freeze-income/:filename
     */
    async deleteFrozenData(req, res) {
        try {
            const { filename } = req.params;
            logToFile(`[FreezeController] Deleting frozen data: ${filename}`);

            await freezeService.deleteFile(filename);

            res.json({
                success: true,
                message: `Deleted ${filename} successfully`,
            });
        } catch (error) {
            logToFile(`[FreezeController] Error deleting file: ${error.message}`);
            const status = error.message.includes('not found') ? 404 : 500;
            res.status(status).json({
                success: false,
                message: error.message,
            });
        }
    }
    /**
     * GET /api/freeze-income/summary/:filename
     * Returns pre-computed summary (~2-3KB) instead of full raw data (144MB)
     */
    async getFrozenSummary(req, res) {
        try {
            const { filename } = req.params;
            logToFile(`[FreezeController] Loading frozen summary for: ${filename}`);

            const content = await freezeService.readSummaryFile(filename);

            res.json({
                success: true,
                ...content,
            });
        } catch (error) {
            logToFile(`[FreezeController] Error reading summary: ${error.message}`);
            const status = error.message.includes('not found') ? 404 : 500;
            res.status(status).json({
                success: false,
                message: error.message,
            });
        }
    }
}

module.exports = new FreezeController();
