const config = require('../config');
const { ClientSecretCredential } = require('@azure/identity');

async function run() {
    const cred = new ClientSecretCredential(config.auth.tenantId, config.auth.clientId, config.auth.clientSecret);
    const tok = await cred.getToken('https://analysis.windows.net/powerbi/api/.default');

    const endpoint = 'https://7b2a2b840f674d1f8e9f65abfa88501d.z7b.graphql.fabric.microsoft.com/v1/workspaces/7b2a2b84-0f67-4d1f-8e9f-65abfa88501d/graphqlapis/47a192e2-8902-46e4-baee-c0ec18c3d629/graphql';

    const query = `{
        __schema {
            queryType {
                fields {
                    name
                    args {
                        name
                        type { name kind ofType { name } }
                    }
                }
            }
        }
    }`;

    const r = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + tok.token
        },
        body: JSON.stringify({ query })
    });

    const data = await r.json();
    const fields = data.data?.__schema?.queryType?.fields || [];

    const proc = fields.find(f => f.name.toLowerCase().includes('service_header_line'));
    if (proc) {
        console.log('Found:', proc.name);
        console.log('Arguments:');
        proc.args.forEach(a => {
            console.log('  -', a.name, ':', a.type.name || a.type.ofType?.name || a.type.kind);
        });
    } else {
        console.log('Service_Header_Line_Proc NOT found!');
        console.log('All query fields:');
        fields.forEach(f => console.log('  -', f.name));
    }
}

run().catch(e => console.error('Error:', e.message));
