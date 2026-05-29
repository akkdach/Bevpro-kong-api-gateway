// Test API directly to see the actual response
async function testAPI() {
    try {
        const response = await fetch('http://localhost:3005/api/baht-per-head?limit=1');
        const data = await response.json();

        console.log('=== API Response ===');
        console.log('Success:', data.success);

        if (data.success && data.data && data.data.length > 0) {
            console.log('\n✅ Got data successfully');
            console.log('\nFirst record:');
            console.log(JSON.stringify(data.data[0], null, 2));

            console.log('\n--- Field Check ---');
            const hasProjectLine = data.data[0].hasOwnProperty('projlinepropertyid');
            const hasCustomerType = data.data[0].hasOwnProperty('customer_type');

            console.log(`projlinepropertyid exists: ${hasProjectLine}`);
            console.log(`customer_type exists: ${hasCustomerType}`);

            if (hasProjectLine) {
                console.log(`  Value: ${data.data[0].projlinepropertyid}`);
            }
            if (hasCustomerType) {
                console.log(`  Value: ${data.data[0].customer_type}`);
            }

            console.log('\nAll available fields:');
            console.log(Object.keys(data.data[0]).join(', '));
        } else {
            console.log('\n❌ Error from API:');
            console.log('Message:', data.message);
        }
    } catch (error) {
        console.error('❌ Request failed:', error.message);
    }
}

testAPI();
