const api = require('./main');
const fs = require('fs');

async function test() {
    const cookie = fs.readFileSync('data/cookie.txt', 'utf-8');
    const res = await api.song_detail({ ids: '1901371647', cookie }); // A popular song
    console.log(JSON.stringify(res.body, null, 2));
}

test();
