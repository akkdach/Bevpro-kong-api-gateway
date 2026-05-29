const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'server_debug.log');
const stats = fs.statSync(filePath);
const fileSize = stats.size;
const bufferSize = 4096; // Read last 4KB
const buffer = Buffer.alloc(bufferSize);

const fd = fs.openSync(filePath, 'r');
const start = Math.max(0, fileSize - bufferSize);
fs.readSync(fd, buffer, 0, bufferSize, start);
fs.closeSync(fd);

console.log(buffer.toString('utf8'));
