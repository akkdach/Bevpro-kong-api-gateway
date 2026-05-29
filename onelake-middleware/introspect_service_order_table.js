const { ClientSecretCredential } = require('@azure/identity');
const config = require('./src/config');

async function testQueryName() {
    try {
        const credential = new ClientSecretCredential(
            config.auth.tenantId,
            config.auth.clientId,
            config.auth.clientSecret
        );
        const tokenResponse = await credential.getToken('https://analysis.windows.net/powerbi/api/.default');
        const token = tokenResponse.token;

        const endpoint = 'https://7b2a2b840f674d1f8e9f65abfa88501d.z7b.graphql.fabric.microsoft.com/v1/workspaces/7b2a2b84-0f67-4d1f-8e9f-65abfa88501d/graphqlapis/e486dea8-7ef1-4806-a269-0385a41be187/graphql';

        // Try various query name patterns based on Fabric's convention
        const candidates = [
            'serviceOrderTable_Import_DataBase_238s',
            'serviceOrderTable_Import_DataBase_238',
            'ServiceOrderTable_Import_DataBase_238s',
            'ServiceOrderTable_Import_DataBase_238',
            'serviceordertable_Import_DataBase_238s',
            'serviceordertable_import_database_238s',
            'serviceOrderTable_Import_Database_238s',
        ];

        for (const queryName of candidates) {
            console.log(`\nTrying: ${queryName}`);
            const queryBody = `query { ${queryName}(first: 1) { items { Id } hasNextPage endCursor } }`;

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
                    console.log(`  Items: ${JSON.stringify(result.data[queryName].items)}`);
                    console.log(`  HasNextPage: ${result.data[queryName].hasNextPage}`);
                    
                    // Now get all fields from first record
                    const queryAll = `query { ${queryName}(first: 1) { items { Id SinkCreatedOn SinkModifiedOn modifiedon modifieddatetime createdon createddatetime serviceorderid recid } } }`;
                    const resp2 = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ query: queryAll })
                    });
                    const res2 = await resp2.json();
                    if (res2.data) {
                        console.log(`\n  Sample record with key fields:`);
                        console.log(JSON.stringify(res2.data[queryName].items[0], null, 2));
                    }
                    if (res2.errors) {
                        console.log(`  Field errors: ${JSON.stringify(res2.errors)}`);
                    }
                    return;
                } else if (result.errors) {
                    console.log(`  ✗ Error: ${result.errors[0].message.substring(0, 80)}`);
                }
            } catch (e) {
                console.log(`  ✗ Network error: ${e.message}`);
            }
        }
        console.log("\n❌ No match found for any candidate query name.");
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testQueryName();
