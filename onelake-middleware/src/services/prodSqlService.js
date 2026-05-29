const sql = require('mssql');
const config = require('../config');
const { logToFile } = require('../utils/logger');

class ProdSqlService {
    constructor() {
        this.pool = null;
        this._connecting = null; // Lock to prevent race condition
    }

    async connect() {
        // If already connected, return existing pool
        if (this.pool) {
            return this.pool;
        }
        // If a connection attempt is in progress, wait for it
        if (this._connecting) {
            return this._connecting;
        }
        // Start new connection with lock
        this._connecting = (async () => {
            try {
                logToFile("Connecting to BevproFsProd SQL Endpoint...");
                this.pool = await new sql.ConnectionPool(config.prodSql).connect();
                logToFile("Connected to BevproFsProd SQL Endpoint successfully.");
                return this.pool;
            } catch (err) {
                logToFile(`BevproFsProd SQL Connection Error: ${err.message}`);
                logToFile(`BevproFsProd SQL Connection Config: Server=${config.prodSql.server}, DB=${config.prodSql.database}, User=${config.prodSql.user}`);
                this.pool = null;
                throw err;
            } finally {
                this._connecting = null;
            }
        })();
        return this._connecting;
    }

    async getWorkLog() {
        try {
            const pool = await this.connect();
            logToFile(`Querying Table: work_log from BevproFsProd`);

            const query = `
                SELECT [ID]
                    ,[CREATE_DATETIME]
                    ,[INIT_FLAG]
                    ,[MILEAGE]
                    ,[ORDERID]
                    ,[WK_CTR]
                    ,[WORK_ACTION]
                FROM [dbo].[work_log]
            `;

            const result = await pool.request().query(query);
            logToFile(`Query Success: Retrieved ${result.recordset.length} rows from work_log`);

            return result.recordset;
        } catch (err) {
            logToFile(`SQL Query Error (work_log): ${err.message}`);
            throw err;
        }
    }
    async getWorkCenter() {
        try {
            const pool = await this.connect();
            logToFile(`Querying Table: work_center from BevproFsProd`);

            const query = `
                SELECT [WK_CTR]
                    ,[BREAK_TIME]
                    ,[DESCRIPTION]
                    ,[FINISH_TIME]
                    ,[HEIGHT]
                    ,[LENGTH]
                    ,[OT]
                    ,[PLANT]
                    ,[START_TIME]
                    ,[VAN_SUP]
                    ,[WIDTH]
                    ,[ZONE]
                    ,[SD]
                FROM [dbo].[work_center]
            `;

            const result = await pool.request().query(query);
            logToFile(`Query Success: Retrieved ${result.recordset.length} rows from work_center`);

            return result.recordset;
        } catch (err) {
            logToFile(`SQL Query Error (work_center): ${err.message}`);
            throw err;
        }
    }
    async getVanFuelAvg() {
        try {
            const pool = await this.connect();
            logToFile(`Querying Table: van_fuel_avg from BevproFsProd`);

            const query = `
                SELECT [id]
                    ,[van_code]
                    ,[license_plate]
                    ,[service_zone]
                    ,[name_group]
                    ,[service_zone_control]
                    ,[supervisor_name]
                    ,[fuel_avg_km_l]
                    ,[created_at]
                    ,[updated_at]
                FROM [dbo].[van_fuel_avg]
            `;

            const result = await pool.request().query(query);
            logToFile(`Query Success: Retrieved ${result.recordset.length} rows from van_fuel_avg`);

            return result.recordset;
        } catch (err) {
            logToFile(`SQL Query Error (van_fuel_avg): ${err.message}`);
            throw err;
        }
    }
}

module.exports = new ProdSqlService();
