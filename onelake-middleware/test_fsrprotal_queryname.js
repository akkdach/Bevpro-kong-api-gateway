const { ClientSecretCredential } = require('@azure/identity');
const config = require('./src/config');

async function testQueryNames() {
    try {
        const credential = new ClientSecretCredential(
            config.auth.tenantId,
            config.auth.clientId,
            config.auth.clientSecret
        );
        const { token } = await credential.getToken('https://analysis.windows.net/powerbi/api/.default');
        const endpoint = 'https://7b2a2b840f674d1f8e9f65abfa88501d.z7b.graphql.fabric.microsoft.com/v1/workspaces/7b2a2b84-0f67-4d1f-8e9f-65abfa88501d/graphqlapis/47a192e2-8902-46e4-baee-c0ec18c3d629/graphql';

        const queryNamesToTest = [
            'Service_Line',
            'Service_Lines',
            'service_Line',
            'service_Lines',
            'service_line',
            'service_lines',
            'Service_line',
            'Service_lines'
        ];

        console.log('Testing query names on FSRProtal Endpoint...');
        for (const qName of queryNamesToTest) {
            const queryBody = `query { ${qName}(first: 1) { items { Id } } }`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ query: queryBody })
            });
            const result = await response.json();
            
            if (result.errors) {
                console.log(`❌ ${qName} failed: ${result.errors[0].message}`);
            } else {
                console.log(`✅ ${qName} SUCCEEDED!`);
            }
        }
    } catch (err) {
        console.error('Script error:', err.message);
    }
}

testQueryNames();
