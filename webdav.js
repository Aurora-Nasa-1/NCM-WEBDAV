const express = require('express');
const path = require('path');
const fs = require('fs');
const xml2js = require('xml2js');
const qrcode = require('qrcode');
const api = require('./main');
const logger = require('./util/logger');

let config = {
    port: 3001,
    quality: 'exhigh',
    refreshInterval: 3600000,
    cacheTTL: 300000 // 5 minutes cache for PROPFIND
};

if (fs.existsSync('webdav_config.json')) {
    try {
        const fileConfig = JSON.parse(fs.readFileSync('webdav_config.json', 'utf-8'));
        config = { ...config, ...fileConfig };
    } catch (e) {
        logger.error('Error parsing webdav_config.json', e);
    }
}

const app = express();
const PORT = config.port || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const COOKIE_FILE = path.join(DATA_DIR, 'cookie.txt');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

let userCookie = '';
const songCache = new Map(); // path -> {id}
const propfindCache = new Map(); // path -> {data, timestamp}

// Load cookie from file
if (fs.existsSync(COOKIE_FILE)) {
    userCookie = fs.readFileSync(COOKIE_FILE, 'utf-8');
}

async function checkLogin() {
    if (!userCookie) return false;
    try {
        const res = await api.login_status({ cookie: userCookie });
        return res && res.body && res.body.data && res.body.data.profile !== null;
    } catch (e) {
        return false;
    }
}

async function login() {
    console.log('Generating login QR code...');
    try {
        const keyRes = await api.login_qr_key({});
        const unikey = keyRes.body.data.unikey;
        const url = `https://music.163.com/login?codekey=${unikey}`;

        const qrString = await qrcode.toString(url, { type: 'terminal', small: true });
        console.log(qrString);

        console.log('Please scan the QR code with your NetEase Cloud Music app.');

        return new Promise((resolve) => {
            const timer = setInterval(async () => {
                try {
                    const statusRes = await api.login_qr_check({ key: unikey });
                    if (statusRes.body.code === 803) {
                        console.log('Login successful!');
                        userCookie = statusRes.body.cookie;
                        if (Array.isArray(userCookie)) userCookie = userCookie.join('; ');
                        fs.writeFileSync(COOKIE_FILE, userCookie);
                        clearInterval(timer);
                        resolve(true);
                    } else if (statusRes.body.code === 800) {
                        console.log('QR code expired. Please restart.');
                        clearInterval(timer);
                        resolve(false);
                    }
                } catch (e) {
                    // ignore
                }
            }, 3000);
        });
    } catch (e) {
        logger.error('Error during login process:', e);
        return false;
    }
}

