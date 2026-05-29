const { ClientSecretCredential } = require('@azure/identity');
const config = require('./src/config');

async function introspectSchema() {
    try {
        const credential = new ClientSecretCredential(
            config.auth.tenantId,
            config.auth.clientId,
            config.auth.clientSecret
        );
        const tokenResponse = await credential.getToken('https://analysis.windows.net/powerbi/api/.default');
        const token = tokenResponse.token;

        // FSRProtal GraphQL endpoint
        const endpoint = 'https://7b2a2b840f674d1f8e9f65abfa88501d.z7b.graphql.fabric.microsoft.com/v1/workspaces/7b2a2b84-0f67-4d1f-8e9f-65abfa88501d/graphqlapis/47a192e2-8902-46e4-baee-c0ec18c3d629/graphql';

        // Query to get all queries
        const introspectionQuery = `
        query {
            __schema {
                queryType {
                    fields {
                        name
                        description
                    }
                }
            }
        }`;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ query: introspectionQuery })
        });

        const result = await response.json();

        console.log('Available GraphQL Queries on FSRProtal:');
        if (result.data && result.data.__schema && result.data.__schema.queryType) {
            const queries = result.data.__schema.queryType.fields;
            
            queries.forEach(q => {
                if (q.name.toLowerCase().includes('service')) {
                    console.log(`  - ${q.name}`);
                }
                if (q.name.toLowerCase().includes('line')) {
                    console.log(`  - ${q.name}`);
                }
            });
            console.log("\nAll Available Queries:");
             queries.forEach(q => {
                console.log(`  - ${q.name}`);
            });
        } else {
            console.log("No result data:", JSON.stringify(result));
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

introspectSchema();
