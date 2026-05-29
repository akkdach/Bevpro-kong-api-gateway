const sql = require('mssql');

async function testSync() {
    console.log('Testing: 20.198.244.238:14330 → BevproFsProd (Azure config)');
    
    try {
        const pool = await sql.connect({
            server: '20.198.244.238',
            database: 'BevproFsProd',
            user: 'sync_user',
            password: 'Dui11223344@!',
            options: {
                encrypt: false,
                trustServerCertificate: true,
                connectTimeout: 10000,
                requestTimeout: 10000,
                port: 14330
            }
        });

        console.log('  ✅ Connected!');

        // Check for tables
        const tables = await pool.request().query(`
            SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo'
        `);
        console.log(`  📋 Tables: ${tables.recordset.length}`);
        tables.recordset.forEach(t => console.log(`     - ${t.TABLE_NAME}`));

        // Check specifically for sync table
        if (tables.recordset.some(t => t.TABLE_NAME === 'ServiceOrderTable_Sync')) {
            const count = await pool.request().query(`SELECT COUNT(*) as cnt FROM dbo.ServiceOrderTable_Sync`);
            console.log(`\n  🎯 ServiceOrderTable_Sync rows: ${count.recordset[0].cnt}`);
        }

        await pool.close();
    } catch (err) {
        console.log(`  ❌ Error: ${err.message}`);
    }
}

testSync().then(() => process.exit(0));
