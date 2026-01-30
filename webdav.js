const express = require('express');
const path = require('path');
const fs = require('fs');
const xml2js = require('xml2js');
const qrcode = require('qrcode');
const nodeID3 = require('node-id3');
const axios = require('axios');
const api = require('./main');
const logger = require('./util/logger');

let config = {
    port: 3001,
    quality: 'exhigh',
    mode: 'speed', // 'speed' or 'experience'
    refreshInterval: 3600000, // 1 hour cache for PROPFIND
    metadataTTL: 86400000, // 24 hours for song metadata
};

if (fs.existsSync('webdav_config.json')) {
    try {
        const fileConfig = JSON.parse(fs.readFileSync('webdav_config.json', 'utf-8'));
        // Sync cacheTTL to refreshInterval if needed
        if (fileConfig.cacheTTL && !fileConfig.refreshInterval) {
            fileConfig.refreshInterval = fileConfig.cacheTTL;
            delete fileConfig.cacheTTL;
        }
        config = { ...config, ...fileConfig };
    } catch (e) {
        logger.error('Error parsing webdav_config.json', e);
    }
}

// Ensure config file is synced with code
try {
    fs.writeFileSync('webdav_config.json', JSON.stringify(config, null, 4));
} catch (e) {
    logger.error('Error saving webdav_config.json', e);
}

