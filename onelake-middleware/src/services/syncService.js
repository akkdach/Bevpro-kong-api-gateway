const sql = require('mssql');
const config = require('../config');
const { logToFile } = require('../utils/logger');
const prodSqlService = require('./prodSqlService');
const graphqlService = require('./graphqlService');

class SyncService {
    constructor() {
        this.batchSize = 250; // Reduced from 1000 to prevent ECONNRESET on tables with many columns
    }

    /**
     * Helper to map GraphQL data types to SQL data types
     */
    mapTypeToSql(key, value) {
        if (key.toLowerCase().includes('date') || key.toLowerCase().includes('time') || key === 'SinkCreatedOn' || key === 'SinkModifiedOn') {
            return 'DATETIME2';
        }
        if (typeof value === 'number') {
            return 'FLOAT'; // Use FLOAT for all numbers to handle both large integers and decimals safely
        }
        if (typeof value === 'boolean') {
            return 'BIT';
        }
        return 'NVARCHAR(MAX)';
    }

    /**
     * Create table dynamically based on data schema
     */
    async createTable(pool, tableName, sampleRow) {
        logToFile(`[SyncService] Creating table ${tableName}...`);
        
        const columns = Object.entries(sampleRow)
            .map(([key, value]) => {
                const sqlType = this.mapTypeToSql(key, value);
                return `[${key}] ${sqlType}`;
            })
            .join(',\n    ');

        const createQuery = `
            CREATE TABLE [dbo].[${tableName}] (
                ${columns}
            )
        `;

        await pool.request().query(createQuery);
        logToFile(`[SyncService] Table ${tableName} created successfully.`);
    }

    /**
     * Check if a table exists in the database
     */
    async tableExists(pool, tableName) {
        const query = `
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = 'dbo' 
            AND TABLE_NAME = '${tableName}'
        `;
        const result = await pool.request().query(query);
        return result.recordset[0].count > 0;
    }

    /**
     * Get the max modified date from the SQL table
     */
    async getLastModifiedDate(pool, tableName, modifyField) {
        const query = `SELECT MAX([${modifyField}]) as lastModified FROM [dbo].[${tableName}]`;
        const result = await pool.request().query(query);
        return result.recordset[0].lastModified;
    }

    /**
     * Prepare data for bulk insert by matching table columns
     */
    async prepareBulkData(pool, tableName, data) {
        // Get column definitions
        const colQuery = `
            SELECT COLUMN_NAME, DATA_TYPE 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = '${tableName}'
        `;
        const colResult = await pool.request().query(colQuery);
        const columns = colResult.recordset.map(r => r.COLUMN_NAME);
        const colTypes = {};

        const table = new sql.Table(`[dbo].[${tableName}]`);
        table.create = false;

        // Add columns to table definition
        colResult.recordset.forEach(col => {
            const type = col.DATA_TYPE.toLowerCase();
            colTypes[col.COLUMN_NAME] = type;
            
            if (type.includes('char')) table.columns.add(col.COLUMN_NAME, sql.NVarChar(sql.MAX));
            else if (type.includes('bigint')) table.columns.add(col.COLUMN_NAME, sql.BigInt);
            else if (type.includes('int')) table.columns.add(col.COLUMN_NAME, sql.BigInt); // Fallback INT to BigInt just in case
            else if (type.includes('float') || type.includes('real') || type.includes('numeric') || type.includes('decimal')) table.columns.add(col.COLUMN_NAME, sql.Float);
            else if (type.includes('bit')) table.columns.add(col.COLUMN_NAME, sql.Bit);
            else if (type.includes('date') || type.includes('time')) table.columns.add(col.COLUMN_NAME, sql.DateTime2);
            else {
                table.columns.add(col.COLUMN_NAME, sql.NVarChar(sql.MAX));
                colTypes[col.COLUMN_NAME] = 'nvarchar';
            }
        });

        // Add rows
        data.forEach(item => {
            const row = columns.map(col => {
                let val = item[col];
                if (val === undefined || val === null || val === '') return null;
                
                const type = colTypes[col];

                // 1. Target is String/Char
                if (type.includes('char')) {
                    if (typeof val === 'object') {
                        val = val instanceof Date ? val.toISOString() : JSON.stringify(val);
                    } else if (typeof val !== 'string') {
                        val = String(val); // Convert numbers/booleans to string
                    }
                    val = val.replace(/\0/g, ''); // Remove NUL bytes
                    // Tedious also fails on invalid unpaired surrogates, but standard strings from JSON should be fine
                } 
                // 2. Target is Date/Time
                else if (type.includes('date') || type.includes('time')) {
                    if (!(val instanceof Date)) {
                        const d = new Date(val);
                        if (isNaN(d.getTime())) return null;
                        val = d;
                    }
                } 
                // 3. Target is Integer
                else if (type.includes('int') || type.includes('bigint')) {
                    if (typeof val !== 'number') {
                        val = Number(val);
                        if (isNaN(val)) return null;
                    }
                    // Handle float values passed to integer columns
                    if (!Number.isInteger(val)) {
                        val = Math.round(val);
                    }
                } 
                // 4. Target is Float
                else if (type.includes('float') || type.includes('real') || type.includes('numeric')) {
                    if (typeof val !== 'number') {
                        val = parseFloat(val);
                        if (isNaN(val)) return null;
                    }
                } 
                // 5. Target is Boolean
                else if (type.includes('bit')) {
                    if (typeof val === 'string') {
                        val = val.toLowerCase() === 'true' || val === '1';
                    } else {
                        val = Boolean(val);
                    }
                }

                return val;
            });
            table.rows.add(...row);
        });

        return table;
    }

