const graphqlService = require('./src/services/graphqlService');

async function test() {
    try {
        console.log("Querying Performance_Matrix...");
        // Call the service but we need to see the raw key structure if possible.
        // Since we can't easily modify the service to return keys without breaking flow, 
        // let's just try to call queryView and if it returns empty, we know something is wrong.
        // BETTER: Use the service's internal logic but manually.

        const token = await graphqlService.getAccessToken();
        const endpoint = graphqlService.endpoint;

        // Try multiple variations
        const candidates = [
            'performance_Matrix_Tables',
            'performance_Matrix_Table',
            'Performance_Matrix_Tables',
            'Performance_Matrix_Table',
            'performance_Matrices',
            'Performance_Matrix'
        ];

        for (const name of candidates) {
            console.log(`\n--- Testing ${name} ---`);
            const queryBody = `
            query {
                ${name}(first: 1) {
                    items {
                        Order_Type
                    }
                }
            }`;

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ query: queryBody })
            });

            const result = await response.json();
            if (result.errors) {
                console.log(`Failed: ${result.errors[0].message}`);
            } else {
                console.log("SUCCESS!");
                console.log(JSON.stringify(result, null, 2));
                break; // Found it!
            }
        }

    } catch (e) {
        console.error(e);
    }
}

test();