const app = express();
const PORT = config.port || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const COOKIE_FILE = path.join(DATA_DIR, 'cookie.txt');
const CACHE_FILE = path.join(DATA_DIR, 'webdav_cache.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

let userCookie = '';
// Enhanced Cache
let webdavCache = {
    songs: {}, // id -> metadata
    playlists: {}, // id -> { name, trackIds, trackAt, updateTime, timestamp }
    userPlaylists: { data: [], timestamp: 0 },
    recommendPlaylists: { data: [], timestamp: 0 },
    dailySongs: { data: [], timestamp: 0 },
    propfind: {}, // path -> { xml, timestamp }
    songPathMap: {}, // path -> songId
};

if (fs.existsSync(CACHE_FILE)) {
    try {
        const savedCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        webdavCache = { ...webdavCache, ...savedCache };
    } catch (e) {
        logger.error('Error parsing webdav_cache.json', e);
    }
}

const songPathMap = new Map(Object.entries(webdavCache.songPathMap || {})); // path -> songId

function saveCache() {
    try {
        webdavCache.songPathMap = Object.fromEntries(songPathMap);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(webdavCache));
    } catch (e) {
        logger.error('Error saving cache', e);
    }
}

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
    return name.toString().replace(/[\\/:*?"<>|]/g, '_').trim();
}

function getExtension(song) {
    // Determine extension based on available quality
    // This is a hint for the player
    if (config.quality === 'lossless' || config.quality === 'hires' || config.quality === 'jymaster') {
        return '.flac';
    }
    return '.mp3';
}

const todayDate = new Date();
todayDate.setHours(0, 0, 0, 0);

// Helper to fetch song details in batches
async function getSongsDetails(ids) {
    const missingIds = ids.filter(id => !webdavCache.songs[id] || (Date.now() - (webdavCache.songs[id].timestamp || 0) > config.metadataTTL));

    if (missingIds.length > 0) {
        // Batch in 50s
        for (let i = 0; i < missingIds.length; i += 50) {
            const batch = missingIds.slice(i, i + 50);
            try {
                const res = await api.song_detail({ ids: batch.join(','), cookie: userCookie });
                res.body.songs.forEach(s => {
                    webdavCache.songs[s.id] = {
                        id: s.id,
                        name: s.name,
                        ar: s.ar.map(a => a.name).join(','),
                        al: s.al.name,
                        picUrl: s.al.picUrl,
                        publishTime: s.publishTime,
                        timestamp: Date.now()
                    };
                });
            } catch (e) {
                logger.error('Error fetching song details batch', e);
            }
        }
        saveCache();
    }
    return ids.map(id => webdavCache.songs[id]).filter(Boolean);
}

app.use(async (req, res) => {
    const method = req.method;
    const urlPath = decodeURIComponent(req.path).replace(/\/$/, '') || '/';

    if (!(await checkLogin())) {
        if (method === 'OPTIONS') {
            res.set({
                'Allow': 'OPTIONS, PROPFIND, GET, HEAD, COPY, MOVE',
                'DAV': '1',
            }).status(200).send();
            return;
        }
        res.status(401).send('Unauthorized. Please check server console for QR code.');
        return;
    }

    if (method === 'OPTIONS') {
        res.set({
            'Allow': 'OPTIONS, PROPFIND, GET, HEAD, COPY, MOVE',
            'DAV': '1',
        }).send();
        return;
    }

    if (method === 'PROPFIND') {
        // Check cache
        const cached = webdavCache.propfind[urlPath];
        if (cached && (Date.now() - cached.timestamp < config.refreshInterval)) {
            res.status(207).set('Content-Type', 'application/xml; charset=utf-8').send(cached.xml);
            return;
        }
        handlePropfind(req, res, urlPath);
        return;
    }

    if (method === 'GET' || method === 'HEAD') {
        handleGet(req, res, urlPath, method === 'HEAD');
        return;
    }

    if (method === 'COPY' || method === 'MOVE') {
        handleCopyMove(req, res, urlPath);
        return;
    }

    res.status(405).send('Method Not Allowed');
});

async function handleCopyMove(req, res, urlPath) {
    const destination = req.get('Destination');
    if (!destination) {
        res.status(400).send('Destination header missing');
        return;
    }

    try {
        const destPath = decodeURIComponent(new URL(destination, `http://${req.headers.host}`).pathname).replace(/\/$/, '');

        // Check if destination is in "我的歌单"
        const match = destPath.match(/^\/我的歌单\/([^/]+)/);
        if (!match) {
            res.status(403).send('Only copying/moving to "我的歌单" is supported for favorite logic');
            return;
        }

        const playlistName = match[1];
        let songId = songPathMap.get(urlPath);

        if (!songId) {
            // Try fallback search if songId not in map
            const songMatch = urlPath.match(/\/([^/]+)\s-\s([^/]+)\.(mp3|flac)$/);
            if (songMatch) {
                const searchRes = await api.search({ keywords: songMatch[1] + ' ' + songMatch[2], type: 1, cookie: userCookie });
                if (searchRes.body.result && searchRes.body.result.songs && searchRes.body.result.songs.length > 0) {
                    songId = searchRes.body.result.songs[0].id;
                }
            }
        }

        if (!songId) {
            res.status(404).send('Source song not found');
            return;
        }

        // Find playlist ID
        const profileRes = await api.login_status({ cookie: userCookie });
        const uid = profileRes.body.data.profile.userId;
        const playlistsRes = await api.user_playlist({ uid, cookie: userCookie, limit: 1000 });
        const playlist = playlistsRes.body.playlist.find(p => cleanName(p.name) === playlistName);

        if (!playlist) {
            res.status(404).send('Target playlist not found');
            return;
        }

        logger.info(`Adding song ${songId} to playlist ${playlist.id} (${playlistName})`);
        const result = await api.playlist_tracks({
            op: 'add',
            pid: playlist.id,
            tracks: songId.toString(),
            cookie: userCookie
        });

        if (result.body.code === 200 || result.body.code === 502) { // 502 sometimes means song already in playlist
            res.status(201).send('Created');
            // Invalidate cache
            delete webdavCache.propfind[destPath];
            delete webdavCache.propfind['/我的歌单/' + playlistName];
            delete webdavCache.playlists[playlist.id];
            if (webdavCache.userPlaylists) webdavCache.userPlaylists.timestamp = 0;
            saveCache();
        } else {
            res.status(result.body.code || 500).send(result.body.message || 'Error adding song to playlist');
        }

    } catch (e) {
        logger.error('Copy/Move error:', e);
        res.status(500).send('Internal Server Error');
    }
}

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
            let songs;
            const now = Date.now();
            if (webdavCache.dailySongs && (now - webdavCache.dailySongs.timestamp < config.refreshInterval)) {
                songs = webdavCache.dailySongs.data;
            } else {
                const songsRes = await api.recommend_songs({ cookie: userCookie });
                songs = songsRes.body.data.dailySongs;
                webdavCache.dailySongs = { data: songs, timestamp: now };
                saveCache();
            }
            resources = [{ name: '每日推荐歌曲', type: 'collection', mtime: todayDate }];

            const songIds = songs.map(s => s.id);
            const details = await getSongsDetails(songIds);

            details.forEach(s => {
                const ext = getExtension(s);
                const filename = `${cleanName(s.name)} - ${cleanName(s.ar)}${ext}`;
                const fullPath = `/每日推荐歌曲/${filename}`;
                const mtime = s.publishTime ? new Date(s.publishTime) : todayDate;
                resources.push({ name: filename, type: 'file', size: 10 * 1024 * 1024, mtime });
                songPathMap.set(fullPath, s.id);
            });
        } else if (urlPath === '/每日推荐歌单') {
            let playlists;
            const now = Date.now();
            if (webdavCache.recommendPlaylists && (now - webdavCache.recommendPlaylists.timestamp < config.refreshInterval)) {
                playlists = webdavCache.recommendPlaylists.data;
            } else {
                const resrcRes = await api.recommend_resource({ cookie: userCookie });
                playlists = resrcRes.body.recommend;
                webdavCache.recommendPlaylists = { data: playlists, timestamp: now };
                saveCache();
            }
            resources = [{ name: '每日推荐歌单', type: 'collection', mtime: todayDate }];
            playlists.forEach(p => {
                resources.push({ name: cleanName(p.name), type: 'collection', mtime: new Date(p.createTime || todayDate) });
            });
        } else if (urlPath.startsWith('/每日推荐歌单/')) {
            const playlistName = urlPath.substring('/每日推荐歌单/'.length);
            let playlists;
            const now = Date.now();
            if (webdavCache.recommendPlaylists && (now - webdavCache.recommendPlaylists.timestamp < config.refreshInterval)) {
                playlists = webdavCache.recommendPlaylists.data;
            } else {
                const resrcRes = await api.recommend_resource({ cookie: userCookie });
                playlists = resrcRes.body.recommend;
                webdavCache.recommendPlaylists = { data: playlists, timestamp: now };
                saveCache();
            }

            const playlist = playlists.find(p => cleanName(p.name) === playlistName);
            if (playlist) {
                let cachedPlaylist = webdavCache.playlists[playlist.id];
                if (!cachedPlaylist || (now - cachedPlaylist.timestamp > config.refreshInterval)) {
                    const detailRes = await api.playlist_detail({ id: playlist.id, cookie: userCookie });
                    const trackIds = detailRes.body.playlist.trackIds.map(t => t.id);
                    const trackAtMap = {};
                    detailRes.body.playlist.trackIds.forEach(t => trackAtMap[t.id] = t.at);
                    cachedPlaylist = {
                        name: playlist.name,
                        trackIds,
                        trackAtMap,
                        updateTime: playlist.updateTime || playlist.createTime,
                        timestamp: now
                    };
                    webdavCache.playlists[playlist.id] = cachedPlaylist;
                    saveCache();
                }

                const details = await getSongsDetails(cachedPlaylist.trackIds);
                const playlistMtime = new Date(cachedPlaylist.updateTime || todayDate);
                resources = [{ name: playlistName, type: 'collection', mtime: playlistMtime }];

                details.forEach(s => {
                    const ext = getExtension(s);
                    const filename = `${cleanName(s.name)} - ${cleanName(s.ar)}${ext}`;
                    const fullPath = `${urlPath}/${filename}`;
                    const mtime = cachedPlaylist.trackAtMap[s.id] ? new Date(cachedPlaylist.trackAtMap[s.id]) : (s.publishTime ? new Date(s.publishTime) : playlistMtime);
                    resources.push({ name: filename, type: 'file', size: 10 * 1024 * 1024, mtime });
                    songPathMap.set(fullPath, s.id);
                });
            }
        } else if (urlPath === '/我的歌单') {
            let playlists;
            const now = Date.now();
            if (webdavCache.userPlaylists && (now - webdavCache.userPlaylists.timestamp < config.refreshInterval)) {
                playlists = webdavCache.userPlaylists.data;
            } else {
                const profileRes = await api.login_status({ cookie: userCookie });
                const uid = profileRes.body.data.profile.userId;
                const playlistsRes = await api.user_playlist({ uid, cookie: userCookie, limit: 1000 });
                playlists = playlistsRes.body.playlist;
                webdavCache.userPlaylists = { data: playlists, timestamp: now };
                saveCache();
            }
            resources = [{ name: '我的歌单', type: 'collection', mtime: todayDate }];
            playlists.forEach(p => {
                resources.push({ name: cleanName(p.name), type: 'collection', mtime: new Date(p.updateTime || todayDate) });
            });
        } else if (urlPath.startsWith('/我的歌单/')) {
            const playlistName = urlPath.substring('/我的歌单/'.length);
            let playlists;
            const now = Date.now();
            if (webdavCache.userPlaylists && (now - webdavCache.userPlaylists.timestamp < config.refreshInterval)) {
                playlists = webdavCache.userPlaylists.data;
            } else {
                const profileRes = await api.login_status({ cookie: userCookie });
                const uid = profileRes.body.data.profile.userId;
                const playlistsRes = await api.user_playlist({ uid, cookie: userCookie, limit: 1000 });
                playlists = playlistsRes.body.playlist;
                webdavCache.userPlaylists = { data: playlists, timestamp: now };
                saveCache();
            }

            const playlist = playlists.find(p => cleanName(p.name) === playlistName);
            if (playlist) {
                let cachedPlaylist = webdavCache.playlists[playlist.id];
                if (!cachedPlaylist || (now - cachedPlaylist.timestamp > config.refreshInterval)) {
                    const detailRes = await api.playlist_detail({ id: playlist.id, cookie: userCookie });
                    const trackIds = detailRes.body.playlist.trackIds.map(t => t.id);
                    const trackAtMap = {};
                    detailRes.body.playlist.trackIds.forEach(t => trackAtMap[t.id] = t.at);
                    cachedPlaylist = {
                        name: playlist.name,
                        trackIds,
                        trackAtMap,
                        updateTime: playlist.updateTime,
                        timestamp: now
                    };
                    webdavCache.playlists[playlist.id] = cachedPlaylist;
                    saveCache();
                }

                const details = await getSongsDetails(cachedPlaylist.trackIds);
                const playlistMtime = new Date(cachedPlaylist.updateTime || todayDate);
                resources = [{ name: playlistName, type: 'collection', mtime: playlistMtime }];

                details.forEach(s => {
                    const ext = getExtension(s);
                    const filename = `${cleanName(s.name)} - ${cleanName(s.ar)}${ext}`;
                    const fullPath = `${urlPath}/${filename}`;
                    const mtime = cachedPlaylist.trackAtMap[s.id] ? new Date(cachedPlaylist.trackAtMap[s.id]) : (s.publishTime ? new Date(s.publishTime) : playlistMtime);
                    resources.push({ name: filename, type: 'file', size: 10 * 1024 * 1024, mtime });
                    songPathMap.set(fullPath, s.id);
                });
            }
        } else if (urlPath.endsWith('/cover.jpg') || urlPath.endsWith('/folder.jpg')) {
            resources = [{ name: path.basename(urlPath), type: 'file', size: 1024 * 1024, mtime: todayDate }];
        } else {
             if (songPathMap.has(urlPath)) {
                const songId = songPathMap.get(urlPath);
                const s = webdavCache.songs[songId];
                const mtime = s && s.publishTime ? new Date(s.publishTime) : todayDate;
                resources = [{ name: path.basename(urlPath), type: 'file', size: 10 * 1024 * 1024, mtime }];
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
                            'D:getcontenttype': r.name.endsWith('.flac') ? 'audio/flac' : 'audio/mpeg',
                        }),
                        'D:getlastmodified': (r.mtime || todayDate).toUTCString(),
                    },
                    'D:status': 'HTTP/1.1 200 OK',
                }
            };
        })
    };

    const xml = xmlBuilder.buildObject(response);
    webdavCache.propfind[urlPath] = { xml, timestamp: Date.now() };
    saveCache();
    res.status(207).set('Content-Type', 'application/xml; charset=utf-8').send(xml);
}

