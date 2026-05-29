/**
 * Introspection script to check what arguments the Fabric GraphQL API currently accepts
 * for executeService_Header_Line_Proc
 */
const config = require('../config');

async function introspect() {
    const { ClientSecretCredential } = require('@azure/identity');
    const credential = new ClientSecretCredential(
        config.auth.tenantId,
        config.auth.clientId,
        config.auth.clientSecret
    );
    const tokenResponse = await credential.getToken('https://analysis.windows.net/powerbi/api/.default');

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

    // Find the Service_Header_Line_Proc fields
    const allFields = [
        ...(result.data?.__schema?.queryType?.fields || []),
        ...(result.data?.__schema?.mutationType?.fields || [])
    ];

    const proc = allFields.filter(f => f.name.toLowerCase().includes('service_header_line'));

    if (proc.length > 0) {
        console.log('\n=== Service_Header_Line_Proc found ===');
        proc.forEach(p => {
            console.log(`\nField: ${p.name}`);
            console.log('Arguments:');
            p.args.forEach(a => {
                const typeName = a.type.name || a.type.ofType?.name || a.type.kind;
                console.log(`  - ${a.name}: ${typeName}`);
            });
        });
    } else {
        console.log('\n=== Service_Header_Line_Proc NOT found in schema ===');
        console.log('\nAll available fields:');
        allFields.forEach(f => console.log(`  - ${f.name}`));
    }
}

introspect().catch(err => console.error('Error:', err.message));
