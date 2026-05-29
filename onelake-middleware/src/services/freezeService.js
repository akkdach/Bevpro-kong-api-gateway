const fs = require('fs');
const path = require('path');
const config = require('../config');
const { logToFile } = require('../utils/logger');

class FreezeService {
    constructor() {
        this.basePath = config.freezeDataPath;
    }

    /**
     * Ensure the freeze data directory exists
     */
    _ensureDir() {
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
            logToFile(`[FreezeService] Created directory: ${this.basePath}`);
        }
    }

    /**
     * Generate filename from month range
     * @param {string} fromMonth - e.g. "2026-01"
     * @param {string} toMonth - e.g. "2026-03"
     * @returns {string} e.g. "freeze_2026-01_to_2026-03.json"
     */
    _generateFilename(fromMonth, toMonth) {
        return `freeze_${fromMonth}_to_${toMonth}.json`;
    }

    /**
     * Generate summary filename from raw filename
     * @param {string} rawFilename - e.g. "freeze_2026-01_to_2026-03.json"
     * @returns {string} e.g. "freeze_summary_2026-01_to_2026-03.json"
     */
    _summaryFilename(rawFilename) {
        return rawFilename.replace('freeze_', 'freeze_summary_');
    }

    /**
     * Compute summary/aggregate from raw data (matches frontend DashboardAnalytics logic)
     * @param {Array} data - raw records
     * @returns {object} pre-computed summary
     */
    computeSummary(data) {
        // --- KPIs ---
        let totalServiceFee = 0;
        let totalSparePart = 0;
        const uniqueServiceOrders = new Set();

        // --- SD Stats (group by sd) ---
        const sdStats = {};
        // --- Job Stats (group by maintenance activity type description) ---
        const jobStats = {};
        // --- Customer Stats (group by customer_type) ---
        const orderCustomerTypeMap = new Map();
        const customerStats = {};
        // --- Trend Data (group by YYYY-MM) ---
        const trendData = {};
        // --- Pivot Data (group by serviceordertypecode × sd) ---
        const pivotData = {};

        // ORDER_TYPE_MAPPING (same as frontend)
        const ORDER_TYPE_MAPPING = {
            'BN00': 'Survey', 'BN01': 'Preventive', 'BN02': 'Corrective',
            'BN04': 'Install', 'BN09': 'Remove', 'BN15': 'Refurbish',
            'BN16': 'Setup', 'BN17': 'NULL',
            'ZC00': 'Survey', 'ZC01': 'Preventive', 'ZC02': 'Corrective',
            'ZC03': 'Corrective', 'ZC04': 'Install', 'ZC09': 'Remove',
            'ZC15': 'Refurbish', 'ZC16': 'Setup'
        };

        // First pass: resolve customer type per service order
        data.forEach(item => {
            const serviceOrderId = item.serviceorderid;
            const customerType = item.customer_type;
            if (serviceOrderId && customerType) {
                if (!orderCustomerTypeMap.has(serviceOrderId) || orderCustomerTypeMap.get(serviceOrderId) === 'Unknown') {
                    orderCustomerTypeMap.set(serviceOrderId, customerType);
                }
            }
        });

        // Main pass: compute all aggregations in a single loop
        data.forEach(item => {
            const qty = Number(item.qty) || 0;
            const price = Number(item.projsalesprice) || 0;
            const transactionType = item.transactiontype;
            const serviceOrderId = item.serviceorderid || '';
            const sdKey = item.sd || 'No SD';
            const jobCode = item.bpc_serviceordertypecode || 'Unknown';
            const jobName = ORDER_TYPE_MAPPING[jobCode] || jobCode;
            const jobDesc = item.bpc_maintenanceactivitytypedescription || item.bpc_maintenanceactivitytypecode || 'Unknown';
            const resolvedCustomerType = orderCustomerTypeMap.get(serviceOrderId) || item.customer_type || 'Unknown';
            const dateStr = item.bpc_actualfinisheddate || item.dateexecution;
            const amount = price * qty;

            // KPIs
            if (serviceOrderId) uniqueServiceOrders.add(serviceOrderId);
            if (transactionType === 2) totalServiceFee += amount;
            else if (transactionType === 3) totalSparePart += amount;

            // SD Stats
            if (!sdStats[sdKey]) sdStats[sdKey] = { uniqueOrders: new Set(), serviceFee: 0, sparePart: 0 };
            if (serviceOrderId) sdStats[sdKey].uniqueOrders.add(serviceOrderId);
            if (transactionType === 2) sdStats[sdKey].serviceFee += amount;
            else if (transactionType === 3) sdStats[sdKey].sparePart += amount;

            // Job Stats (by description - for DashboardAnalytics topJobs)
            if (transactionType === 2 || transactionType === 3) {
                if (!jobStats[jobDesc]) jobStats[jobDesc] = { total: 0, serviceFee: 0, sparePart: 0, uniqueOrders: new Set() };
                jobStats[jobDesc].total += amount;
                if (serviceOrderId) jobStats[jobDesc].uniqueOrders.add(serviceOrderId);
                if (transactionType === 2) jobStats[jobDesc].serviceFee += amount;
                else if (transactionType === 3) jobStats[jobDesc].sparePart += amount;
            }

            // Customer Stats
            if (!customerStats[resolvedCustomerType]) {
                customerStats[resolvedCustomerType] = { serviceFee: 0, sparePart: 0, uniqueOrders: new Set() };
            }
            if (serviceOrderId) customerStats[resolvedCustomerType].uniqueOrders.add(serviceOrderId);
            if (transactionType === 2) customerStats[resolvedCustomerType].serviceFee += amount;
            else if (transactionType === 3) customerStats[resolvedCustomerType].sparePart += amount;

            // Trend Data (by month)
            if (dateStr && !dateStr.startsWith('1900')) {
                const monthKey = dateStr.substring(0, 7); // "YYYY-MM"
                if (!trendData[monthKey]) trendData[monthKey] = { name: monthKey, jobCount: 0, serviceFee: 0, sparePart: 0, totalAmount: 0, uniqueOrders: new Set() };
                if (serviceOrderId && !trendData[monthKey].uniqueOrders.has(serviceOrderId)) {
                    trendData[monthKey].uniqueOrders.add(serviceOrderId);
                    trendData[monthKey].jobCount += 1;
                }
                if (transactionType === 2) trendData[monthKey].serviceFee += amount;
                else if (transactionType === 3) trendData[monthKey].sparePart += amount;
            }

            // Pivot Data (by serviceordertypecode × sd - for SummaryPivotDashboard)
            if (!pivotData[jobName]) pivotData[jobName] = {};
            if (!pivotData[jobName][sdKey]) pivotData[jobName][sdKey] = { uniqueOrders: new Set(), serviceFee: 0, sparePart: 0 };
            if (serviceOrderId) pivotData[jobName][sdKey].uniqueOrders.add(serviceOrderId);
            if (transactionType === 2) pivotData[jobName][sdKey].serviceFee += amount;
            else if (transactionType === 3) pivotData[jobName][sdKey].sparePart += amount;
        });

        // Finalize trend data
        const trendResult = Object.values(trendData).map(t => ({
            name: t.name,
            jobCount: t.jobCount,
            serviceFee: t.serviceFee,
            sparePart: t.sparePart,
            totalAmount: t.serviceFee + t.sparePart
        })).sort((a, b) => a.name.localeCompare(b.name));

        // Finalize KPIs
        const totalLoad = uniqueServiceOrders.size;
        const totalRevenue = totalServiceFee + totalSparePart;
        const avgCostPerJob = totalLoad > 0 ? totalRevenue / totalLoad : 0;

        // Finalize SD Stats (convert Sets to counts)
        const sdResult = Object.entries(sdStats)
            .map(([zone, stats]) => ({
                zone,
                load: stats.uniqueOrders.size,
                serviceFee: stats.serviceFee,
                sparePart: stats.sparePart,
                percentage: totalLoad > 0 ? (stats.uniqueOrders.size / totalLoad) * 100 : 0,
            }))
            .sort((a, b) => b.load - a.load);

        // Finalize Job Stats
        const jobResult = Object.entries(jobStats)
            .map(([job, stats]) => ({
                job,
                revenue: stats.total,
                serviceFee: stats.serviceFee,
                sparePart: stats.sparePart,
                load: stats.uniqueOrders.size,
                percentage: totalRevenue > 0 ? (stats.total / totalRevenue) * 100 : 0,
            }))
            .sort((a, b) => b.revenue - a.revenue);

        // Finalize Customer Stats
        const customerResult = Object.entries(customerStats).map(([type, stats]) => ({
            customerType: type,
            totalIncome: stats.serviceFee + stats.sparePart,
            totalLoad: stats.uniqueOrders.size,
            serviceFee: stats.serviceFee,
            sparePart: stats.sparePart,
        }));
        // Add Total row
        const totalLoadAll = uniqueServiceOrders.size;
        customerResult.push({
            customerType: 'Total',
            totalIncome: totalRevenue,
            totalLoad: totalLoadAll,
            serviceFee: totalServiceFee,
            sparePart: totalSparePart,
        });

        // Finalize Pivot Data (convert Sets to counts)
        const sdKeys = [...new Set(data.map(d => d.sd || 'No SD'))].sort();
        const pivotLoadRows = [];
        const pivotServiceFeeRows = [];
        const pivotSparePartRows = [];
        for (const jobName in pivotData) {
            const loadRow = { job: jobName };
            const serviceFeeRow = { job: jobName };
            const sparePartRow = { job: jobName };
            sdKeys.forEach(k => { loadRow[k] = 0; serviceFeeRow[k] = 0; sparePartRow[k] = 0; });
            for (const sdKey in pivotData[jobName]) {
                loadRow[sdKey] = pivotData[jobName][sdKey].uniqueOrders.size;
                serviceFeeRow[sdKey] = pivotData[jobName][sdKey].serviceFee;
                sparePartRow[sdKey] = pivotData[jobName][sdKey].sparePart;
            }
            pivotLoadRows.push(loadRow);
            pivotServiceFeeRows.push(serviceFeeRow);
            pivotSparePartRows.push(sparePartRow);
        }

        // Efficiency Metrics (by SD zone)
        const efficiencyMetrics = Object.entries(sdStats).map(([zone, stats]) => {
            const load = stats.uniqueOrders.size;
            const totalCost = stats.serviceFee + stats.sparePart;
            return { zone, totalCost, totalLoad: load, bahtPerHead: load > 0 ? totalCost / load : 0 };
        });
        const avgBahtPerHead = efficiencyMetrics.reduce((s, m) => s + m.bahtPerHead, 0) / (efficiencyMetrics.length || 1);
        efficiencyMetrics.forEach(m => { m.isAboveAverage = m.bahtPerHead > avgBahtPerHead; });

        return {
            kpis: { totalLoad, totalServiceFee, totalSparePart, totalRevenue, avgCostPerJob },
            topSD: sdResult,
            topJobs: jobResult,
            customerMetrics: customerResult,
            efficiencyMetrics,
            trendData: trendResult,
            costBreakdown: [
                { id: 0, value: totalServiceFee, label: 'Service Fee' },
                { id: 1, value: totalSparePart, label: 'Spare Part' },
            ],
            pivot: { loadRows: pivotLoadRows, serviceFeeRows: pivotServiceFeeRows, sparePartRows: pivotSparePartRows, globalUniqueOrdersCount: totalLoad },
            sdKeys,
        };
    }

    /**
     * Save freeze data as JSON file + summary file
     * @param {string} fromMonth
     * @param {string} toMonth
     * @param {Array} data
     * @returns {{ filename: string, recordCount: number, filePath: string }}
     */
    async saveData(fromMonth, toMonth, data) {
        this._ensureDir();

        const filename = this._generateFilename(fromMonth, toMonth);
        const filePath = path.join(this.basePath, filename);

        const freezePayload = {
            metadata: {
                fromMonth,
                toMonth,
                recordCount: data.length,
                frozenAt: new Date().toISOString(),
            },
            data: data,
        };

        const jsonStr = JSON.stringify(freezePayload, null, 2);
        fs.writeFileSync(filePath, jsonStr, 'utf-8');

        logToFile(`[FreezeService] Saved ${data.length} records to ${filePath} (${(Buffer.byteLength(jsonStr) / 1024 / 1024).toFixed(2)} MB)`);

        // Also create summary file
        const summary = this.computeSummary(data);
        const summaryFilename = this._summaryFilename(filename);
        const summaryPath = path.join(this.basePath, summaryFilename);
        const summaryPayload = {
            metadata: {
                fromMonth,
                toMonth,
                recordCount: data.length,
                frozenAt: new Date().toISOString(),
                isSummary: true,
            },
            summary,
        };
        const summaryStr = JSON.stringify(summaryPayload);
        fs.writeFileSync(summaryPath, summaryStr, 'utf-8');
        logToFile(`[FreezeService] Saved summary to ${summaryPath} (${(Buffer.byteLength(summaryStr) / 1024).toFixed(1)} KB)`);

        return {
            filename,
            summaryFilename,
            recordCount: data.length,
            filePath,
            fileSize: Buffer.byteLength(jsonStr),
            summarySize: Buffer.byteLength(summaryStr),
        };
    }

    /**
     * List all frozen data files (excludes summary files)
     * @returns {Array<{ filename: string, fromMonth: string, toMonth: string, size: number, modified: string }>}
     */
    async listFiles() {
        this._ensureDir();

        const files = fs.readdirSync(this.basePath)
            .filter(f => f.startsWith('freeze_') && f.endsWith('.json') && !f.includes('_summary_'));

        return files.map(filename => {
            const filePath = path.join(this.basePath, filename);
            const stats = fs.statSync(filePath);

            // Parse fromMonth and toMonth from filename: freeze_YYYY-MM_to_YYYY-MM.json
            const match = filename.match(/^freeze_(\d{4}-\d{2})_to_(\d{4}-\d{2})\.json$/);
            const fromMonth = match ? match[1] : null;
            const toMonth = match ? match[2] : null;

            // Check if summary file exists
            const summaryFilename = this._summaryFilename(filename);
            const hasSummary = fs.existsSync(path.join(this.basePath, summaryFilename));

            // Try to read metadata without loading all data
            let metadata = null;
            try {
                const fd = fs.openSync(filePath, 'r');
                const buffer = Buffer.alloc(512);
                fs.readSync(fd, buffer, 0, 512, 0);
                fs.closeSync(fd);
                const partial = buffer.toString('utf-8');
                const metaMatch = partial.match(/"recordCount"\s*:\s*(\d+)/);
                const frozenAtMatch = partial.match(/"frozenAt"\s*:\s*"([^"]+)"/);
                metadata = {
                    recordCount: metaMatch ? parseInt(metaMatch[1]) : null,
                    frozenAt: frozenAtMatch ? frozenAtMatch[1] : null,
                };
            } catch (e) {
                // ignore parse errors
            }

            return {
                filename,
                fromMonth,
                toMonth,
                size: stats.size,
                modified: stats.mtime.toISOString(),
                hasSummary,
                ...metadata,
            };
        });
    }

    /**
     * Read a frozen data file (raw)
     * @param {string} filename
     * @returns {object} The parsed JSON content
     */
    async readFile(filename) {
        const filePath = path.join(this.basePath, filename);

        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filename}`);
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    }

    /**
     * Read a frozen summary file
     * @param {string} rawFilename - the raw filename (e.g. freeze_2026-01_to_2026-02.json)
     * @returns {object} The parsed summary JSON content
     */
    async readSummaryFile(rawFilename) {
        const summaryFilename = this._summaryFilename(rawFilename);
        const summaryPath = path.join(this.basePath, summaryFilename);

        if (!fs.existsSync(summaryPath)) {
            throw new Error(`Summary file not found: ${summaryFilename}`);
        }

        const content = fs.readFileSync(summaryPath, 'utf-8');
        return JSON.parse(content);
    }

    /**
     * Delete a frozen data file and its summary
     * @param {string} filename
     */
    async deleteFile(filename) {
        const filePath = path.join(this.basePath, filename);

        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filename}`);
        }

        fs.unlinkSync(filePath);
        logToFile(`[FreezeService] Deleted ${filePath}`);

        // Also delete summary file if exists
        const summaryFilename = this._summaryFilename(filename);
        const summaryPath = path.join(this.basePath, summaryFilename);
        if (fs.existsSync(summaryPath)) {
            fs.unlinkSync(summaryPath);
            logToFile(`[FreezeService] Deleted summary ${summaryPath}`);
        }
    }
}

module.exports = new FreezeService();
