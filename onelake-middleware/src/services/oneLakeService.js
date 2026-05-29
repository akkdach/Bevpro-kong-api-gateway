const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DataLakeServiceClient } = require("@azure/storage-file-datalake");
const { DefaultAzureCredential, InteractiveBrowserCredential, ClientSecretCredential } = require("@azure/identity");
const { uncompress } = require('snappyjs');
const { logToFile } = require('../utils/logger');
const config = require('../config');

// Fix for BigInt
BigInt.prototype.toJSON = function () { return this.toString(); };

class OneLakeService {
    constructor() {
        // Cache Map: Key = cacheFile path, Value = { data: [], time: timestamp }
        this.memoryCache = new Map();
        // Pending requests Map: Key = cacheFile path, Value = Promise
        // This prevents duplicate concurrent requests
        this.pendingRequests = new Map();
    }

    async getCredential() {
        if (config.auth.tenantId && config.auth.clientId && config.auth.clientSecret) {
            logToFile("Using Service Principal Credential...");
            return new ClientSecretCredential(
                config.auth.tenantId,
                config.auth.clientId,
                config.auth.clientSecret
            );
        }
        try {
            logToFile("Using Default Azure Credential...");
            const cred = new DefaultAzureCredential();
            await cred.getToken("https://storage.azure.com/.default");
            return cred;
        } catch (e) {
            logToFile("Using Interactive Browser Credential (Fallback)...");
            return new InteractiveBrowserCredential({ redirectUri: "http://localhost:1337" });
        }
    }

    parseOneLakeUrl(fullUrl) {
        if (!fullUrl || fullUrl.includes("WAITING")) return null;
        try {
            if (fullUrl.startsWith("abfss://")) {
                const parts = fullUrl.replace("abfss://", "").split("@");
                const fs = parts[0];
                const rest = parts[1].split("/");
                rest.shift(); // remove hostname
                return { filesystem: fs, path: rest.join("/") };
            } else {
                const urlObj = new URL(fullUrl);
                const parts = urlObj.pathname.split("/").filter(p => p);
                return { filesystem: parts[0], path: parts.slice(1).join("/") };
            }
        } catch (e) {
            logToFile(`Error parsing URL: ${e.message}`);
            return null;
        }
    }

    isCurrentMonth(dateString) {
        if (!dateString) return false;
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return false;
        const now = new Date();
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    }

