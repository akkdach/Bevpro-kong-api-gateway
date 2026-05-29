const graphqlService = require('./src/services/graphqlService');

async function testQuery() {
    try {
        console.log('Testing executeServiceOrderIncome...');

        // Test with current month
        const result = await graphqlService.executeServiceOrderIncome({});

        console.log(`\nTotal records: ${result.length}`);

        if (result.length > 0) {
            console.log('\nFirst record:');
            console.log(JSON.stringify(result[0], null, 2));

            console.log('\nAvailable fields:');
            console.log(Object.keys(result[0]).join(', '));

            // Check specific fields
            const hasProjectLinePropertyId = result[0].hasOwnProperty('projlinepropertyid');
            const hasCustomerType = result[0].hasOwnProperty('customer_type');

            console.log(`\n✓ Has projlinepropertyid: ${hasProjectLinePropertyId}`);
            console.log(`✓ Has customer_type: ${hasCustomerType}`);

            if (!hasProjectLinePropertyId || !hasCustomerType) {
                console.log('\n⚠️ Missing fields! Check if:');
                console.log('  1. Server was restarted after code changes');
                console.log('  2. Fabric stored procedure actually returns these fields');
                console.log('  3. Fabric GraphQL schema was refreshed');
            }
        } else {
            console.log('No data returned');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

testQuery();
