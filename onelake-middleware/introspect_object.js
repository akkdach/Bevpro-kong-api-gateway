const { ClientSecretCredential } = require('@azure/identity');
require('dotenv').config();
async function test() {
    const credential = new ClientSecretCredential(process.env.AZURE_TENANT_ID, process.env.AZURE_CLIENT_ID, process.env.AZURE_CLIENT_SECRET);
    const tokenResponse = await credential.getToken('https://analysis.windows.net/powerbi/api/.default');
    const endpoint = 'https://7b2a2b840f674d1f8e9f65abfa88501d.z7b.graphql.fabric.microsoft.com/v1/workspaces/7b2a2b84-0f67-4d1f-8e9f-65abfa88501d/graphqlapis/e486dea8-7ef1-4806-a269-0385a41be187/graphql';
    const names = [
        'maintenanceactivitytype__Import_DataBase_238s',
        'bpc_maintenanceactivitytype_Import_DataBase_238s',
        'maintenanceactivitytype_Import_DataBase_238s'
    ];
    for (const name of names) {
        console.log(`Testing: ${name} ...`);
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenResponse.token}` },
            body: JSON.stringify({ query: `query { ${name}(first: 1) { items { Id } } }` })
        });
        const data = await res.json();
        console.log(data.errors ? `  ❌ ${data.errors[0].message.substring(0, 80)}` : `  ✅ FOUND!`);
    }
}
test().catch(e => console.error(e.message));
