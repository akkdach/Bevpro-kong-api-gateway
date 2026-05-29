const { logToFile } = require('../utils/logger');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = process.env.CACHE_DATA_PATH || '/app/freeze-data';
const CACHE_FILE = path.join(CACHE_DIR, 'cache_store.json');

/**
 * In-Memory Cache Service for Total Income data.
 * Stores pre-computed summary data in RAM for instant access.
 * Persists to disk so cache survives container restarts.
 */
class CacheService {
    constructor() {
        // Map<string, { metadata, summary }> keyed by "YYYY-MM_to_YYYY-MM"
        this.store = new Map();
        this._loadFromDisk();
    }

    /**
     * Save current cache to disk (JSON file)
     */
    _saveToDisk() {
        try {
            if (!fs.existsSync(CACHE_DIR)) {
                fs.mkdirSync(CACHE_DIR, { recursive: true });
            }
            const data = {};
            for (const [key, value] of this.store.entries()) {
                data[key] = value;
            }
            fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
            logToFile(`[CacheService] Saved ${this.store.size} cache(s) to disk`);
        } catch (err) {
            logToFile(`[CacheService] ERROR saving to disk: ${err.message}`);
        }
    }

    /**
     * Load cache from disk on startup
     */
    _loadFromDisk() {
        try {
            if (fs.existsSync(CACHE_FILE)) {
                const raw = fs.readFileSync(CACHE_FILE, 'utf8');
                const data = JSON.parse(raw);
                for (const [key, value] of Object.entries(data)) {
                    this.store.set(key, value);
                }
                logToFile(`[CacheService] Loaded ${this.store.size} cache(s) from disk`);
            } else {
                logToFile(`[CacheService] No cache file found on disk, starting fresh`);
            }
        } catch (err) {
            logToFile(`[CacheService] ERROR loading from disk: ${err.message}`);
        }
    }

    /**
     * Generate cache key from month range
     */
    _key(fromMonth, toMonth) {
        return `${fromMonth}_to_${toMonth}`;
    }