function cleanName(name) {
    if (!name) return 'Unknown';
    return name.toString().replace(/[\\/:*?"<>|]/g, '_');
}

const todayDate = new Date();
todayDate.setHours(0, 0, 0, 0);

app.use(async (req, res) => {
    const method = req.method;
    const urlPath = decodeURIComponent(req.path).replace(/\/$/, '') || '/';

    if (!(await checkLogin())) {
        if (method === 'OPTIONS') {
            res.set({
                'Allow': 'OPTIONS, PROPFIND, GET, HEAD',
                'DAV': '1',
            }).status(200).send();
            return;
        }
        res.status(401).send('Unauthorized. Please check server console for QR code.');
        return;
    }

    if (method === 'OPTIONS') {
        res.set({
            'Allow': 'OPTIONS, PROPFIND, GET, HEAD',
            'DAV': '1',
        }).send();
        return;
    }

    if (method === 'PROPFIND') {
        // Check cache
        const cached = propfindCache.get(urlPath);
        if (cached && (Date.now() - cached.timestamp < config.cacheTTL)) {
            res.status(207).set('Content-Type', 'application/xml; charset=utf-8').send(cached.data);
            return;
        }
        handlePropfind(req, res, urlPath);
        return;
    }

    if (method === 'GET' || method === 'HEAD') {
        handleGet(req, res, urlPath, method === 'HEAD');
        return;
    }

    res.status(405).send('Method Not Allowed');
});

async function handlePropfind(req, res, urlPath) {
    let resources = [];
    try {
        if (urlPath === '/') {
            resources = [
                { name: '', type: 'collection', mtime: todayDate },
                { name: '每日推荐歌曲', type: 'collection', mtime: todayDate },
                { name: '每日推荐歌单', type: 'collection', mtime: todayDate },
                { name: '我的歌单', type: 'collection', mtime: todayDate },
            ];
        } else if (urlPath === '/每日推荐歌曲') {
            const songsRes = await api.recommend_songs({ cookie: userCookie });
            const songs = songsRes.body.data.dailySongs;
            resources = [{ name: '每日推荐歌曲', type: 'collection', mtime: todayDate }];
            songs.forEach(s => {
                const filename = `${cleanName(s.name)} - ${cleanName(s.ar.map(a => a.name).join(','))}.mp3`;
                const fullPath = `/每日推荐歌曲/${filename}`;
                resources.push({ name: filename, type: 'file', size: 10 * 1024 * 1024, mtime: todayDate });
                songCache.set(fullPath, { id: s.id });
            });
        } else if (urlPath === '/每日推荐歌单') {
            const resrcRes = await api.recommend_resource({ cookie: userCookie });
            const playlists = resrcRes.body.recommend;
            resources = [{ name: '每日推荐歌单', type: 'collection', mtime: todayDate }];
            playlists.forEach(p => {
                resources.push({ name: cleanName(p.name), type: 'collection', mtime: new Date(p.createTime || todayDate) });
            });
        } else if (urlPath.startsWith('/每日推荐歌单/')) {
            const playlistName = urlPath.substring('/每日推荐歌单/'.length);
            const resrcRes = await api.recommend_resource({ cookie: userCookie });
            const playlist = resrcRes.body.recommend.find(p => cleanName(p.name) === playlistName);
            if (playlist) {
                const detailRes = await api.playlist_track_all({ id: playlist.id, cookie: userCookie });
                const songs = detailRes.body.songs;
                const mtime = new Date(playlist.createTime || todayDate);
                resources = [{ name: playlistName, type: 'collection', mtime }];
                songs.forEach(s => {
                    const filename = `${cleanName(s.name)} - ${cleanName(s.ar.map(a => a.name).join(','))}.mp3`;
                    const fullPath = `${urlPath}/${filename}`;
                    resources.push({ name: filename, type: 'file', size: 10 * 1024 * 1024, mtime });
                    songCache.set(fullPath, { id: s.id });
                });
            }
        } else if (urlPath === '/我的歌单') {
            const profileRes = await api.login_status({ cookie: userCookie });
            const uid = profileRes.body.data.profile.userId;
            const playlistsRes = await api.user_playlist({ uid, cookie: userCookie, limit: 1000 });
            const playlists = playlistsRes.body.playlist;
            resources = [{ name: '我的歌单', type: 'collection', mtime: todayDate }];
            playlists.forEach(p => {
                resources.push({ name: cleanName(p.name), type: 'collection', mtime: new Date(p.updateTime || todayDate) });
            });
        } else if (urlPath.startsWith('/我的歌单/')) {
            const playlistName = urlPath.substring('/我的歌单/'.length);
            const profileRes = await api.login_status({ cookie: userCookie });
            const uid = profileRes.body.data.profile.userId;
            const playlistsRes = await api.user_playlist({ uid, cookie: userCookie, limit: 1000 });
            const playlist = playlistsRes.body.playlist.find(p => cleanName(p.name) === playlistName);
            if (playlist) {
                const detailRes = await api.playlist_track_all({ id: playlist.id, cookie: userCookie });
                const songs = detailRes.body.songs;
                const mtime = new Date(playlist.updateTime || todayDate);
                resources = [{ name: playlistName, type: 'collection', mtime }];
                songs.forEach(s => {
                    const filename = `${cleanName(s.name)} - ${cleanName(s.ar.map(a => a.name).join(','))}.mp3`;
                    const fullPath = `${urlPath}/${filename}`;
                    resources.push({ name: filename, type: 'file', size: 10 * 1024 * 1024, mtime });
                    songCache.set(fullPath, { id: s.id });
                });
            }
        } else {
             if (songCache.has(urlPath)) {
                resources = [{ name: path.basename(urlPath), type: 'file', size: 10 * 1024 * 1024, mtime: todayDate }];
            } else {
                res.status(404).send('Not Found');
                return;
            }
        }
    } catch (e) {
        logger.error('PROPFIND error:', e);
        res.status(500).send('Internal Server Error');
        return;
    }

    const xmlBuilder = new xml2js.Builder({
        rootName: 'D:multistatus',
        attrkey: '$',
        xmldec: { version: '1.0', encoding: 'UTF-8' },
    });

    const response = {
        $: { 'xmlns:D': 'DAV:' },
        'D:response': resources.map(r => {
            let resPath = (r.name === '') ? urlPath : ((urlPath === '/' ? '' : urlPath) + '/' + r.name);
            resPath = resPath.replace(/\\/g, '/');
            const isCol = r.type === 'collection';
            return {
                'D:href': encodeURI(resPath + (isCol && r.name ? '/' : '')),
                'D:propstat': {
                    'D:prop': {
                        'D:displayname': r.name || '/',
                        'D:resourcetype': isCol ? { 'D:collection': {} } : {},
                        ...(isCol ? {} : {
                            'D:getcontentlength': r.size,
                            'D:getcontenttype': 'audio/mpeg',
                        }),
                        'D:getlastmodified': (r.mtime || todayDate).toUTCString(),
                    },
                    'D:status': 'HTTP/1.1 200 OK',
                }
            };
        })
    };

    const xml = xmlBuilder.buildObject(response);
    propfindCache.set(urlPath, { data: xml, timestamp: Date.now() });
    res.status(207).set('Content-Type', 'application/xml; charset=utf-8').send(xml);
}

async function handleGet(req, res, urlPath, isHead) {
    const cached = songCache.get(urlPath);
    let songId = cached ? cached.id : null;

    if (!songId) {
        const match = urlPath.match(/\/([^/]+)\s-\s([^/]+)\.mp3$/);
        if (match) {
            try {
                const searchRes = await api.search({ keywords: match[1] + ' ' + match[2], type: 1, cookie: userCookie });
                if (searchRes.body.result && searchRes.body.result.songs && searchRes.body.result.songs.length > 0) {
                    songId = searchRes.body.result.songs[0].id;
                }
            } catch (e) {
                logger.error('Search fallback error:', e);
            }
        }
    }

    if (songId) {
        try {
            const urlRes = await api.song_url_v1({ id: songId, level: config.quality, cookie: userCookie });
            if (urlRes.body.data && urlRes.body.data[0]) {
                const song = urlRes.body.data[0];
                const songUrl = song.url;
                if (songUrl) {
                    if (isHead) {
                        res.status(200).set({ 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes' }).send();
                    } else {
                        res.redirect(songUrl);
                    }
                    return;
                }
            }
        } catch (e) {
            logger.error('Get song URL error:', e);
        }
    }
    res.status(404).send('Song not found');
}

async function start() {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`WebDAV server started at http://0.0.0.0:${PORT}`);
        console.log(`Default music quality: ${config.quality}`);
    });

    if (!(await checkLogin())) {
        const success = await login();
        if (!success) {
            console.error('Login failed. The server will remain active but unauthorized.');
        }
    } else {
        console.log('Already logged in.');
    }

    // Refresh cookie every 24 hours
    setInterval(async () => {
        if (userCookie) {
            try {
                const res = await api.login_refresh({ cookie: userCookie });
                if (res && res.body && res.body.code === 200) {
                    userCookie = res.cookie;
                    if (Array.isArray(userCookie)) userCookie = userCookie.join('; ');
                    fs.writeFileSync(COOKIE_FILE, userCookie);
                    logger.info('Cookie refreshed successfully.');
                }
            } catch (e) {
                logger.error('Cookie refresh failed:', e);
            }
        }
    }, 24 * 60 * 60 * 1000);
}

start();
