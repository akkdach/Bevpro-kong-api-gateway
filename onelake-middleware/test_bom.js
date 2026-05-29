require('dotenv').config();
const qasSqlService = require('./src/services/qasSqlService');

async function testBom() {
    try {
        console.log('Testing connection to QAS Database...');
        
        // Execute the service method manually
        console.log('Running BOM_Referbush query...');
        const result = await qasSqlService.getBomReferbush();
        
        console.log('=============================');
        console.log('SUCCESS: Query returned data!');
        console.log(`Total Rows Found: ${result.length}`);
        
        if (result.length > 0) {
            console.log('First Row Sample:');
            console.log(JSON.stringify(result[0], null, 2));
        }
        
        console.log('=============================');

        // Close connection gracefully if possible (not strictly needed for test script)
        process.exit(0);
    } catch (error) {
        console.error('=============================');
        console.error('FAILED TO CONNECT OR QUERY:');
        console.error(error.message);
        console.error('=============================');
        process.exit(1);
    }
}

testBom();