    /**
     * Full load: Truncate and insert all data (use only for standalone full reload)
     */
    async fullLoad(pool, tableName, data) {
        logToFile(`[SyncService] Starting full load of ${data.length} records into ${tableName}`);
        
        await pool.request().query(`TRUNCATE TABLE [dbo].[${tableName}]`);
        return await this.appendChunk(pool, tableName, data);
    }

    /**
     * Append a chunk of data (bulk insert WITHOUT truncating)
     */
    async appendChunk(pool, tableName, data) {
        logToFile(`[SyncService] Appending ${data.length} records into ${tableName}`);

        // Insert in batches
        for (let i = 0; i < data.length; i += this.batchSize) {
            const batch = data.slice(i, i + this.batchSize);
            const table = await this.prepareBulkData(pool, tableName, batch);
            
            let retries = 3;
            while (retries > 0) {
                try {
                    const request = pool.request();
                    await request.bulk(table);
                    logToFile(`[SyncService] Inserted batch ${Math.floor(i / this.batchSize) + 1} (${batch.length} records)`);
                    break; // Success
                } catch (err) {
                    retries--;
                    logToFile(`[SyncService] Bulk insert error at batch ${Math.floor(i / this.batchSize) + 1}: ${err.message}. Retries left: ${retries}`);
                    
                    if (retries === 0) throw err;
                    
                    // Reconnect on network drop
                    if (err.code === 'ECONNRESET' || err.message.includes('ECONNRESET') || err.message.includes('Connection lost') || err.message.includes('Connection is closed')) {
                        logToFile(`[SyncService] Attempting to reconnect pool after connection lost...`);
                        try { await pool.close(); } catch(e) {}
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        pool = await sql.connect(config.syncSql);
                        // Update instance reference so callers get the new pool
                        this._pool = pool;
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }
            
            // Tiny delay to prevent socket exhaustion
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        logToFile(`[SyncService] Chunk completed. Inserted ${data.length} records.`);
        return { inserted: data.length, updated: 0 };
    }

    /**
     * Incremental load: Update existing, insert new
     * Uses a temporary table and MERGE statement
     */
    async incrementalLoad(pool, tableName, data, primaryKey) {
        logToFile(`[SyncService] Starting incremental load of ${data.length} records into ${tableName}`);
        
        if (data.length === 0) {
            return { inserted: 0, updated: 0 };
        }

        const tempTableName = `#Temp_${tableName}_${Date.now()}`;
        
        // 1. Create temp table with same structure
        await pool.request().query(`SELECT TOP 0 * INTO [${tempTableName}] FROM [dbo].[${tableName}]`);
        
        // 2. Bulk insert into temp table
        for (let i = 0; i < data.length; i += this.batchSize) {
            const batch = data.slice(i, i + this.batchSize);
            const table = await this.prepareBulkData(pool, tempTableName.replace('#', ''), batch); // SQL Server bulk needs slightly different temp table handling, but we can map columns exactly.
            // Actually, mssql bulk into temp tables is tricky. Let's use a real staging table.
        }
    }

    /**
     * Incremental load alternative using staging table and MERGE
     */
    async incrementalLoadWithStaging(pool, tableName, data, primaryKey) {
        logToFile(`[SyncService] Starting incremental load of ${data.length} records into ${tableName}`);
        
        if (data.length === 0) return { inserted: 0, updated: 0 };

        const stagingTableName = `${tableName}_Staging`;

        // 1. Drop staging if exists and create new from target table schema
        await pool.request().query(`
            IF OBJECT_ID('dbo.${stagingTableName}', 'U') IS NOT NULL DROP TABLE dbo.${stagingTableName};
            SELECT TOP 0 * INTO dbo.${stagingTableName} FROM dbo.${tableName};
        `);

        // 2. Bulk insert into staging
        for (let i = 0; i < data.length; i += this.batchSize) {
            const batch = data.slice(i, i + this.batchSize);
            const table = await this.prepareBulkData(pool, stagingTableName, batch);
            
            let retries = 3;
            while (retries > 0) {
                try {
                    const request = pool.request();
                    await request.bulk(table);
                    break;
                } catch (err) {
                    retries--;
                    if (retries === 0) throw err;
                    if (err.code === 'ECONNRESET' || err.message.includes('ECONNRESET') || err.message.includes('Connection lost')) {
                        try { await pool.close(); } catch(e) {}
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        pool = await sql.connect(config.syncSql);
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // 3. Get columns for MERGE
        const colQuery = `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}'`;
        const colResult = await pool.request().query(colQuery);
        const columns = colResult.recordset.map(r => r.COLUMN_NAME);
        
        const updateSet = columns.filter(c => c !== primaryKey).map(c => `TARGET.[${c}] = SOURCE.[${c}]`).join(', ');
        const insertCols = columns.map(c => `[${c}]`).join(', ');
        const insertVals = columns.map(c => `SOURCE.[${c}]`).join(', ');

        // 4. Execute MERGE
        const mergeQuery = `
            MERGE dbo.${tableName} AS TARGET
            USING dbo.${stagingTableName} AS SOURCE
            ON (TARGET.[${primaryKey}] = SOURCE.[${primaryKey}])
            WHEN MATCHED THEN
                UPDATE SET ${updateSet}
            WHEN NOT MATCHED BY TARGET THEN
                INSERT (${insertCols})
                VALUES (${insertVals});
        `;

        logToFile(`[SyncService] Executing MERGE statement...`);
        const result = await pool.request().query(mergeQuery);
        
        // 5. Cleanup staging
        await pool.request().query(`DROP TABLE dbo.${stagingTableName};`);

        logToFile(`[SyncService] Incremental load completed. Modified rows: ${result.rowsAffected[0]}`);
        
        // Note: rowsAffected for MERGE is sum of inserts and updates
        return { modified: result.rowsAffected[0], totalProcessed: data.length };
    }

    /**
     * Main Sync Function
     */
    async syncFromGraphQL(viewName, targetTableName, primaryKey, modifyField) {
        let pool;
        try {
            logToFile(`Connecting to specific Sync SQL Endpoint (${config.syncSql.server})...`);
            pool = await sql.connect(config.syncSql);
            this._pool = pool; // Store reference for reconnection
            logToFile(`Connected to Sync SQL Endpoint successfully.`);
            
            logToFile(`[SyncService] Starting sync for ${viewName} -> ${targetTableName}`);

            // 1. Check if target table exists
            let exists = await this.tableExists(pool, targetTableName);
            
            if (exists) {
                logToFile(`[SyncService] Target table ${targetTableName} exists. Truncating for full daily sync.`);
                await pool.request().query(`TRUNCATE TABLE [dbo].[${targetTableName}]`);
            } else {
                logToFile(`[SyncService] Target table ${targetTableName} does not exist. Initiating full load and table creation.`);
            }

            // Full Load in chunks (Streaming)
            let isFirstChunk = !exists;
            let totalInserted = 0;
            
            await graphqlService.queryView(viewName, '', async (chunkData, pageNum) => {
                if (!chunkData || chunkData.length === 0) return;
                
                // Always use latest pool reference (may have been reconnected)
                let currentPool = this._pool;
                
                if (isFirstChunk) {
                    await this.createTable(currentPool, targetTableName, chunkData[0]);
                    isFirstChunk = false;
                }
                
                logToFile(`[SyncService] Inserting chunk page ${pageNum} (${chunkData.length} records) into ${targetTableName}...`);
                const result = await this.appendChunk(currentPool, targetTableName, chunkData);
                totalInserted += (result.inserted || chunkData.length);
            });
            
            return { success: true, mode: 'Full Daily Sync', inserted: totalInserted };
        } catch (err) {
            logToFile(`[SyncService] Sync Error: ${err.message}`);
            throw err;
        }
    }
}

module.exports = new SyncService();
