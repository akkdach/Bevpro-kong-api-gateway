const config = require('../config');
const { ClientSecretCredential } = require('@azure/identity');

async function run() {
    const cred = new ClientSecretCredential(
        config.auth.tenantId,
        config.auth.clientId,
        config.auth.clientSecret
    );
    const t = await cred.getToken('https://analysis.windows.net/powerbi/api/.default');
    
    // FSRProtal_API endpoint
    const ep = 'https://7b2a2b840f674d1f8e9f65abfa88501d.z7b.graphql.fabric.microsoft.com/v1/workspaces/7b2a2b84-0f67-4d1f-8e9f-65abfa88501d/graphqlapis/47a192e2-8902-46e4-baee-c0ec18c3d629/graphql';
    
    const q = '{ __schema { queryType { fields { name } } } }';
    
    const r = await fetch(ep, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + t.token
        },
        body: JSON.stringify({ query: q })
    });
    
    const j = await r.json();
    const fields = j.data?.__schema?.queryType?.fields || [];
    
    console.log('=== FSRProtal_API Query Fields ===');
    fields.forEach(f => console.log('  ' + f.name));
    console.log('\nTotal:', fields.length);
    
    // Highlight B2B/New fields
    const b2bFields = fields.filter(f => f.name.toLowerCase().includes('new_b2b') || f.name.toLowerCase().includes('service_new'));
    if (b2bFields.length > 0) {
        console.log('\n=== Matching B2B/New fields ===');
        b2bFields.forEach(f => console.log('  ' + f.name));
    }
}

run().catch(e => console.error('Error:', e.message));
