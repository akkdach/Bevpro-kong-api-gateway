const graphqlService = require('./src/services/graphqlService');

async function test() {
    try {
        console.log("Testing API for Service_Level_Refurbish...");
        const result = await graphqlService.queryView('Service_Level_Refurbish');
        if (result && result.length > 0) {
            console.log(`Success! Fetched ${result.length} records.`);
            console.log("First record:", JSON.stringify(result[0], null, 2));
        } else {
            console.log("Success! But no records found (0 length array).");
        }
    } catch (e) {
        console.error("Error occurred:", e);
    }
}

test();
