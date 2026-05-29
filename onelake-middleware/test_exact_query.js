const { ClientSecretCredential } = require('@azure/identity');
const config = require('./src/config');

async function testExecuteProcedure() {
    try {
        const credential = new ClientSecretCredential(
            config.auth.tenantId,
            config.auth.clientId,
            config.auth.clientSecret
        );
        const { token } = await credential.getToken('https://analysis.windows.net/powerbi/api/.default');
        
        // PRO_IOT endpoint for executeService__Line
        const endpoint = 'https://7b2a2b840f674d1f8e9f65abfa88501d.z7b.graphql.fabric.microsoft.com/v1/workspaces/7b2a2b84-0f67-4d1f-8e9f-65abfa88501d/graphqlapis/e486dea8-7ef1-4806-a269-0385a41be187/graphql';

        const queryBody = `
            query ExecuteServiceLine($serviceorderid: String!) {
                executeService__Line(serviceorderid: $serviceorderid) {
                    serviceorderid
                    signoff
                    transactiontype
                    bpc_workerpersonnelnum
                    worker
                    qty
                    projcategoryid
                    description
                    serviceobjectrelationid
                    serviceobjectid
                }
            }`;

        console.log('Testing executeService__Line on PRO_IOT...');
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ query: queryBody, variables: { serviceorderid: "123" } })
        });
        const result = await response.json();
        
        if (result.errors) {
            console.log(`❌ executeService__Line failed: ${JSON.stringify(result.errors, null, 2)}`);
        } else {
            console.log(`✅ executeService__Line SUCCEEDED!`);
        }
    } catch (err) {
        console.error('Script error:', err.message);
    }
}

testExecuteProcedure();
