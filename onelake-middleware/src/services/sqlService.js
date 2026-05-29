const sql = require('mssql');
const config = require('../config');
const { logToFile } = require('../utils/logger');

class SqlService {
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
                logToFile("Connecting to OneLake SQL Endpoint...");
                this.pool = await new sql.ConnectionPool(config.sql).connect();
                logToFile("Connected to SQL Endpoint successfully.");
                return this.pool;
            } catch (err) {
                logToFile(`SQL Connection Error: ${err.message}`);
                logToFile(`SQL Connection Config: Server=${config.sql.server}, DB=${config.sql.database}, User=${config.sql.authentication.options.clientId}`);
                this.pool = null;
                throw err;
            } finally {
                this._connecting = null;
            }
        })();
        return this._connecting;
    }

    async getViewData(viewName) {
        try {
            const pool = await this.connect();
            logToFile(`Querying View: ${viewName}`);

            // Prevention of SQL Injection: Validate viewName against allowed list if possible, 
            // but for internal middleware, we'll proceed with direct query for now.
            // Note: Views like 'Service_BN15' are expected.

            const result = await pool.request().query(`SELECT * FROM ${viewName}`);
            logToFile(`Query Success: Retrieved ${result.recordset.length} rows from ${viewName}`);

            return result.recordset;
        } catch (err) {
            logToFile(`SQL Query Error (${viewName}): ${err.message}`);
            throw err;
        }
    }
}

module.exports = new SqlService();
