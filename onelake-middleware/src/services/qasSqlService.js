const sql = require('mssql');
const config = require('../config');
const { logToFile } = require('../utils/logger');

class QasSqlService {
    constructor() {
        this.pool = null;
        this._connecting = null;
    }

    async connect() {
        if (this.pool) {
            return this.pool;
        }
        if (this._connecting) {
            return this._connecting;
        }
        this._connecting = (async () => {
            try {
                logToFile("Connecting to BevproFsQas SQL Endpoint...");
                this.pool = await new sql.ConnectionPool(config.qasSql).connect();
                logToFile("Connected to BevproFsQas SQL Endpoint successfully.");
                return this.pool;
            } catch (err) {
                logToFile(`BevproFsQas SQL Connection Error: ${err.message}`);
                logToFile(`BevproFsQas SQL Connection Config: Server=${config.qasSql.server}, DB=${config.qasSql.database}, User=${config.qasSql.user}`);
                this.pool = null;
                throw err;
            } finally {
                this._connecting = null;
            }
        })();
        return this._connecting;
    }

    async getBomReferbush() {
        try {
            const pool = await this.connect();
            logToFile(`Querying View: BOM_Referbush from BevproFsQas`);

            // Execute the direct SQL statement provided by the user
            const query = `
                SELECT [Id]
                    ,[ServiceOrderTypeCode]
                    ,[StandardServiceCode]
                    ,[LineNo]
                    ,[Type]
                    ,[No]
                    ,[Description]
                    ,[Quantity]
                    ,[UnitOfMeasureCode]
                    ,[MIMJ]
                    ,[DescEng]
                    ,[ModelNo]
                    ,[ServiceObjectGroup]
                FROM [BevproFsQas].[dbo].[BOM_Referbush]
            `;
            
            const result = await pool.request().query(query);
            logToFile(`Query Success: Retrieved ${result.recordset.length} rows from BOM_Referbush`);

            return result.recordset;
        } catch (err) {
            logToFile(`SQL Query Error (BOM_Referbush): ${err.message}`);
            throw err;
        }
    }
    async getWorker() {
        try {
            const pool = await this.connect();
            logToFile(`Querying Table: worker from BevproFsQas`);

            const query = `
                SELECT [No]
                    ,[EmployeeCode]
                    ,[FullName]
                    ,[Position]
                    ,[Department]
                    ,[WorkLocation]
                    ,[VanNo]
                    ,[LicensePlate]
                    ,[TelephoneNo]
                    ,[Supervisor]
                    ,[SD2]
                    ,[CostCenter]
                    ,[NewCostCenter]
                    ,[ActivityInsRm]
                    ,[DirectReport]
                    ,[No_Leader]
                    ,[Status]
                FROM [BevproFsQas].[dbo].[worker]
            `;

            const result = await pool.request().query(query);
            logToFile(`Query Success: Retrieved ${result.recordset.length} rows from worker`);

            return result.recordset;
        } catch (err) {
            logToFile(`SQL Query Error (worker): ${err.message}`);
            throw err;
        }
    }
}

module.exports = new QasSqlService();
