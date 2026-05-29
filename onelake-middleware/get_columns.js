const sqlService = require('./src/services/sqlService');

async function getColumns() {
    try {
        const pool = await sqlService.connect();
        const result = await pool.request().query(`SELECT top 1 * FROM smaserviceorderline`);
        if (result.recordset.length > 0) {
            console.log("Columns for smaserviceorderline:");
            console.log(Object.keys(result.recordset[0]).join('\n'));
        } else {
            console.log("Table empty, getting columns from schema...");
            const schemaQuery = `
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'smaserviceorderline'
            `;
            const schemaResult = await pool.request().query(schemaQuery);
            console.log(schemaResult.recordset.map(row => row.COLUMN_NAME).join('\n'));
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
getColumns();
