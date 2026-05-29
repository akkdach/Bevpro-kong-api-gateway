const sql = require('mssql');
require('dotenv').config();

const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    options: {
        encrypt: true,
        trustServerCertificate: true,
        connectTimeout: 10000
    }
    // No Authentication provided intentionally.
    // If network is OK, Server should respond with "Login failed for user...".
    // If network is Blocked/TLS fail, we get "socket hang up" or "timeout".
};

async function testConnectivity() {
    console.log("-----------------------------------------");
    console.log(`Diagnostics: Testing connection to [${config.server}]`);
    console.log("Goal: Check if we can reach the server (Handshake).");
    console.log("Expected Success: 'Login failed for user...' (means server talked back)");
    console.log("Expected Failure: 'socket hang up' or 'EtIMEDOUT' (means network blocked)");
    console.log("-----------------------------------------");

    try {
        await sql.connect(config);
        console.log("Connected?! (Unexpected but great)");
    } catch (err) {
        console.log("\n[RESULT]:");
        if (err.message.includes("Login failed")) {
            console.log("✅ SUCCESS! Network path is OPEN.");
            console.log("   The server received our request and rejected it (as expected).");
            console.log("   This means the 'Socket Hang Up' in the main app is likely due to Token/Auth payload issues, not Firewall.");
        } else if (err.message.includes("socket hang up") || err.code === 'ESOCKET') {
            console.log("❌ FAILURE! Connection dropped.");
            console.log("   The server or a firewall cut the connection during handshake.");
            console.log("   Possibilities: Corporate Firewall (Port 1433 blocked), Proxy interference, or SSL mismatch.");
        } else {
            console.log("⚠️ OTHER ERROR:");
            console.log(err.message);
        }
        console.log("-----------------------------------------");
    }
}

testConnectivity();
