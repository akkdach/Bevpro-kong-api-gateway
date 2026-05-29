/**
 * Report Controller
 * Handles API endpoints for Report Tracking feature
 */

const sharePointService = require('../services/sharePointService');
const { logToFile } = require('../utils/logger');

/**
 * GET /api/report-tracking
 * Fetches report data from SharePoint Excel file
 */
async function getReportTracking(req, res) {
    try {
        logToFile('[ReportController] Fetching report tracking data...');

        const sheetName = req.query.sheet || 'Sheet1';
        const result = await sharePointService.getExcelData(sheetName);

        if (result.success) {
            logToFile(`[ReportController] Successfully fetched ${result.rowCount} reports`);
            res.json({
                success: true,
                fileName: result.fileName,
                sheetName: result.sheetName,
                headers: result.headers,
                rowCount: result.rowCount,
                data: result.data,
                lastModified: result.lastModified,
            });
        } else {
            logToFile(`[ReportController] Error: ${result.error}`);
            res.status(500).json({
                success: false,
                error: result.error,
                data: [],
            });
        }
    } catch (error) {
        logToFile(`[ReportController] Exception: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message,
            data: [],
        });
    }
}

/**
 * GET /api/report-tracking/sheets
 * Lists all available worksheets in the Excel file
 */
async function getReportSheets(req, res) {
    try {
        logToFile('[ReportController] Listing worksheets...');

        const result = await sharePointService.listWorksheets();

        if (result.success) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }
    } catch (error) {
        logToFile(`[ReportController] Exception: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message,
            sheets: [],
        });
    }
}

module.exports = {
    getReportTracking,
    getReportSheets,
};
