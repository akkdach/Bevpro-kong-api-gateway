const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../server_debug.log');
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function logToFile(msg) {
    // Format timestamp to Asia/Bangkok explicitly
    const now = new Date();
    const bkkTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
    
    const year = bkkTime.getFullYear();
    const month = String(bkkTime.getMonth() + 1).padStart(2, '0');
    const day = String(bkkTime.getDate()).padStart(2, '0');
    const hours = String(bkkTime.getHours()).padStart(2, '0');
    const minutes = String(bkkTime.getMinutes()).padStart(2, '0');
    const seconds = String(bkkTime.getSeconds()).padStart(2, '0');
    
    const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds} BKK`;
    
    const logMsg = `[${timestamp}] ${msg}`;
    logStream.write(`${logMsg}\n`);
    console.log(logMsg); // Also log to console WITH TIMESTAMP for Azure Container Logs
}

module.exports = { logToFile };