async function handleGet(req, res, urlPath, isHead) {
    if (urlPath.endsWith('/cover.jpg') || urlPath.endsWith('/folder.jpg')) {
        handleCoverGet(req, res, urlPath, isHead);
        return;
    }

    let songId = songPathMap.get(urlPath);

    if (isHead) {
        res.status(200).set({
            'Content-Type': urlPath.endsWith('.flac') ? 'audio/flac' : 'audio/mpeg',
            'Accept-Ranges': 'none'
        }).send();
        return;
    }

    if (!songId) {
        const match = urlPath.match(/\/([^/]+)\s-\s([^/]+)\.(mp3|flac)$/);
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
            if (config.mode === 'experience') {
                await handleGetExperience(req, res, songId, urlPath);
                return;
            } else {
                const urlRes = await api.song_url_v1({ id: songId, level: config.quality, cookie: userCookie });
                if (urlRes.body.data && urlRes.body.data[0]) {
                    const song = urlRes.body.data[0];
                    const songUrl = song.url;
                    if (songUrl) {
                        res.redirect(songUrl);
                        return;
                    }
                }
            }
        } catch (e) {
            logger.error('Get song URL error:', e);
        }
    }
    res.status(404).send('Song not found');
}

async function handleCoverGet(req, res, urlPath, isHead) {
    const dirPath = path.dirname(urlPath);
    // Find first song in this directory to get cover
    let picUrl = null;
    for (const [p, id] of songPathMap.entries()) {
        if (p.startsWith(dirPath + '/')) {
            const s = webdavCache.songs[id];
            if (s && s.picUrl) {
                picUrl = s.picUrl;
                break;
            }
        }
    }

    if (!picUrl) {
        res.status(404).send('Cover not found');
        return;
    }

    if (isHead) {
        res.status(200).set('Content-Type', 'image/jpeg').send();
        return;
    }

    try {
        res.redirect(picUrl);
    } catch (e) {
        res.status(500).send('Error');
    }
}

