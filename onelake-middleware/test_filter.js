require('dotenv').config();
const graphqlService = require('./src/services/graphqlService');

async function testFilter() {
    try {
        const token = await graphqlService.getAccessToken();
        
        // Let's test a few different filter syntaxes
        const queriesToTest = [
            // Syntax 1: Object style
            `query { serviceOrderTable_Import_DataBase_238s(first: 5, filter: { modifiedon: { gte: "2026-05-18" } }) { items { serviceorderid modifiedon } } }`,
            // Syntax 2: String style
            `query { serviceOrderTable_Import_DataBase_238s(first: 5, filter: "modifiedon ge '2026-05-18'") { items { serviceorderid modifiedon } } }`,
            // Syntax 3: eq style
            `query { serviceOrderTable_Import_DataBase_238s(first: 5, filter: { modifiedon: { eq: "2026-05-19" } }) { items { serviceorderid modifiedon } } }`
        ];

        for (let i = 0; i < queriesToTest.length; i++) {
            console.log(`\nTesting Syntax ${i + 1}...`);
            const body = JSON.stringify({ query: queriesToTest[i] });
            
            const response = await fetch(graphqlService.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body
            });
            
            const result = await response.json();
            if (result.errors) {
                console.log(`Syntax ${i + 1} Failed:`, result.errors[0].message);
            } else {
                console.log(`Syntax ${i + 1} Succeeded! Fetched ${result.data.serviceOrderTable_Import_DataBase_238s.items.length} records.`);
                console.log('Sample:', result.data.serviceOrderTable_Import_DataBase_238s.items[0]);
            }
        }
    } catch (e) {
        console.error("Script error:", e);
    }
}

testFilter();
