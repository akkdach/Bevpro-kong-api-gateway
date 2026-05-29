const snappy = require('snappyjs');
console.log('Type of snappy export:', typeof snappy);
console.log('Export keys:', Object.keys(snappy));
if (typeof snappy.uncompress === 'function') console.log('Found snappy.uncompress');
if (typeof snappy.snappyUncompress === 'function') console.log('Found snappy.snappyUncompress');
