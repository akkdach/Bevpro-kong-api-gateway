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

        const endpoint = 'https://7b2a2b840f674d1f8e9f65abfa88501d.z7b.graphql.fabric.microsoft.com/v1/workspaces/7b2a2b84-0f67-4d1f-8e9f-65abfa88501d/graphqlapis/e486dea8-7ef1-4806-a269-0385a41be187/graphql';

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

        console.log('Result:', JSON.stringify(result));
        if (result.data && result.data.__schema && result.data.__schema.queryType) {
            const queries = result.data.__schema.queryType.fields;
            const incomeQuery = queries.find(q => q.name.toLowerCase().includes('income'));

            queries.forEach(q => {
                if(true) {
                    console.log(`  - ${q.name}`);
                }
            });

            if (incomeQuery) {
                console.log(`\n✓ Found income query: ${incomeQuery.name}`);

                // Now get fields for this query
                await getQueryFields(endpoint, token, incomeQuery.name);
            }
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

async function getQueryFields(endpoint, token, queryName) {
    const fieldQuery = `
    query {
        __type(name: "${queryName}") {
            name
            fields {
                name
                type {
                    name
                    kind
                    ofType {
                        name
                        kind
                    }
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
        body: JSON.stringify({ query: fieldQuery })
    });

    const result = await response.json();

    if (result.data && result.data.__type) {
        console.log(`\nFields available in ${queryName}:`);
        result.data.__type.fields.forEach(field => {
            console.log(`  - ${field.name}`);
        });

        // Check for our specific fields
        const hasProjectLine = result.data.__type.fields.find(f =>
            f.name.toLowerCase().includes('projline') ||
            f.name.toLowerCase().includes('property')
        );
        const hasCustomer = result.data.__type.fields.find(f =>
            f.name.toLowerCase().includes('customer') &&
            f.name.toLowerCase().includes('type')
        );

        console.log('\n--- Matching Fields ---');
        if (hasProjectLine) console.log(`✓ Found project line field: ${hasProjectLine.name}`);
        if (hasCustomer) console.log(`✓ Found customer type field: ${hasCustomer.name}`);

        if (!hasProjectLine) console.log('✗ No projlinepropertyid field found');
        if (!hasCustomer) console.log('✗ No customer_type field found');
    }
}

introspectSchema();