    /**
     * Compute summary/aggregate from raw data (mirrors frontend DashboardAnalytics logic)
     * @param {Array} data - raw records
     * @returns {object} pre-computed summary
     */
    computeSummary(data) {
        let totalServiceFee = 0;
        let totalSparePart = 0;
        const uniqueServiceOrders = new Set();
        const sdStats = {};
        const jobStats = {};
        const orderCustomerTypeMap = new Map();
        const customerStats = {};
        const trendData = {};
        const pivotData = {};

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

            if (serviceOrderId) uniqueServiceOrders.add(serviceOrderId);
            if (transactionType === 2) totalServiceFee += amount;
            else if (transactionType === 3) totalSparePart += amount;

            // SD Stats
            if (!sdStats[sdKey]) sdStats[sdKey] = { uniqueOrders: new Set(), serviceFee: 0, sparePart: 0 };
            if (serviceOrderId) sdStats[sdKey].uniqueOrders.add(serviceOrderId);
            if (transactionType === 2) sdStats[sdKey].serviceFee += amount;
            else if (transactionType === 3) sdStats[sdKey].sparePart += amount;

            // Job Stats
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

            // Trend Data
            if (dateStr && !dateStr.startsWith('1900')) {
                const monthKey = dateStr.substring(0, 7);
                if (!trendData[monthKey]) trendData[monthKey] = { name: monthKey, jobCount: 0, serviceFee: 0, sparePart: 0, uniqueOrders: new Set() };
                if (serviceOrderId && !trendData[monthKey].uniqueOrders.has(serviceOrderId)) {
                    trendData[monthKey].uniqueOrders.add(serviceOrderId);
                    trendData[monthKey].jobCount += 1;
                }
                if (transactionType === 2) trendData[monthKey].serviceFee += amount;
                else if (transactionType === 3) trendData[monthKey].sparePart += amount;
            }

            // Pivot Data
            if (!pivotData[jobName]) pivotData[jobName] = {};
            if (!pivotData[jobName][sdKey]) pivotData[jobName][sdKey] = { uniqueOrders: new Set(), serviceFee: 0, sparePart: 0 };
            if (serviceOrderId) pivotData[jobName][sdKey].uniqueOrders.add(serviceOrderId);
            if (transactionType === 2) pivotData[jobName][sdKey].serviceFee += amount;
            else if (transactionType === 3) pivotData[jobName][sdKey].sparePart += amount;
        });

        // Finalize
        const totalLoad = uniqueServiceOrders.size;
        const totalRevenue = totalServiceFee + totalSparePart;
        const avgCostPerJob = totalLoad > 0 ? totalRevenue / totalLoad : 0;

        const trendResult = Object.values(trendData).map(t => ({
            name: t.name, jobCount: t.jobCount, serviceFee: t.serviceFee,
            sparePart: t.sparePart, totalAmount: t.serviceFee + t.sparePart
        })).sort((a, b) => a.name.localeCompare(b.name));

        const sdResult = Object.entries(sdStats)
            .map(([zone, s]) => ({ zone, load: s.uniqueOrders.size, serviceFee: s.serviceFee, sparePart: s.sparePart, percentage: totalLoad > 0 ? (s.uniqueOrders.size / totalLoad) * 100 : 0 }))
            .sort((a, b) => b.load - a.load);

        const jobResult = Object.entries(jobStats)
            .map(([job, s]) => ({ job, revenue: s.total, serviceFee: s.serviceFee, sparePart: s.sparePart, load: s.uniqueOrders.size, percentage: totalRevenue > 0 ? (s.total / totalRevenue) * 100 : 0 }))
            .sort((a, b) => b.revenue - a.revenue);

        const customerResult = Object.entries(customerStats).map(([type, s]) => ({
            customerType: type, totalIncome: s.serviceFee + s.sparePart,
            totalLoad: s.uniqueOrders.size, serviceFee: s.serviceFee, sparePart: s.sparePart,
        }));
        customerResult.push({ customerType: 'Total', totalIncome: totalRevenue, totalLoad: totalLoad, serviceFee: totalServiceFee, sparePart: totalSparePart });

        const sdKeys = [...new Set(data.map(d => d.sd || 'No SD'))].sort();
        const pivotLoadRows = [], pivotServiceFeeRows = [], pivotSparePartRows = [];
        for (const jn in pivotData) {
            const lr = { job: jn }, sr = { job: jn }, spr = { job: jn };
            sdKeys.forEach(k => { lr[k] = 0; sr[k] = 0; spr[k] = 0; });
            for (const sk in pivotData[jn]) {
                lr[sk] = pivotData[jn][sk].uniqueOrders.size;
                sr[sk] = pivotData[jn][sk].serviceFee;
                spr[sk] = pivotData[jn][sk].sparePart;
            }
            pivotLoadRows.push(lr); pivotServiceFeeRows.push(sr); pivotSparePartRows.push(spr);
        }

        const efficiencyMetrics = Object.entries(sdStats).map(([zone, s]) => {
            const load = s.uniqueOrders.size;
            const totalCost = s.serviceFee + s.sparePart;
            return { zone, totalCost, totalLoad: load, bahtPerHead: load > 0 ? totalCost / load : 0 };
        });
        const avgBPH = efficiencyMetrics.reduce((s, m) => s + m.bahtPerHead, 0) / (efficiencyMetrics.length || 1);
        efficiencyMetrics.forEach(m => { m.isAboveAverage = m.bahtPerHead > avgBPH; });

        return {
            kpis: { totalLoad, totalServiceFee, totalSparePart, totalRevenue, avgCostPerJob },
            serviceOrderIds: Array.from(uniqueServiceOrders),
            topSD: sdResult, topJobs: jobResult, customerMetrics: customerResult,
            efficiencyMetrics, trendData: trendResult,
            costBreakdown: [{ id: 0, value: totalServiceFee, label: 'Service Fee' }, { id: 1, value: totalSparePart, label: 'Spare Part' }],
            pivot: { loadRows: pivotLoadRows, serviceFeeRows: pivotServiceFeeRows, sparePartRows: pivotSparePartRows, globalUniqueOrdersCount: totalLoad },
            sdKeys,
        };
    }

    /**
     * Cache data for a month range
     */
    cacheData(fromMonth, toMonth, data) {
        const key = this._key(fromMonth, toMonth);

        // Remove any existing caches that overlap with the new range
        const toDelete = [];
        for (const [existingKey, value] of this.store.entries()) {
            const em = value.metadata;
            // Check if ranges overlap
            if (em.fromMonth <= toMonth && em.toMonth >= fromMonth) {
                toDelete.push(existingKey);
            }
        }
        toDelete.forEach(k => {
            this.store.delete(k);
            logToFile(`[CacheService] Auto-removed overlapping cache: ${k}`);
        });

        const summary = this.computeSummary(data);

        this.store.set(key, {
            metadata: {
                fromMonth, toMonth,
                recordCount: data.length,
                cachedAt: new Date().toISOString(),
            },
            summary,
        });

        logToFile(`[CacheService] Cached ${data.length} records as summary for ${key} (${this.store.size} total caches)`);
        this._saveToDisk();
        return { key, recordCount: data.length };
    }

    /**
     * Get cached summary for a month range
     */
    getCachedSummary(fromMonth, toMonth) {
        const key = this._key(fromMonth, toMonth);
        return this.store.get(key) || null;
    }

    /**
     * List all cached ranges
     */
    listCached() {
        const items = [];
        for (const [key, value] of this.store.entries()) {
            items.push({
                key,
                fromMonth: value.metadata.fromMonth,
                toMonth: value.metadata.toMonth,
                recordCount: value.metadata.recordCount,
                cachedAt: value.metadata.cachedAt,
            });
        }
        return items;
    }

    /**
     * Delete a cache entry
     */
    deleteCache(key) {
        if (!this.store.has(key)) {
            throw new Error(`Cache not found: ${key}`);
        }
        this.store.delete(key);
        logToFile(`[CacheService] Deleted cache: ${key}`);
        this._saveToDisk();
    }

    /**
     * Clear all caches
     */
    clearAll() {
        this.store.clear();
        logToFile(`[CacheService] Cleared all caches`);
        this._saveToDisk();
    }
}

module.exports = new CacheService();
