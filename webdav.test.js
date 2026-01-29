const http = require('http');
const assert = require('assert');

async function testOptions() {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: 3001,
            path: '/',
            method: 'OPTIONS'
        }, (res) => {
            console.log('OPTIONS status:', res.statusCode);
            if (res.statusCode === 200 || res.statusCode === 401) {
                resolve();
            } else {
                reject(new Error('Unexpected status: ' + res.statusCode));
            }
        });
        req.on('error', reject);
        req.end();
    });
}

async function runTests() {
    try {
        await testOptions();
        console.log('Tests passed!');
        process.exit(0);
    } catch (e) {
        console.error('Tests failed:', e);
        process.exit(1);
    }
}

// Give server some time to start if run externally, or we could start it here.
console.log('Waiting 5s for server to initialize...');
setTimeout(runTests, 5000);