async function handleGetExperience(req, res, songId, urlPath) {
    try {
        const urlRes = await api.song_url_v1({ id: songId, level: config.quality, cookie: userCookie });
        const songUrl = urlRes.body.data[0].url;
        if (!songUrl) {
            res.status(404).send('Song URL not found');
            return;
        }

        const details = await getSongsDetails([songId]);
        const s = details[0];

        logger.info(`Proxying song ${songId} in experience mode...`);
        const response = await axios({
            method: 'get',
            url: songUrl,
            responseType: 'arraybuffer'
        });

        let audioBuffer = Buffer.from(response.data);

        if (urlPath.endsWith('.mp3')) {
            const tags = {
                title: s.name,
                artist: s.ar,
                album: s.al,
            };

            if (s.picUrl) {
                try {
                    const imageRes = await axios({
                        method: 'get',
                        url: s.picUrl,
                        responseType: 'arraybuffer'
                    });
                    tags.image = {
                        mime: "image/jpeg",
                        type: { id: 3, name: "front cover" },
                        description: "Front Cover",
                        imageBuffer: Buffer.from(imageRes.data),
                    };
                } catch (imgErr) {
                    logger.error('Error fetching album art', imgErr);
                }
            }
            audioBuffer = nodeID3.write(tags, audioBuffer);
        }

        res.set({
            'Content-Type': urlPath.endsWith('.flac') ? 'audio/flac' : 'audio/mpeg',
            'Content-Length': audioBuffer.length,
            'Accept-Ranges': 'none'
        });

        res.send(audioBuffer);

    } catch (e) {
        logger.error('Experience mode error:', e);
        res.status(500).send('Internal Server Error');
    }
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
