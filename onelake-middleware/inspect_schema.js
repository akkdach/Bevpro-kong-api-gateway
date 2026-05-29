const graphqlService = require('./src/services/graphqlService');

async function inspect() {
    try {
        const token = await graphqlService.getAccessToken();
        const endpoint = graphqlService.endpoint;

        console.log("Checking for valid Stored Procedure name...");

        // Candidates to test (based on common patterns)
        const candidates = [
            'serviceOrder_BarCode_Proc', // Current guess
            'executeServiceOrder_BarCode_Proc', // Like the Income one
            'serviceOrder_BarCode_Procs', // Plural
            'serviceOrder_BarCode', // Simplified
            'serviceOrder_BarCodes', // Simplified Plural
            'ServiceOrder_BarCode_Proc', // PascalCase
            'dbo_ServiceOrder_BarCode_Proc' // With Schema
        ];

        for (const queryName of candidates) {
            const queryBody = `
            query {
                ${queryName}(Status: "POST") {
                    serviceorderid
                }
            }`;

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ query: queryBody })
                });

                const result = await response.json();

                if (result.data && result.data[queryName]) {
                    console.log(`\n🎉 MATCH FOUND: "${queryName}"`);
                    return;
                }
            } catch (e) { }
        }
        console.log("\n❌ No match found. Did you expose the SP in Fabric Portal?");

    } catch (e) {
        console.error("Error:", e.message);
    }
}

inspect();
