const config = require('../config');

async function run() {
    const { ClientSecretCredential } = require('@azure/identity');
    const credential = new ClientSecretCredential(
        config.auth.tenantId,
        config.auth.clientId,
        config.auth.clientSecret
    );
    const tokenResponse = await credential.getToken('https://analysis.windows.net/powerbi/api/.default');

    // IOT Service Order endpoint
    const endpoint = 'https://7b2a2b840f674d1f8e9f65abfa88501d.z7b.graphql.fabric.microsoft.com/v1/workspaces/7b2a2b84-0f67-4d1f-8e9f-65abfa88501d/graphqlapis/e486dea8-7ef1-4806-a269-0385a41be187/graphql';

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
            mutationType {
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

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tokenResponse.token}`
        },
        body: JSON.stringify({ query })
    });

    const result = await response.json();
    
    const queryFields = result.data?.__schema?.queryType?.fields || [];
    const mutationFields = result.data?.__schema?.mutationType?.fields || [];

    console.log('=== QUERY FIELDS ===');
    queryFields.forEach(p => {
        console.log(`  - ${p.name}`);
        p.args.forEach(a => console.log(`      arg: ${a.name} (${a.type.name || a.type.ofType?.name})`));
    });

    console.log('\n=== MUTATION FIELDS ===');
    mutationFields.forEach(p => {
        console.log(`  - ${p.name}`);
        p.args.forEach(a => console.log(`      arg: ${a.name} (${a.type.name || a.type.ofType?.name})`));
    });
}

run().catch(err => console.error('Error:', err.message));