    async downloadWithRetry(fileClient, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try { return await fileClient.read(); }
            catch (e) {
                if (i === retries - 1) throw e;
                await new Promise(r => setTimeout(r, 1000 * (i + 1)));
            }
        }
    }

    async getData(projectConfig) {
        const { tableUrl, cacheFile } = projectConfig;

        // 1. RAM Cache (Per Project)
        const cached = this.memoryCache.get(cacheFile);
        if (cached && (Date.now() - cached.time < config.cache.memoryDuration)) {
            logToFile(`[${cacheFile}] Serving from RAM CACHE`);
            return cached.data;
        }

        // 2. Disk Cache
        if (fs.existsSync(cacheFile)) {
            try {
                const stats = fs.statSync(cacheFile);
                const age = Date.now() - stats.mtimeMs;
                if (age < config.cache.diskDuration) {
                    logToFile(`Serving from DISK CACHE (${path.basename(cacheFile)}) - Age: ${(age / 60000).toFixed(1)} mins`);
                    const raw = fs.readFileSync(cacheFile, 'utf-8');
                    const data = JSON.parse(raw);

                    // Update RAM Cache
                    this.memoryCache.set(cacheFile, { data: data, time: Date.now() });
                    return data;
                }
            } catch (e) {
                logToFile(`Disk cache error: ${e.message}`);
            }
        }

        // 3. Check for pending request (Request Deduplication)
        const pendingRequest = this.pendingRequests.get(cacheFile);
        if (pendingRequest) {
            logToFile(`[${cacheFile}] Concurrent request detected. Waiting for existing fetch to complete...`);
            return await pendingRequest;
        }

        // 4. Fetch from OneLake (create promise and store it)
        if (tableUrl.includes("PLACEHOLDER")) {
            logToFile("URL Configured as PLACEHOLDER. Returning empty data.");
            return [];
        }

        const fetchPromise = this.fetchFromOneLake(tableUrl, cacheFile)
            .finally(() => {
                // Remove from pending requests when done
                this.pendingRequests.delete(cacheFile);
            });

        // Store the promise so concurrent requests can wait for it
        this.pendingRequests.set(cacheFile, fetchPromise);

        return await fetchPromise;
    }

    async fetchFromOneLake(tableUrl, cacheFile) {
        logToFile(`Fetching from OneLake: ${tableUrl}`);
        const loc = this.parseOneLakeUrl(tableUrl);
        if (!loc) throw new Error("Invalid OneLake URL");

        const credential = await this.getCredential();
        const serviceClient = new DataLakeServiceClient(config.oneLake.accountUrl, credential);
        const fsClient = serviceClient.getFileSystemClient(loc.filesystem);

        const paths = fsClient.listPaths({ path: loc.path, recursive: true });
        const filesToProcess = [];
        let scannedCount = 0;
        const maxFiles = config.limits.maxFiles || 1000; // Use config limit

        for await (const p of paths) {
            if (scannedCount >= maxFiles) break; // Stop at limit!
            if (p.name.endsWith(".parquet") && !p.name.includes("_delta_log")) {
                filesToProcess.push(p.name);
                scannedCount++;
            }
        }

        logToFile(`Found ${filesToProcess.length} parquet files (limit: ${maxFiles}).`);

        const uniqueRecords = new Map();
        const { parquetReadObjects } = await import('hyparquet');

        for (let i = 0; i < filesToProcess.length; i += config.limits.batchSize) {
            if (uniqueRecords.size >= config.limits.maxRecords) break;
            const batch = filesToProcess.slice(i, i + config.limits.batchSize);

            // Log batch progress
            const batchNum = Math.floor(i / config.limits.batchSize) + 1;
            logToFile(`Processing batch ${batchNum} (${batch.length} files)...`);

            await Promise.all(batch.map(async (fileName) => {
                if (uniqueRecords.size >= config.limits.maxRecords) return;
                try {
                    const fileClient = fsClient.getFileClient(fileName);
                    const downloadResponse = await this.downloadWithRetry(fileClient);
                    const chunks = [];
                    for await (const chunk of downloadResponse.readableStreamBody) chunks.push(chunk);
                    const buffer = Buffer.concat(chunks);

                    const data = await parquetReadObjects({
                        file: Uint8Array.from(buffer).buffer,
                        compressors: { SNAPPY: (data) => uncompress(data) }
                    });

                    if (Array.isArray(data)) {
                        for (const row of data) {
                            // Helper to check date
                            const dateToCheck = row.bpc_slafinishdate || row.createdon || row.bpc_documentdate;

                            // If it's the Main Order Table, enforce strict SLA Date check
                            if (tableUrl.includes("smaserviceordertable")) {
                                if (this.isCurrentMonth(row.bpc_slafinishdate) && row.serviceorderid) {
                                    uniqueRecords.set(row.serviceorderid, row);
                                }
                            } else {
                                // For Service Lines (or others), just check if it has an ID, 
                                // and MAYBE apply date filter if a date column exists (Optional)
                                // For now, let's allow ALL records to debug, or try to filter by createdon if available
                                if (row.serviceorderlineid || row.serviceorderid) {
                                    // Use Line ID as key if available, else Order ID (which might overwrite)
                                    const key = row.serviceorderlineid || row.serviceorderid + "_" + Math.random();
                                    uniqueRecords.set(key, row);
                                }
                            }
                        }
                    }
                } catch (e) {
                    logToFile(`Error processing ${fileName}: ${e.message}`);
                }
            }));
            // Delay removed for demo mode speed
        }

        const records = Array.from(uniqueRecords.values());
        logToFile(`Scan Complete. Unique Matching Records: ${records.length}`);

        // Save to Disk Cache
        try {
            fs.writeFileSync(cacheFile, JSON.stringify(records));
            logToFile(`Saved ${records.length} records to disk cache (${path.basename(cacheFile)}).`);
        } catch (e) {
            logToFile(`Error saving disk cache: ${e.message}`);
        }

        // Update RAM Cache
        this.memoryCache.set(cacheFile, { data: records, time: Date.now() });
        return records;
    }
}

module.exports = new OneLakeService();
