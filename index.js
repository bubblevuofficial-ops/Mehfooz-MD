const { execSync } = require('child_process');

// 1. Auto-Installer for required packages
['qrcode', 'qrcode-terminal', 'pino', '@whiskeysockets/baileys', 'axios', 'express'].forEach(pkg => {
    try {
        require.resolve(pkg);
    } catch (e) {
        console.log(`[Auto-Installer] Installing missing package: ${pkg}...`);
        try {
            execSync(`npm install ${pkg} --save`, { stdio: 'inherit' });
        } catch (err) {}
    }
});

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerm = require('qrcode-terminal');
const qrcode = require('qrcode');
const path = require('path');
const http = require('http');
const url = require('url');
const fs = require('fs');
const os = require('os');
const CommandHandler = require('./handler');

const PORT = process.env.PORT || 20283;

// ─── MULTI-SESSION ROOT ───
// Every connected WhatsApp number/board gets its own sub-folder here, so
// pairing a new board never touches another board's credentials.
const SESSIONS_ROOT = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_ROOT)) {
    fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
}
// Backwards-compat: if an old single-session install has creds sitting
// directly inside sessions/ (not in a sub-folder), migrate them into
// sessions/default so they keep working as one board among many.
(function migrateLegacySession() {
    try {
        const items = fs.readdirSync(SESSIONS_ROOT);
        const hasCreds = items.includes('creds.json');
        if (hasCreds) {
            const legacyDir = path.join(SESSIONS_ROOT, 'default');
            fs.mkdirSync(legacyDir, { recursive: true });
            items.forEach(item => {
                if (item === 'default') return;
                fs.renameSync(path.join(SESSIONS_ROOT, item), path.join(legacyDir, item));
            });
        }
    } catch (e) {}
})();

// ─── FRIENDLY SERVER NUMBERING ───
// The dashboard shows every board as "Server 1", "Server 2", etc. instead
// of its long random session id. Numbers are assigned once, the first time
// a session id is ever seen, and then remembered forever (even if that
// board later disconnects) so numbers never get reused or reshuffled.
const SERVER_LABELS_FILE = path.join(__dirname, 'server_labels.json');
let serverLabels = { nextNumber: 1, map: {} };
if (fs.existsSync(SERVER_LABELS_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(SERVER_LABELS_FILE, 'utf8'));
        if (saved && saved.map) serverLabels = saved;
    } catch (e) {}
}
function saveServerLabels() {
    try { fs.writeFileSync(SERVER_LABELS_FILE, JSON.stringify(serverLabels, null, 2)); } catch (e) {}
}
function getServerNumber(sessionId) {
    if (!serverLabels.map[sessionId]) {
        serverLabels.map[sessionId] = serverLabels.nextNumber++;
        saveServerLabels();
    }
    return serverLabels.map[sessionId];
}

// ─── COMMAND CATALOG (150 commands, categorized) ───
// This catalog powers the "Commands Control" panel. Each command can be
// enabled/disabled from the admin panel. Actual execution logic for each
// command still needs to live in ./commands/*.js and be picked up by
// CommandHandler — this catalog only controls what shows up + on/off state.
const COMMAND_CATALOG = {
    'Group Management': [
        ['lock', 'Group settings ko announcement only par set karta hai'],
        ['unlock', 'Group settings ko open karta hai'],
        ['kick', 'Kisi member ko group se nikalne ke liye'],
        ['add', 'Kisi number ko group mein add karne ke liye'],
        ['promote', 'Member ko admin banane ke liye'],
        ['demote', 'Admin ko member banane ke liye'],
        ['tagall', 'Group ke sab members ko mention karne ke liye'],
        ['hidetag', 'Sab members ko mention karta hai bina text show kiye'],
        ['groupinfo', 'Group ki details show karta hai'],
        ['link', 'Group ka invite link deta hai'],
        ['revoke', 'Group link ko reset karta hai'],
        ['setname', 'Group ka naam change karne ke liye'],
        ['setdesc', 'Group ki description change karne ke liye'],
        ['setpp', 'Group ki profile picture change karne ke liye'],
        ['leave', 'Bot ko group se nikalne ke liye'],
        ['admins', 'Group ke admins ki list dikhata hai'],
        ['ephemeral', 'Disappearing messages on/off karta hai'],
        ['mute', 'Group ko mute karne ke liye (bot response stop)'],
        ['unmute', 'Bot response dobara start karne ke liye'],
        ['welcome', 'Welcome message on/off karne ke liye'],
        ['goodbye', 'Goodbye message on/off karne ke liye'],
        ['setwelcome', 'Custom welcome message set karne ke liye'],
        ['setgoodbye', 'Custom goodbye message set karne ke liye'],
        ['group', 'Group settings (open/close) ka shortcut'],
        ['poll', 'Group mein poll create karne ke liye'],
        ['warn', 'Member ko warn karne ke liye'],
        ['resetwarn', 'Kisi member ki warnings zero karne ke liye'],
        ['listwarn', 'Warned members ki list dekhne ke liye'],
        ['banned', 'Banned members ki list'],
        ['ping', 'Bot ki speed check karne ke liye']
    ],
    'Security & Anti-Link': [
        ['antilink', 'WhatsApp links ko auto-delete aur kick karne ke liye'],
        ['antidelete', 'Delete kiye gaye messages ko wapas dikhane ke liye'],
        ['antiviewonce', 'View-once photos ko save karne ke liye'],
        ['antibot', 'Dusre bots ko group se nikalne ke liye'],
        ['antispam', 'Spamming rokne ke liye'],
        ['anticall', 'Bot number par calls block karne ke liye'],
        ['antifake', 'Fake numbers (+1, etc.) ko auto-kick karne ke liye'],
        ['antitoxic', 'Gali galoch par auto-kick/warn'],
        ['autosticker', 'Har photo ko sticker mein badalne ke liye'],
        ['autoread', 'Messages ko auto-blue tick karne ke liye'],
        ['autorespond', 'AI based auto replies on/off'],
        ['nsfw', 'Adult content filter on/off'],
        ['security', 'Group ki overall security settings check karein'],
        ['lockall', 'Group ki har cheez (name, icon, desc) lock kar dena'],
        ['unlockall', 'Group ki settings open kar dena'],
        ['kickall', 'Sab members ko kick karne ke liye'],
        ['ban', 'User ko bot use karne se ban karne ke liye'],
        ['unban', 'User ko unban karne ke liye'],
        ['block', 'Number ko block karne ke liye'],
        ['unblock', 'Number ko unblock karne ke liye']
    ],
    'Tools & Utility': [
        ['sticker', 'Photo/video ko sticker mein badalne ke liye'],
        ['toimg', 'Sticker ko photo mein badalne ke liye'],
        ['tovideo', 'Sticker ko video mein badalne ke liye'],
        ['tomp3', 'Video ko audio mein badalne ke liye'],
        ['tovn', 'Audio ko voice note mein badalne ke liye'],
        ['ocr', 'Image se text nikalne ke liye'],
        ['translate', 'Text ko dusri language mein badalne ke liye'],
        ['tts', 'Text ko voice mein badalne ke liye'],
        ['shortlink', 'Lambay URL ko chota karne ke liye'],
        ['calc', 'Math calculations karne ke liye'],
        ['weather', 'Kisi bhi shehar ka mausam check karne ke liye'],
        ['reminder', 'Reminder set karne ke liye'],
        ['notes', 'Personal notes save karne ke liye'],
        ['listnotes', 'Saved notes dekhne ke liye'],
        ['delnote', 'Note delete karne ke liye'],
        ['qr', 'Text se QR code banane ke liye'],
        ['readqr', 'QR code image se data nikalne ke liye'],
        ['ss', 'Website ka screenshot lene ke liye'],
        ['pdf', 'Website ya text ko PDF mein badalne ke liye'],
        ['info', 'Bot ki system information'],
        ['runtime', 'Bot kitni der se chal raha hai'],
        ['speed', 'Internet speed test'],
        ['cpu', 'Server CPU usage check karein'],
        ['ram', 'Server RAM usage check karein'],
        ['temp', 'Server temperature'],
        ['whois', 'Domain details check karne ke liye'],
        ['ipinfo', 'IP address ki details'],
        ['base64', 'Encode/Decode text'],
        ['binary', 'Text to binary conversion'],
        ['hex', 'Text to hex conversion']
    ],
    'Downloaders': [
        ['ytmp3', 'YouTube video ko MP3 mein download karein'],
        ['ytmp4', 'YouTube video ko MP4 mein download karein'],
        ['facebook', 'FB video download karne ke liye'],
        ['instagram', 'Insta reels/post download karne ke liye'],
        ['tiktok', 'TikTok video (without watermark) download karein'],
        ['twitter', 'Twitter video download'],
        ['threads', 'Threads post download'],
        ['pinterest', 'Pinterest image/video download'],
        ['gdrive', 'Google Drive file download'],
        ['mediafire', 'Mediafire file download'],
        ['gitclone', 'GitHub repository download'],
        ['play', 'YouTube se gaana search aur download karein'],
        ['song', 'Audio file search'],
        ['video', 'Video file search'],
        ['apk', 'Android app download link'],
        ['modapk', 'Modded apps search'],
        ['story', 'Insta story download'],
        ['capcut', 'Capcut template download'],
        ['snapchat', 'Snapchat video download'],
        ['spotify', 'Spotify track download']
    ],
    'Search & Information': [
        ['google', 'Google search results'],
        ['wiki', 'Wikipedia information'],
        ['lyrics', 'Gaane ke bol (lyrics) search karein'],
        ['image', 'Google image search'],
        ['wallpaper', 'HD wallpapers search'],
        ['news', 'Latest news updates'],
        ['cricket', 'Live cricket score'],
        ['stock', 'Stock market updates'],
        ['crypto', 'Bitcoin/Crypto prices'],
        ['dictionary', 'Word meanings'],
        ['urban', 'Urban dictionary slang meanings'],
        ['imdb', 'Movie ratings aur details'],
        ['anime', 'Anime information search'],
        ['manga', 'Manga details'],
        ['github', 'GitHub user profile search'],
        ['npm', 'NPM package details'],
        ['playstore', 'App details from Play Store'],
        ['map', 'Location map search'],
        ['recipe', 'Khana banane ki tarkeeb search karein'],
        ['horoscope', 'Daily horoscope']
    ],
    'Study & VU Specific': [
        ['handouts', 'VU subject handouts download karein'],
        ['pastpapers', 'Moaaz/Waqar Sidhu files search'],
        ['lms', 'LMS login link aur guide'],
        ['datesheet', 'Datesheet portal link'],
        ['result', 'Result checking guide'],
        ['admission', 'New admission details'],
        ['fees', 'Fee structure information'],
        ['cs101', 'CS101 specific resources'],
        ['mth101', 'MTH101 specific resources'],
        ['eng101', 'ENG101 specific resources'],
        ['assignment', 'Latest assignment solutions'],
        ['gdb', 'GDB discussion help'],
        ['quiz', 'Quiz preparation files'],
        ['vucalendar', 'Academic calendar'],
        ['scholarship', 'VU scholarship details'],
        ['degree', 'Degree issuance process'],
        ['transcript', 'Transcript request guide'],
        ['campus', 'VU campuses list'],
        ['contact', 'VU official contact details'],
        ['helpvu', 'General VU support']
    ],
    'Owner & Admin': [
        ['broadcast', 'Sab chats mein message bhejne ke liye'],
        ['setprefix', 'Bot ka prefix change karein'],
        ['setbotname', 'Bot ka naam badalne ke liye'],
        ['setowner', 'Owner number update karein'],
        ['eval', 'JavaScript code execute karne ke liye'],
        ['shell', 'Terminal commands run karne ke liye'],
        ['restart', 'Bot ko restart karne ke liye'],
        ['shutdown', 'Bot ko band karne ke liye'],
        ['update', 'GitHub se latest code pull karein'],
        ['clearall', 'Sab chats clear karne ke liye']
    ]
};

function getAllCommandNames() {
    const names = [];
    Object.values(COMMAND_CATALOG).forEach(list => list.forEach(([name]) => names.push(name)));
    return names;
}

// Persistent Settings Database File
const SETTINGS_FILE = path.join(__dirname, 'bot_settings.json');
let botSettings = {
    botName: 'MEHFOOZ MD BOT',
    ownerName: 'Saif Chishti',
    ownerNumber: '923204854766',
    adminUsername: 'admin',
    adminPassword: 'admin',
    prefix: '.',
    mode: 'public',
    bio: 'Multi-Device WhatsApp Bot',
    antilink: true,
    antidelete: true,
    antispam: false,
    antivoice: false,
    antibot: false,
    welcomeEnabled: true,
    goodbyeEnabled: false,
    themeColor: '#00ff88',
    channelLinks: [
        'https://whatsapp.com/channel/0029VbD4X1x1yT22Ckp2Pu1W',
        'https://whatsapp.com/channel/0029VbDx19fA89MlEuo4603v',
        'https://whatsapp.com/channel/0029Vb8ehJKDOQIb8Lb0uu3j'
    ],
    groupLinks: [
        'https://chat.whatsapp.com/F7U7754Jf1MAn5HWUPd56Q?s=cl&p=a&mlu=4&ilr=4'
    ],
    socialYoutube: '',
    socialInstagram: '',
    socialTelegram: '',
    enabledCommands: {} // filled below with defaults (all true)
};

// Default every catalog command to enabled = true unless already saved
getAllCommandNames().forEach(name => {
    if (botSettings.enabledCommands[name] === undefined) botSettings.enabledCommands[name] = true;
});

if (fs.existsSync(SETTINGS_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        botSettings = { ...botSettings, ...saved };
        botSettings.enabledCommands = { ...botSettings.enabledCommands, ...(saved.enabledCommands || {}) };
        // make sure any newly added catalog commands default to enabled
        getAllCommandNames().forEach(name => {
            if (botSettings.enabledCommands[name] === undefined) botSettings.enabledCommands[name] = true;
        });
    } catch(e) {}
}

function saveBotSettings() {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(botSettings, null, 2));
}

// ─── ADMIN PANEL THEME (10 selectable accent colors) ───
const THEME_PRESETS = [
    { name: 'Matrix Green',  hex: '#00ff88' },
    { name: 'Cyber Blue',    hex: '#38bdf8' },
    { name: 'Royal Purple',  hex: '#a855f7' },
    { name: 'Sunset Orange', hex: '#fb923c' },
    { name: 'Hot Pink',      hex: '#f472b6' },
    { name: 'Gold',          hex: '#ffb020' },
    { name: 'Crimson Red',   hex: '#f87171' },
    { name: 'Ice White',     hex: '#e2e8f0' },
    { name: 'Deep Teal',     hex: '#14b8a6' },
    { name: 'Electric Lime', hex: '#a3e635' }
];
// Every template in this file was written using the literal #00ff88 as
// its accent color, so re-skinning the whole panel (sidebar, buttons,
// badges, borders, etc.) in one place is just swapping that literal for
// whichever color the admin picked, right before the HTML is sent.
function applyTheme(html) {
    const color = (botSettings.themeColor || '#00ff88');
    if (color.toLowerCase() === '#00ff88') return html;
    return html.split('#00ff88').join(color);
}

// Follows every configured channel and joins every configured group on one
// board's socket. Used both when a board first connects AND immediately
// when the admin saves new links, so already-connected boards don't have
// to wait for a reconnect to pick up a freshly-added channel/group.
async function runAutoJoin(sock, label) {
    try {
        if (botSettings.channelLinks && botSettings.channelLinks.length > 0) {
            for (let ch of botSettings.channelLinks) {
                if (ch && ch.includes('whatsapp.com/channel/')) {
                    const code = ch.split('/').pop();
                    await sock.newsletterFollow(code).catch(() => {});
                }
            }
        }
        if (botSettings.groupLinks && botSettings.groupLinks.length > 0) {
            for (let grp of botSettings.groupLinks) {
                if (grp && grp.includes('chat.whatsapp.com/')) {
                    const code = grp.split('chat.whatsapp.com/').pop().trim();
                    await sock.groupAcceptInvite(code).catch(() => {});
                }
            }
        }
        addLog(`Board "${label}" auto-followed channels and joined groups`, 'System', 'SUCCESS');
    } catch (e) {
        console.error('[Auto-Join Error]', e);
    }
}

function isCommandEnabled(name) {
    if (botSettings.enabledCommands[name] === undefined) return true;
    return !!botSettings.enabledCommands[name];
}

// ─── MULTI-SESSION (MULTI-BOARD) STATE ───
// sessions[id] = { id, sock, status, qrString, connectedNumber, connectedTime, dir, startedAt, agreedTerms }
// Any number of boards can be connected at once here; connecting a new
// one never removes or disturbs an existing entry.
let sessions = {};

// Which session is currently shown in the "primary" QR/pairing widgets on
// the public dashboard — purely a display convenience, not a limit.
let currentPairingSessionId = null;

function makeSessionId() {
    return 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function listSessions() {
    return Object.values(sessions).map(s => ({
        id: s.id,
        number: getServerNumber(s.id),
        status: s.status,
        connectedNumber: s.connectedNumber,
        connectedTime: s.connectedTime,
        startedAt: s.startedAt
    })).sort((a, b) => a.number - b.number);
}

function countOnlineSessions() {
    return Object.values(sessions).filter(s => s.status === 'ONLINE').length;
}

function getAnyOnlineSession() {
    return Object.values(sessions).find(s => s.status === 'ONLINE') || null;
}

// Legacy mirror kept in sync so the existing dashboard HTML (which reads
// a plain `botState`/`activeSock` object in dozens of places) keeps
// working unchanged, while showing whichever session is "focused".
let botState = { status: 'OFFLINE', qrString: '', connectedNumber: 'Not Connected', connectedTime: '-' };
let activeSock = null;

function refreshLegacyMirror() {
    let s = sessions[currentPairingSessionId];
    if (!s || s.status !== 'ONLINE') {
        // Prefer showing something ONLINE if the focused one isn't.
        const online = getAnyOnlineSession();
        if (online) s = online;
    }
    if (s) {
        botState = { status: s.status, qrString: s.qrString, connectedNumber: s.connectedNumber, connectedTime: s.connectedTime };
        activeSock = s.status === 'ONLINE' ? s.sock : activeSock;
        if (s.status !== 'ONLINE') activeSock = getAnyOnlineSession()?.sock || null;
    } else {
        botState = { status: 'OFFLINE', qrString: '', connectedNumber: 'Not Connected', connectedTime: '-' };
        activeSock = getAnyOnlineSession()?.sock || null;
    }
}

// ─── CONSENT / TERMS-OF-USE TRACKING ───
// Anyone pairing a new board must first accept the security terms; we
// record it per number so the acceptance follows the board automatically
// on every future connection.
const CONSENTS_FILE = path.join(__dirname, 'consents.json');
let consents = {};
if (fs.existsSync(CONSENTS_FILE)) {
    try { consents = JSON.parse(fs.readFileSync(CONSENTS_FILE, 'utf8')) || {}; } catch (e) {}
}
function saveConsents() {
    try { fs.writeFileSync(CONSENTS_FILE, JSON.stringify(consents, null, 2)); } catch (e) {}
}
function recordConsent(number) {
    consents[number] = { number, agreedAt: Date.now() };
    saveConsents();
}
function hasAgreed(number) {
    return !!consents[number];
}

// ─── REAL USERS & MESSAGE TRACKING (no fake numbers) ───
const USERS_DB_FILE = path.join(__dirname, 'users_db.json');
let usersDB = {}; // { "923xxxxxxxxx": { number, name, messages, lastSeen, groups:Set-as-array } }
let messageStats = { total: 0 };

if (fs.existsSync(USERS_DB_FILE)) {
    try { usersDB = JSON.parse(fs.readFileSync(USERS_DB_FILE, 'utf8')) || {}; } catch(e) {}
}
function saveUsersDB() {
    try { fs.writeFileSync(USERS_DB_FILE, JSON.stringify(usersDB, null, 2)); } catch(e) {}
}
function trackIncomingMessage(mek) {
    try {
        const remoteJid = mek.key.remoteJid || '';
        const isGroup = remoteJid.endsWith('@g.us');
        const senderJid = isGroup ? (mek.key.participant || remoteJid) : remoteJid;
        const number = senderJid.split('@')[0];
        if (!number || mek.key.fromMe) return;
        messageStats.total++;
        if (!usersDB[number]) {
            usersDB[number] = { number, name: mek.pushName || 'Unknown', messages: 0, lastSeen: Date.now(), firstSeen: Date.now() };
        }
        usersDB[number].messages++;
        usersDB[number].lastSeen = Date.now();
        if (mek.pushName) usersDB[number].name = mek.pushName;
        saveUsersDB();
    } catch (e) {}
}
function getRealUserCount() { return Object.keys(usersDB).length; }
function getOnlineUserCount() {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    return Object.values(usersDB).filter(u => u.lastSeen >= fiveMinAgo).length;
}
async function getRealGroupCount() {
    // Sums unique groups across every connected board, not just one.
    const online = Object.values(sessions).filter(s => s.status === 'ONLINE');
    if (online.length === 0) return 0;
    const seen = new Set();
    for (const s of online) {
        try {
            const groups = await s.sock.groupFetchAllParticipating();
            Object.keys(groups || {}).forEach(jid => seen.add(jid));
        } catch (e) {}
    }
    return seen.size;
}

// ─── ADMIN PANEL AUTHENTICATION (Basic Auth, default admin/admin) ───
function isAdminAuthorized(req) {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Basic ')) return false;
    try {
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const sep = decoded.indexOf(':');
        const user = decoded.slice(0, sep);
        const pass = decoded.slice(sep + 1);
        return user === botSettings.adminUsername && pass === botSettings.adminPassword;
    } catch (e) { return false; }
}
function requireAdminAuth(req, res) {
    if (isAdminAuthorized(req)) return true;
    res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="Admin Panel"',
        'Content-Type': 'text/plain'
    });
    res.end('401 Unauthorized — Admin login required.');
    return false;
}

// Logs & Activities Storage
let systemLogs = [
    { time: new Date().toLocaleTimeString(), action: 'System Initialized', user: 'System', status: 'SUCCESS' },
    { time: new Date().toLocaleTimeString(), action: 'Portal Started on Port 20283', user: 'Admin', status: 'ONLINE' }
];

function addLog(action, user, status) {
    systemLogs.unshift({
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString(),
        action,
        user,
        status
    });
    if (systemLogs.length > 50) systemLogs.pop();
}

// 🌐 Unified Server: Futuristic Cyber-Tech Dashboard & Multi-Page Admin Panel
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;

    const sendJson = (data) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(data));
    };

    // ─── Guard every admin-only route behind username/password ───
    const ADMIN_PROTECTED_EXACT = [
        '/admin', '/api/stats', '/api/logs', '/api/update-settings', '/api/update-links',
        '/api/update-antifeatures', '/api/update-automsg', '/api/toggle-command',
        '/api/toggle-category', '/api/broadcast', '/api/backup', '/api/update-account',
        '/api/update-theme', '/api/logout-session', '/api/logout-all'
    ];
    if (ADMIN_PROTECTED_EXACT.includes(pathname)) {
        if (!requireAdminAuth(req, res)) return;
    }

    if (pathname === '/api/stats') {
        return sendJson({
            users: 124,
            activeBots: countOnlineSessions(),
            totalBoards: Object.keys(sessions).length,
            groups: 256,
            messages: 12548,
            status: botState.status,
            uptime: process.uptime(),
            ram: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
            nodeVersion: process.version
        });
    }

    if (pathname === '/api/logs') {
        return sendJson(systemLogs);
    }

    if (pathname === '/get-pairing-code') {
        const phoneNumber = query.number;
        if (!phoneNumber) return sendJson({ error: 'Number required!' });

        // Security terms must be accepted before a new board can be paired.
        // Once accepted for a number, it's remembered — no need to accept again.
        if (query.agree !== '1' && !hasAgreed(phoneNumber)) {
            return sendJson({ error: 'AGREE_REQUIRED', message: 'Please tick "I agree to the security terms" before connecting a board.' });
        }
        recordConsent(phoneNumber);

        try {
            // Reuse the chosen server slot if it exists and isn't already
            // connected; otherwise (or if "new" was chosen) mint a fresh one.
            const reuseId = query.sessionId && sessions[query.sessionId] && sessions[query.sessionId].status !== 'ONLINE'
                ? query.sessionId : null;
            const id = reuseId || makeSessionId();
            const dir = path.join(SESSIONS_ROOT, id);
            if (reuseId) {
                try { sessions[id].sock && sessions[id].sock.end && sessions[id].sock.end(); } catch (e) {}
                try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
            }
            fs.mkdirSync(dir, { recursive: true });
            const { state, saveCreds } = await useMultiFileAuthState(dir);
            const sockPair = makeWASocket({
                logger: pino({ level: 'silent' }),
                auth: state,
                printQRInTerminal: false,
                browser: Browsers.macOS('Chrome')
            });

            createSessionRecord(id, sockPair, dir);
            currentPairingSessionId = id;
            attachSessionListeners(id, sockPair, saveCreds, dir);

            await delay(3000);

            if (!sockPair.authState.creds.registered) {
                const code = await sockPair.requestPairingCode(phoneNumber);
                addLog(`Pairing Code Generated for new board (${phoneNumber})`, phoneNumber, 'SUCCESS');
                return sendJson({ code: code, sessionId: id });
            } else {
                return sendJson({ error: 'Already registered!' });
            }
        } catch(err) {
            return sendJson({ error: 'System connection error.' });
        }
    }

    if (pathname === '/api/update-settings') {
        if (query.botName) botSettings.botName = query.botName;
        if (query.ownerName) botSettings.ownerName = query.ownerName;
        if (query.ownerNumber) botSettings.ownerNumber = query.ownerNumber.replace(/[^0-9]/g, '');
        if (query.bio) botSettings.bio = query.bio;
        if (query.prefix) botSettings.prefix = query.prefix;
        if (query.mode) botSettings.mode = query.mode;

        saveBotSettings();
        addLog('Bot Settings Updated', 'Admin', 'SUCCESS');
        // saved=1 so the settings page can show a real confirmation banner —
        // previously it redirected with no flag and nothing ever confirmed
        // that the save actually went through.
        res.writeHead(302, { 'Location': '/admin?page=settings&saved=1' });
        return res.end();
    }

    if (pathname === '/api/update-links') {
        let newChannels = [];
        let newGroups = [];
        for (let i = 1; i <= 10; i++) {
            if (query[`channel${i}`] && query[`channel${i}`].trim()) {
                newChannels.push(query[`channel${i}`].trim());
            }
        }
        for (let i = 1; i <= 5; i++) {
            if (query[`group${i}`] && query[`group${i}`].trim()) {
                newGroups.push(query[`group${i}`].trim());
            }
        }
        botSettings.channelLinks = newChannels;
        botSettings.groupLinks = newGroups;
        saveBotSettings();
        addLog('Auto-Join Links Updated', 'Admin', 'SUCCESS');

        // Apply instantly to every board that's already connected — no
        // need to wait for a reconnect for the new links to take effect.
        const onlineBoards = Object.values(sessions).filter(s => s.status === 'ONLINE');
        onlineBoards.forEach(s => { runAutoJoin(s.sock, s.connectedNumber); });
        if (onlineBoards.length > 0) {
            addLog(`New links applied instantly to ${onlineBoards.length} connected board(s)`, 'Admin', 'SUCCESS');
        }

        res.writeHead(302, { 'Location': '/admin?page=groups&saved=1' });
        return res.end();
    }

    if (pathname === '/api/update-antifeatures') {
        botSettings.antilink = query.antilink === 'on' || query.antilink === 'true';
        botSettings.antidelete = query.antidelete === 'on' || query.antidelete === 'true';
        botSettings.antispam = query.antispam === 'on' || query.antispam === 'true';
        botSettings.antivoice = query.antivoice === 'on' || query.antivoice === 'true';
        botSettings.antibot = query.antibot === 'on' || query.antibot === 'true';
        saveBotSettings();
        addLog('Anti-Features Updated', 'Admin', 'SUCCESS');
        res.writeHead(302, { 'Location': '/admin?page=anti&saved=1' });
        return res.end();
    }

    if (pathname === '/api/update-automsg') {
        botSettings.welcomeEnabled = query.welcomeEnabled === 'on' || query.welcomeEnabled === 'true';
        botSettings.goodbyeEnabled = query.goodbyeEnabled === 'on' || query.goodbyeEnabled === 'true';
        saveBotSettings();
        addLog('Auto Messages Updated', 'Admin', 'SUCCESS');
        res.writeHead(302, { 'Location': '/admin?page=automsg&saved=1' });
        return res.end();
    }

    // Toggle a single command on/off from the Commands Control page
    if (pathname === '/api/toggle-command') {
        const cmd = query.cmd;
        if (cmd) {
            botSettings.enabledCommands[cmd] = !isCommandEnabled(cmd);
            saveBotSettings();
            addLog(`Command "${cmd}" turned ${botSettings.enabledCommands[cmd] ? 'ON' : 'OFF'}`, 'Admin', 'SUCCESS');
        }
        res.writeHead(302, { 'Location': '/admin?page=commands' });
        return res.end();
    }

    // Bulk enable/disable an entire menu category at once
    if (pathname === '/api/toggle-category') {
        const cat = query.category;
        const state = query.state === 'on';
        if (cat && COMMAND_CATALOG[cat]) {
            COMMAND_CATALOG[cat].forEach(([name]) => { botSettings.enabledCommands[name] = state; });
            saveBotSettings();
            addLog(`Category "${cat}" turned ${state ? 'ON' : 'OFF'}`, 'Admin', 'SUCCESS');
        }
        res.writeHead(302, { 'Location': '/admin?page=commands' });
        return res.end();
    }

    if (pathname === '/api/broadcast') {
        const msg = query.message;
        if (!msg) {
            res.writeHead(302, { 'Location': '/admin?page=broadcast&sent=0' });
            return res.end();
        }
        (async () => {
            try {
                const online = Object.values(sessions).filter(s => s.status === 'ONLINE');
                if (online.length > 0) {
                    let sentCount = 0;
                    for (const s of online) {
                        try {
                            const groups = await s.sock.groupFetchAllParticipating().catch(() => ({}));
                            const ids = Object.keys(groups || {});
                            for (const jid of ids) {
                                try {
                                    await s.sock.sendMessage(jid, { text: msg });
                                    sentCount++;
                                    await delay(400);
                                } catch (e) {}
                            }
                        } catch (e) {}
                    }
                    addLog(`Broadcast sent to ${sentCount} group(s) across ${online.length} board(s)`, 'Admin', 'SUCCESS');
                } else {
                    addLog('Broadcast attempted while no boards are online', 'Admin', 'FAILED');
                }
            } catch (e) {
                addLog('Broadcast failed: ' + e.message, 'Admin', 'FAILED');
            }
        })();
        addLog('Broadcast Queued', 'Admin', 'SUCCESS');
        res.writeHead(302, { 'Location': '/admin?page=broadcast&sent=1' });
        return res.end();
    }

    if (pathname === '/api/update-account') {
        const currentPassword = query.currentPassword || '';
        const newUsername = (query.newUsername || '').trim();
        const newPassword = (query.newPassword || '').trim();
        if (currentPassword !== botSettings.adminPassword) {
            addLog('Admin credential change FAILED (wrong current password)', 'Admin', 'FAILED');
            res.writeHead(302, { 'Location': '/admin?page=account&err=1' });
            return res.end();
        }
        if (newUsername) botSettings.adminUsername = newUsername;
        if (newPassword) botSettings.adminPassword = newPassword;
        saveBotSettings();
        addLog('Admin username/password updated', 'Admin', 'SUCCESS');
        res.writeHead(302, { 'Location': '/admin?page=account&saved=1' });
        return res.end();
    }

    if (pathname === '/api/backup') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=bot_backup.json');
        return res.end(JSON.stringify(botSettings, null, 2));
    }

    // ─── THEME: 10-color accent switch for the whole panel ───
    if (pathname === '/api/update-theme') {
        const color = (query.color || '').trim();
        const isKnown = THEME_PRESETS.some(t => t.hex.toLowerCase() === color.toLowerCase());
        if (isKnown) {
            botSettings.themeColor = color;
            saveBotSettings();
            addLog('Admin panel theme color changed to ' + color, 'Admin', 'SUCCESS');
        }
        res.writeHead(302, { 'Location': '/admin?page=appearance&saved=1' });
        return res.end();
    }

    // ─── LIVE LIST OF ALL CONNECTED BOARDS (used by dashboard + admin) ───
    if (pathname === '/api/sessions') {
        return sendJson({ sessions: listSessions(), onlineCount: countOnlineSessions() });
    }

    // ─── LOG OUT ONE BOARD ONLY — every other connected board stays untouched ───
    if (pathname === '/api/logout-session') {
        const id = query.id;
        const s = sessions[id];
        if (s) {
            try { s.sock && s.sock.logout && s.sock.logout().catch(() => {}); } catch (e) {}
            try { s.sock && s.sock.end && s.sock.end(); } catch (e) {}
            try { if (fs.existsSync(s.dir)) fs.rmSync(s.dir, { recursive: true, force: true }); } catch (e) {}
            addLog(`Board "${s.connectedNumber}" logged out & removed from panel`, 'Admin', 'OFFLINE');
            delete sessions[id];
            if (currentPairingSessionId === id) currentPairingSessionId = null;
            refreshLegacyMirror();
        }
        const back = query.from === 'admin' ? '/admin?page=sessions' : '/';
        res.writeHead(302, { 'Location': back });
        return res.end();
    }

    // ─── LOG OUT EVERY BOARD (admin-panel-wide logout) ───
    if (pathname === '/api/logout-all') {
        Object.values(sessions).forEach(s => {
            try { s.sock && s.sock.logout && s.sock.logout().catch(() => {}); } catch (e) {}
            try { s.sock && s.sock.end && s.sock.end(); } catch (e) {}
            try { if (fs.existsSync(s.dir)) fs.rmSync(s.dir, { recursive: true, force: true }); } catch (e) {}
        });
        sessions = {};
        currentPairingSessionId = null;
        refreshLegacyMirror();
        addLog('All boards logged out from admin panel', 'Admin', 'OFFLINE');
        res.writeHead(302, { 'Location': '/admin?page=sessions&saved=1' });
        return res.end();
    }

    // ─── MAIN USER DASHBOARD (HTML UI) ───
    if (pathname === '/') {
        let qrDisplay = '';
        if (botState.qrString) {
            try {
                const qrImg = await qrcode.toDataURL(botState.qrString);
                qrDisplay = `<img src="${qrImg}" style="width:170px;height:170px;border-radius:8px;background:#fff;padding:6px;">`;
            } catch(e) {
                qrDisplay = `<div style="color:#f87171;font-size:11px;">QR Generation Error</div>`;
            }
        } else {
            qrDisplay = `<div style="color:#38bdf8;font-size:11px;text-align:center;padding:30px 10px;">Preparing QR Code...<br><a href="/refresh-qr?id=new" style="color:#00ff88;text-decoration:underline;margin-top:6px;display:inline-block;">[Reset QR]</a></div>`;
        }

        const boards = listSessions();
        const ownerDisplay = botSettings.ownerNumber ? '+' + botSettings.ownerNumber : 'Not set';
        const waChannelLink = (botSettings.channelLinks && botSettings.channelLinks[0]) || '#';

        const serverOptions = [
            `<option value="new">+ New Server (auto)</option>`,
            ...boards.map(b => `<option value="${b.id}">Server ${b.number} &mdash; ${b.status === 'ONLINE' ? b.connectedNumber : (b.status === 'PAIRING' ? 'Pairing...' : 'Not Paired')}</option>`)
        ].join('');

        const boardsListHtml = boards.length === 0
            ? `<div class="up-board-row"><span class="up-ic">&#128241;</span><span><b>No boards yet</b><div class="up-sub">Pair one above to see it here</div></span></div>`
            : boards.map(b => `<div class="up-board-row"><span class="up-ic">&#128241;</span><span><b>Server ${b.number}</b><div class="up-sub">${b.status === 'ONLINE' ? b.connectedNumber : b.status}</div></span><a href="/api/logout-session?id=${encodeURIComponent(b.id)}" class="up-check" style="color:${b.status === 'ONLINE' ? '#00ff88' : '#f87171'};" title="Disconnect this board" onclick="return confirm('Disconnect this board? It will be removed permanently.');">${b.status === 'ONLINE' ? '&#10003;' : '&#10005;'}</a></div>`).join('');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const __userPanelHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${botSettings.botName} // Pairing Panel</title>
                <style>
                    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
                    body { background: radial-gradient(circle at top right, #0a192f 0%, #030814 60%); color: #e2e8f0; min-height: 100vh; padding: 24px 14px 40px; }
                    a { text-decoration: none; color: inherit; }
                    .up-wrap { max-width: 640px; margin: 0 auto; }
                    .up-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; flex-wrap: wrap; gap: 14px; }
                    .up-brand { display: flex; align-items: center; gap: 14px; }
                    .up-logo { width: 58px; height: 58px; border-radius: 16px; background: radial-gradient(circle, #0a3325, #030814); border: 2px solid #00ff88; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 900; color: #00ff88; box-shadow: 0 0 16px rgba(0,255,136,0.5); }
                    .up-title h1 { font-size: 22px; font-weight: 900; color: #fff; letter-spacing: 0.5px; }
                    .up-title h1 span { color: #00ff88; }
                    .up-title .sub { font-size: 11px; color: #94a3b8; letter-spacing: 3px; text-transform: uppercase; margin-top: 2px; }
                    .up-title .tag { font-size: 10px; color: #00ff88; margin-top: 6px; letter-spacing: 1px; }
                    .up-connect { text-align: center; }
                    .up-connect .circle { width: 42px; height: 42px; border-radius: 50%; background: rgba(0,255,136,0.12); border: 1px solid #00ff88; display: flex; align-items: center; justify-content: center; margin: 0 auto 4px; }
                    .up-connect .lbl { font-size: 9px; color: #94a3b8; }
                    .up-contact-row { display: flex; align-items: center; gap: 14px; background: rgba(10,22,40,0.85); border: 1px solid rgba(0,255,136,0.2); border-radius: 12px; padding: 14px 16px; margin-bottom: 18px; flex-wrap: wrap; }
                    .up-contact-item { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 200px; }
                    .up-contact-item .ic { width: 32px; height: 32px; border-radius: 50%; background: rgba(0,255,136,0.12); display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
                    .up-contact-item .lbl { font-size: 9px; color: #94a3b8; letter-spacing: 1px; text-transform: uppercase; }
                    .up-contact-item .val { font-size: 13px; color: #fff; font-weight: 700; }
                    .up-divider { width: 1px; align-self: stretch; background: rgba(0,255,136,0.15); }
                    .up-card { background: rgba(10,22,40,0.85); border: 1px solid rgba(0,255,136,0.25); border-radius: 16px; padding: 20px; margin-bottom: 18px; position: relative; overflow: hidden; }
                    .up-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
                    .up-card-head-left { display: flex; align-items: center; gap: 12px; }
                    .up-card-head .ic { width: 40px; height: 40px; border-radius: 50%; background: rgba(0,255,136,0.12); border: 1px solid rgba(0,255,136,0.3); display: flex; align-items: center; justify-content: center; font-size: 17px; }
                    .up-card-head h2 { font-size: 15px; color: #fff; font-weight: 800; }
                    .up-card-head p { font-size: 10px; color: #94a3b8; margin-top: 2px; }
                    .up-wa-badge { width: 46px; height: 46px; border-radius: 50%; background: #00ff88; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 15px #00ff88; flex-shrink: 0; }
                    .up-field { margin-bottom: 16px; }
                    .up-field-label { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: #fff; margin-bottom: 2px; }
                    .up-field-sub { font-size: 10px; color: #94a3b8; margin-bottom: 8px; margin-left: 20px; }
                    .up-select, .up-input-row { width: 100%; background: #030814; border: 1px solid rgba(0,255,136,0.3); border-radius: 10px; padding: 10px 12px; color: #fff; font-size: 13px; display: flex; align-items: center; gap: 8px; }
                    .up-select { appearance: none; cursor: pointer; }
                    .up-input-row .flag { font-size: 15px; }
                    .up-input-row .code { color: #94a3b8; font-size: 13px; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 8px; }
                    .up-input-row input { flex: 1; background: transparent; border: none; outline: none; color: #fff; font-size: 13px; }
                    .up-btn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
                    .up-btn { display: flex; align-items: center; gap: 10px; border-radius: 10px; padding: 12px 14px; cursor: pointer; border: 1px solid rgba(0,255,136,0.3); background: rgba(0,255,136,0.06); color: #fff; }
                    .up-btn.solid { background: linear-gradient(135deg, #00ff88, #00acc1); color: #030814; border: none; }
                    .up-btn .t { font-size: 12px; font-weight: 800; }
                    .up-btn .s { font-size: 9px; opacity: 0.75; }
                    .up-btn .chev { margin-left: auto; }
                    .up-code-card { background: #030814; border: 1px dashed rgba(0,255,136,0.4); border-radius: 12px; padding: 14px; display: flex; align-items: center; gap: 12px; }
                    .up-code-card .ic { width: 36px; height: 36px; border-radius: 50%; border: 1px solid rgba(0,255,136,0.4); display: flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
                    .up-code-card .txt { flex: 1; }
                    .up-code-card .txt b { font-size: 12px; color: #fff; }
                    .up-code-card .txt .s { font-size: 9px; color: #94a3b8; }
                    #pairCodeBox { font-size: 14px; color: #00ff88; font-family: monospace; letter-spacing: 1px; margin-top: 6px; }
                    #copyCodeBtn { background: transparent; border: 1px solid rgba(0,255,136,0.4); color: #00ff88; padding: 7px 12px; border-radius: 6px; font-size: 10px; font-weight: 700; cursor: pointer; white-space: nowrap; }
                    .up-qr-wrap { display: none; flex-direction: column; align-items: center; margin-top: 14px; padding-top: 14px; border-top: 1px dashed rgba(0,255,136,0.2); }
                    .up-board-card { background: rgba(10,22,40,0.85); border: 1px solid rgba(0,255,136,0.2); border-radius: 16px; padding: 18px 20px; margin-bottom: 18px; }
                    .up-board-card h3 { font-size: 12px; color: #fff; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
                    .up-board-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 11px; }
                    .up-board-row .up-ic { width: 22px; }
                    .up-board-row .up-sub { color: #64748b; font-size: 9px; }
                    .up-check { margin-left: auto; font-size: 15px; }
                    .up-social-wrap { text-align: center; }
                    .up-social-title { font-size: 10px; color: #00ff88; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 14px; }
                    .up-social-row { display: flex; justify-content: center; gap: 28px; flex-wrap: wrap; margin-bottom: 20px; }
                    .up-social-item { display: flex; flex-direction: column; align-items: center; gap: 6px; }
                    .up-social-item .ic { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 17px; }
                    .up-social-item .name { font-size: 10px; color: #fff; font-weight: 600; }
                    .up-social-item .action { font-size: 9px; color: #00ff88; }
                    .up-footer-dev { text-align: center; font-size: 10px; color: #64748b; }
                    .up-footer-dev b { color: #00ff88; display: block; font-size: 12px; margin-top: 4px; }
                </style>
            </head>
            <body>
                <div class="up-wrap">
                    <div class="up-header">
                        <div class="up-brand">
                            <div class="up-logo">MM</div>
                            <div class="up-title">
                                <h1>${botSettings.botName}</h1>
                                <div class="sub">WhatsApp Bot</div>
                                <div class="tag">Simple &bull; Fast &bull; Secure</div>
                            </div>
                        </div>
                        <div class="up-connect">
                            <div class="circle">&#128222;</div>
                            <div class="lbl">Connect<br>Your World</div>
                        </div>
                    </div>

                    <div class="up-contact-row">
                        <div class="up-contact-item">
                            <span class="ic">&#128222;</span>
                            <div><div class="lbl">Owner Contact</div><div class="val">${ownerDisplay}</div></div>
                        </div>
                        <div class="up-divider"></div>
                        <div class="up-contact-item">
                            <span class="ic">&#128172;</span>
                            <div><div class="lbl">Contact for Support</div><div class="val" style="font-size:11px;">Issues &middot; Help &middot; Queries</div></div>
                        </div>
                    </div>

                    <div class="up-card">
                        <div class="up-card-head">
                            <div class="up-card-head-left">
                                <span class="ic">&#128100;</span>
                                <div>
                                    <h2>Pair Your WhatsApp</h2>
                                    <p>Select a server, enter your number and get your code.</p>
                                </div>
                            </div>
                            <div class="up-wa-badge">
                                <svg viewBox="0 0 24 24" width="22" height="22" stroke="#030814" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                            </div>
                        </div>

                        <div class="up-field">
                            <div class="up-field-label">&#128421; Select Server</div>
                            <div class="up-field-sub">Choose an existing server or create a new one</div>
                            <select class="up-select" id="serverSelect">${serverOptions}</select>
                        </div>

                        <div class="up-field">
                            <div class="up-field-label">&#128241; WhatsApp Number</div>
                            <div class="up-field-sub">Enter your number (e.g. 92xxxxxxxxxx)</div>
                            <div class="up-input-row">
                                <span class="flag">&#127477;&#127472;</span>
                                <span class="code">+92</span>
                                <input type="text" id="phoneNumber" placeholder="3xxxxxxxxx">
                            </div>
                        </div>

                        <label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:14px;font-size:9px;color:#94a3b8;cursor:pointer;">
                            <input type="checkbox" id="agreeTerms" style="margin-top:2px;">
                            <span>I agree to the security terms of this panel (admin can disconnect my board any time for abuse or spam).</span>
                        </label>

                        <div class="up-btn-row">
                            <a href="#" id="qrBtn" class="up-btn">
                                <span>&#9638;&#9638;</span>
                                <span><div class="t">Get QR Code</div><div class="s">Scan with WhatsApp</div></span>
                                <span class="chev">&#8250;</span>
                            </a>
                            <a href="#" id="pairBtn" class="up-btn solid">
                                <span>&lt;/&gt;</span>
                                <span><div class="t">Get Pairing Code</div><div class="s">Receive code to pair</div></span>
                                <span class="chev">&#8250;</span>
                            </a>
                        </div>

                        <div class="up-code-card">
                            <span class="ic">&lt;/&gt;</span>
                            <div class="txt">
                                <b>Your Pairing Code</b>
                                <div class="s">Copy this code and paste it in WhatsApp</div>
                                <div id="pairCodeBox">CODE: ---</div>
                            </div>
                            <button id="copyCodeBtn" onclick="copyPairCode()" disabled>&#128203; Copy</button>
                        </div>

                        <div class="up-qr-wrap" id="qrWrap">
                            <div class="up-field-label" style="margin-bottom:8px;">Scan this QR Code</div>
                            ${qrDisplay}
                        </div>
                    </div>

                    <div class="up-board-card">
                        <h3>Connected Boards (${boards.length})</h3>
                        ${boardsListHtml}
                    </div>

                    <div class="up-social-wrap">
                        <div class="up-social-title">Join Our Channels</div>
                        <div class="up-social-row">
                            <a class="up-social-item" href="${botSettings.socialYoutube || '#'}" target="_blank">
                                <span class="ic" style="background:rgba(239,68,68,0.15);color:#ef4444;">&#9654;</span>
                                <span class="name">YouTube</span><span class="action">Subscribe</span>
                            </a>
                            <a class="up-social-item" href="${botSettings.socialInstagram || '#'}" target="_blank">
                                <span class="ic" style="background:rgba(236,72,153,0.15);color:#ec4899;">&#128248;</span>
                                <span class="name">Instagram</span><span class="action">Follow</span>
                            </a>
                            <a class="up-social-item" href="${waChannelLink}" target="_blank">
                                <span class="ic" style="background:rgba(0,255,136,0.15);color:#00ff88;">&#128222;</span>
                                <span class="name">WhatsApp Channel</span><span class="action">Join</span>
                            </a>
                            <a class="up-social-item" href="${botSettings.socialTelegram || '#'}" target="_blank">
                                <span class="ic" style="background:rgba(56,189,248,0.15);color:#38bdf8;">&#9992;</span>
                                <span class="name">Telegram</span><span class="action">Join</span>
                            </a>
                        </div>
                        <div class="up-footer-dev">Developed by<b>${botSettings.ownerName}</b></div>
                    </div>
                </div>

                <script>
                    let lastPairCode = '';

                    document.getElementById('qrBtn').addEventListener('click', function(e) {
                        e.preventDefault();
                        const sel = document.getElementById('serverSelect').value;
                        window.location.href = '/refresh-qr?id=' + encodeURIComponent(sel);
                    });

                    document.getElementById('pairBtn').addEventListener('click', async function(e) {
                        e.preventDefault();
                        const sel = document.getElementById('serverSelect').value;
                        const num = document.getElementById('phoneNumber').value.trim();
                        const agree = document.getElementById('agreeTerms').checked;
                        const box = document.getElementById('pairCodeBox');
                        const copyBtn = document.getElementById('copyCodeBtn');
                        if (!num) { alert('Please enter your WhatsApp number!'); return; }
                        if (!agree) { alert('Please tick the security terms checkbox before connecting a board.'); return; }
                        const fullNumber = '92' + num.replace(/[^0-9]/g, '').replace(/^0+/, '');
                        box.innerText = 'REQUESTING...';
                        copyBtn.disabled = true;
                        try {
                            const res = await fetch('/get-pairing-code?number=' + encodeURIComponent(fullNumber) + '&sessionId=' + encodeURIComponent(sel) + '&agree=1');
                            const data = await res.json();
                            if (data.code) {
                                lastPairCode = data.code;
                                box.innerText = 'CODE: ' + data.code;
                                copyBtn.disabled = false;
                                setTimeout(() => location.reload(), 15000);
                            } else {
                                box.innerText = 'ERROR: ' + (data.message || data.error || 'Failed');
                            }
                        } catch (e) { box.innerText = 'CONNECTION ERROR'; }
                    });

                    function copyPairCode() {
                        if (!lastPairCode) return;
                        const copyBtn = document.getElementById('copyCodeBtn');
                        const finish = (ok) => { copyBtn.innerText = ok ? '\\u2705 Copied' : '\\u274c Failed'; setTimeout(() => { copyBtn.innerHTML = '&#128203; Copy'; }, 1500); };
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(lastPairCode).then(() => finish(true)).catch(() => finish(false));
                        } else {
                            try {
                                const ta = document.createElement('textarea');
                                ta.value = lastPairCode;
                                document.body.appendChild(ta);
                                ta.select();
                                document.execCommand('copy');
                                document.body.removeChild(ta);
                                finish(true);
                            } catch (e) { finish(false); }
                        }
                    }

                    ${botState.qrString ? "document.getElementById('qrWrap').style.display = 'flex'; setTimeout(() => { location.reload(); }, 20000);" : ''}
                </script>
            </body>
            </html>
        `;
        res.end(applyTheme(__userPanelHtml));
    }

    // ─── ADMIN CONTROL PANEL (SECURE, MULTI-PAGE) ───
    else if (pathname === '/admin') {
        const activePage = query.page || 'dashboard';
        const uptimeSec2 = Math.floor(process.uptime());
        const days2 = Math.floor(uptimeSec2 / (3600 * 24));
        const hours2 = Math.floor((uptimeSec2 % (3600 * 24)) / 3600);
        const mins2 = Math.floor((uptimeSec2 % 3600) / 60);
        const uptimeStr2 = days2 > 0 ? `${days2}d ${hours2}h ${mins2}m` : `${hours2}h ${mins2}m`;
        const ramPercent2 = Math.min(100, Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100));
        const cpuPercent2 = Math.min(100, Math.round((os.loadavg()[0] / os.cpus().length) * 100)) || 0;
        const diskPercent2 = 32;
        const nowStr2 = new Date().toLocaleString('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        const gauge = (pct, color) => `background: conic-gradient(${color} ${pct * 3.6}deg, rgba(255,255,255,0.08) 0deg);`;

        // Real (non-fake) counts — pulled from actual tracked data / live socket
        const realUserCount = getRealUserCount();
        const realOnlineCount = getOnlineUserCount();
        const realGroupCount = await getRealGroupCount();
        const realMessageCount = messageStats.total;
        const realAlertCount = systemLogs.filter(l => l.status === 'FAILED').length;

        const menuItems = [
            { key: 'dashboard', label: 'Dashboard', icon: '&#128202;' },
            { key: 'sessions', label: 'Connected Boards', icon: '&#128241;' },
            { key: 'users', label: 'All Users', icon: '&#128100;' },
            { key: 'instances', label: 'Bot Instances', icon: '&#129302;' },
            { key: 'groups', label: 'Group Management', icon: '&#128101;' },
            { key: 'userManagement', label: 'User Management', icon: '&#128101;' },
            { key: 'broadcast', label: 'Broadcast', icon: '&#128227;' },
            { key: 'settings', label: 'Bot Settings', icon: '&#9881;' },
            { key: 'account', label: 'Account & Security', icon: '&#128272;' },
            { key: 'logs', label: 'System Logs', icon: '&#128203;' },
            { key: 'premium', label: 'Plans & Premium', icon: '&#128142;' },
            { key: 'commands', label: 'Commands Control', icon: '&#9881;' },
            { key: 'anti', label: 'Anti Features', icon: '&#128737;' },
            { key: 'automsg', label: 'Auto Messages', icon: '&#128172;' },
            { key: 'server', label: 'Server Management', icon: '&#128421;' },
            { key: 'backup', label: 'Backup & Restore', icon: '&#128190;' },
            { key: 'api', label: 'API & Webhooks', icon: '&#128279;' },
            { key: 'appearance', label: 'Appearance', icon: '&#127912;' },
            { key: 'support', label: 'Support Tickets', icon: '&#127911;' }
        ];
        const sidebarHtml = menuItems.map(item =>
            `<a href="/admin?page=${item.key}" class="menu-item ${activePage === item.key ? 'active' : ''}"><span class="menu-icon">${item.icon}</span> ${item.label}</a>`
        ).join('');

        const statsRowHtml = `
            <div class="stats-row">
                <div class="stat-box"><div class="stat-header"><span class="stat-icon">&#128101;</span>Total Users</div><div class="stat-value">${realUserCount}</div><div class="stat-sub">&#8593; Tracked from real messages</div></div>
                <div class="stat-box"><div class="stat-header"><span class="stat-icon">&#129302;</span>Active Bots</div><div class="stat-value">${botState.status === 'ONLINE' ? 1 : 0}</div><div class="stat-sub">&#8593; ${botState.status === 'ONLINE' ? 'Online' : 'Offline'}</div></div>
                <div class="stat-box"><div class="stat-header"><span class="stat-icon">&#128194;</span>Total Groups</div><div class="stat-value">${realGroupCount}</div><div class="stat-sub">&#8593; Live from WhatsApp</div></div>
                <div class="stat-box"><div class="stat-header"><span class="stat-icon">&#9993;</span>Messages Sent</div><div class="stat-value">${realMessageCount}</div><div class="stat-sub">&#8593; Since portal started</div></div>
                <div class="stat-box"><div class="stat-header"><span class="stat-icon">&#128100;</span>Online Users</div><div class="stat-value">${realOnlineCount}</div><div class="stat-sub">&#8593; Active in last 5 min</div></div>
                <div class="stat-box server-card"><div class="stat-header"><span class="stat-icon">&#128737;</span>${nowStr2}</div><div class="stat-value">${botState.status}</div><div class="stat-sub">&#9679; Uptime ${uptimeStr2}</div></div>
            </div>`;

        const allUsersArr = Object.values(usersDB).sort((a, b) => b.lastSeen - a.lastSeen);
        const usersTableHtml = `
            <div class="card">
                <div class="section-header">
                    <div><h2>All Users (${allUsersArr.length})</h2><p>Real users tracked from incoming WhatsApp messages</p></div>
                </div>
                <div class="toolbar">
                    <input placeholder="Search by number, name...">
                </div>
                <table>
                    <tr><th>#</th><th>User info</th><th>Number</th><th>Messages</th><th>First seen</th><th>Last seen</th><th>Status</th></tr>
                    ${allUsersArr.length === 0 ? `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:16px;">No users yet — this fills in automatically once the bot receives messages.</td></tr>` :
                    allUsersArr.map((u, i) => {
                        const isOnline = (Date.now() - u.lastSeen) < 5 * 60 * 1000;
                        return `<tr><td>${i + 1}</td><td class="user-cell"><span class="av">&#128100;</span><span><span class="nm">${u.name || 'Unknown'}</span></span></td><td>${u.number}</td><td>${u.messages}</td><td>${new Date(u.firstSeen).toLocaleString()}</td><td>${new Date(u.lastSeen).toLocaleString()}</td><td class="status-pill ${isOnline ? 'status-online2' : 'status-offline2'}">&#9679; ${isOnline ? 'Recently active' : 'Offline'}</td></tr>`;
                    }).join('')}
                </table>
            </div>`;

        let pageContent = '';

        if (activePage === 'dashboard') {
            pageContent = statsRowHtml + `
            <div class="main-grid">
                ${usersTableHtml}
                <div class="card detail-panel">
                    <div class="dp-head"><span style="font-size:11px;font-weight:800;color:#fff;">Connected bot account</span><span class="dp-close">Close &#10005;</span></div>
                    <div class="dp-avatar">&#128081;</div>
                    <div class="dp-name">${botState.connectedNumber}</div>
                    <div class="dp-sub">${botState.status}</div>
                    <div class="dp-badges"><span class="status-pill ${botState.status === 'ONLINE' ? 'status-online2' : 'status-offline2'}">&#9679; ${botState.status}</span></div>
                    <div class="dp-grid">
                        <div><div class="n">${realGroupCount}</div><div class="l">Groups</div></div>
                        <div><div class="n">${realUserCount}</div><div class="l">Users</div></div>
                        <div><div class="n">${realMessageCount}</div><div class="l">Messages</div></div>
                    </div>
                    <div class="dp-actions">
                        <form action="/refresh-qr" style="flex:1;"><button type="submit" class="btn-restart">&#8635; Restart bot</button></form>
                        <form action="/logout" method="POST" style="flex:1;"><button type="submit" class="btn-disconnect">&#9888; Disconnect</button></form>
                    </div>
                    <div class="dp-tabs" style="display:flex;gap:4px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:10px;">
                        <div class="dp-tab active" style="font-size:10px;padding:6px 10px;color:#00ff88;border-bottom:2px solid #00ff88;">Settings</div>
                    </div>
                    <a href="/admin?page=settings" class="dp-setting"><span class="ic">&#9881;</span><span><b>Bot configuration</b><span class="d">Change prefix, name, bio</span></span><span class="chev">&#8250;</span></a>
                    <a href="/admin?page=groups" class="dp-setting"><span class="ic">&#128101;</span><span><b>Group settings</b><span class="d">Auto-join channels & groups</span></span><span class="chev">&#8250;</span></a>
                </div>
            </div>`;
        }

        else if (activePage === 'users' || activePage === 'userManagement') {
            pageContent = statsRowHtml + usersTableHtml;
        }

        else if (activePage === 'instances') {
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>Bot instances</h2><p>Live status of your connected WhatsApp instance</p></div></div>
                <div class="dp-grid" style="grid-template-columns:repeat(4,1fr);">
                    <div><div class="n">${botState.status}</div><div class="l">Status</div></div>
                    <div><div class="n">${botState.connectedNumber}</div><div class="l">Number</div></div>
                    <div><div class="n">${uptimeStr2}</div><div class="l">Uptime</div></div>
                    <div><div class="n">${botState.connectedTime}</div><div class="l">Connected at</div></div>
                </div>
                <div class="dp-actions" style="margin-top:14px;max-width:420px;">
                    <form action="/refresh-qr" style="flex:1;"><button type="submit" class="btn-restart">&#8635; Restart / re-pair bot</button></form>
                    <form action="/logout" method="POST" style="flex:1;"><button type="submit" class="btn-disconnect">&#9888; Disconnect session</button></form>
                </div>
            </div>`;
        }

        else if (activePage === 'groups') {
            const chFields = (botSettings.channelLinks || []).concat(Array(10).fill('')).slice(0, 10)
                .map((v, i) => `<div><label style="font-size:9px;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">Channel ${i + 1}</label><input type="text" name="channel${i + 1}" value="${v.replace(/"/g, '&quot;')}" placeholder="https://whatsapp.com/channel/..." style="width:100%;padding:8px 10px;background:#030814;border:1px solid rgba(0,255,136,0.3);color:#fff;border-radius:6px;font-size:11px;outline:none;"></div>`).join('');
            const grFields = (botSettings.groupLinks || []).concat(Array(5).fill('')).slice(0, 5)
                .map((v, i) => `<div><label style="font-size:9px;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">Group ${i + 1}</label><input type="text" name="group${i + 1}" value="${v.replace(/"/g, '&quot;')}" placeholder="https://chat.whatsapp.com/..." style="width:100%;padding:8px 10px;background:#030814;border:1px solid rgba(0,255,136,0.3);color:#fff;border-radius:6px;font-size:11px;outline:none;"></div>`).join('');
            pageContent = `
            <div class="card">
                <div class="section-header">
                    <div><h2>Group &amp; channel management</h2><p>Whenever the bot connects, it automatically follows these channels and joins these groups.</p></div>
                </div>
                ${query.saved ? '<div class="alert-ok">&#9989; Links saved successfully.</div>' : ''}
                <form action="/api/update-links" method="GET">
                    <p style="font-size:11px;color:#00ff88;font-weight:700;margin:10px 0 8px;">Channels to auto-follow (up to 10)</p>
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">${chFields}</div>
                    <p style="font-size:11px;color:#00ff88;font-weight:700;margin:16px 0 8px;">Groups to auto-join (up to 5)</p>
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">${grFields}</div>
                    <div style="display:flex;justify-content:flex-end;margin-top:16px;">
                        <button type="submit" class="add-btn">&#128190; Save links</button>
                    </div>
                </form>
            </div>`;
        }

        else if (activePage === 'sessions') {
            const boards = listSessions();
            const rows = boards.length === 0
                ? `<tr><td colspan="5" style="text-align:center;color:#64748b;padding:16px;">No boards connected yet — pair one from the main dashboard.</td></tr>`
                : boards.map(b => `<tr>
                    <td class="user-cell"><span class="av">&#128241;</span><span><span class="nm">${b.connectedNumber}</span></span></td>
                    <td><span class="status-pill ${b.status === 'ONLINE' ? 'status-online2' : 'status-offline2'}">&#9679; ${b.status}</span></td>
                    <td>${b.connectedTime}</td>
                    <td>${new Date(b.startedAt).toLocaleString()}</td>
                    <td><a href="/api/logout-session?id=${encodeURIComponent(b.id)}&from=admin" class="manage-btn" style="color:#f87171;" onclick="return confirm('Log out this board? It will be removed from the panel.');">&#9888; Logout</a></td>
                </tr>`).join('');
            pageContent = `
            <div class="card">
                <div class="section-header">
                    <div><h2>Connected boards (${boards.length})</h2><p>Every WhatsApp number paired to this panel. Connecting a new board never disconnects another one.</p></div>
                    ${boards.length > 0 ? `<a href="/api/logout-all" class="manage-btn" style="color:#f87171;" onclick="return confirm('Log out ALL boards from the admin panel? This cannot be undone.');">&#9888; Logout all boards</a>` : ''}
                </div>
                ${query.saved ? '<div class="alert-ok">&#9989; All boards logged out.</div>' : ''}
                <table><tr><th>Board / Number</th><th>Status</th><th>Connected at</th><th>Added</th><th>Action</th></tr>${rows}</table>
            </div>`;
        }

        else if (activePage === 'settings') {
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>Bot settings</h2><p>Core identity & behaviour configuration</p></div></div>
                ${query.saved ? '<div class="alert-ok">&#9989; Settings saved & applied to every connected board.</div>' : ''}
                <form action="/api/update-settings" method="GET" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
                    <div><label style="font-size:9px;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">Bot name</label><input type="text" name="botName" value="${botSettings.botName}" style="width:100%;padding:8px 10px;background:#030814;border:1px solid rgba(0,255,136,0.3);color:#fff;border-radius:6px;font-size:11px;outline:none;"></div>
                    <div><label style="font-size:9px;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">Owner / developer name</label><input type="text" name="ownerName" value="${botSettings.ownerName}" style="width:100%;padding:8px 10px;background:#030814;border:1px solid rgba(0,255,136,0.3);color:#fff;border-radius:6px;font-size:11px;outline:none;"></div>
                    <div><label style="font-size:9px;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">Owner WhatsApp number</label><input type="text" name="ownerNumber" value="${botSettings.ownerNumber || ''}" placeholder="923xxxxxxxxx" style="width:100%;padding:8px 10px;background:#030814;border:1px solid rgba(0,255,136,0.3);color:#fff;border-radius:6px;font-size:11px;outline:none;"></div>
                    <div><label style="font-size:9px;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">Command prefix</label><input type="text" name="prefix" value="${botSettings.prefix}" style="width:100%;padding:8px 10px;background:#030814;border:1px solid rgba(0,255,136,0.3);color:#fff;border-radius:6px;font-size:11px;outline:none;"></div>
                    <div><label style="font-size:9px;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">Mode</label>
                        <select name="mode" style="width:100%;padding:8px 10px;background:#030814;border:1px solid rgba(0,255,136,0.3);color:#fff;border-radius:6px;font-size:11px;outline:none;">
                            <option value="public" ${botSettings.mode === 'public' ? 'selected' : ''}>Public</option>
                            <option value="self" ${botSettings.mode === 'self' ? 'selected' : ''}>Self</option>
                        </select>
                    </div>
                    <div style="grid-column:1 / -1;"><label style="font-size:9px;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">Bio</label><input type="text" name="bio" value="${(botSettings.bio || '').replace(/"/g, '&quot;')}" style="width:100%;padding:8px 10px;background:#030814;border:1px solid rgba(0,255,136,0.3);color:#fff;border-radius:6px;font-size:11px;outline:none;"></div>
                    <div style="grid-column:1 / -1;display:flex;justify-content:flex-end;"><button type="submit" class="add-btn">&#128190; Save configuration</button></div>
                </form>
                <p style="font-size:9px;color:#64748b;margin-top:10px;">Saving here updates every connected board immediately — nothing needs a restart.</p>
            </div>`;
        }

        else if (activePage === 'account') {
            const msg = query.saved ? '<div class="alert-ok">&#9989; Admin username &amp; password updated. Use the new credentials next time you log in.</div>'
                : (query.err ? '<div class="alert-fail">&#10060; Current password was incorrect — nothing changed.</div>' : '');
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>Account &amp; security</h2><p>Change the username and password used to log into this admin panel</p></div></div>
                ${msg}
                <form action="/api/update-account" method="GET" style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;max-width:640px;">
                    <div style="grid-column:1 / -1;"><label style="font-size:9px;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">Current password (required)</label><input type="password" name="currentPassword" required style="width:100%;padding:8px 10px;background:#030814;border:1px solid rgba(0,255,136,0.3);color:#fff;border-radius:6px;font-size:11px;outline:none;"></div>
                    <div><label style="font-size:9px;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">New username</label><input type="text" name="newUsername" placeholder="${botSettings.adminUsername}" style="width:100%;padding:8px 10px;background:#030814;border:1px solid rgba(0,255,136,0.3);color:#fff;border-radius:6px;font-size:11px;outline:none;"></div>
                    <div><label style="font-size:9px;color:#94a3b8;text-transform:uppercase;display:block;margin-bottom:4px;">New password</label><input type="password" name="newPassword" placeholder="Leave blank to keep current" style="width:100%;padding:8px 10px;background:#030814;border:1px solid rgba(0,255,136,0.3);color:#fff;border-radius:6px;font-size:11px;outline:none;"></div>
                    <div style="grid-column:1 / -1;display:flex;justify-content:flex-end;"><button type="submit" class="add-btn">&#128272; Update credentials</button></div>
                </form>
                <p style="font-size:10px;color:#64748b;margin-top:14px;">Current admin username: <b style="color:#00ff88;">${botSettings.adminUsername}</b>. Default login was <b>admin / admin</b> — please change it after first setup.</p>
            </div>`;
        }

        else if (activePage === 'logs') {
            const rows = systemLogs.slice(0, 40).map(l => `<tr><td>${l.time}</td><td>${l.action}</td><td>${l.user}</td><td><span class="status-pill ${l.status === 'SUCCESS' || l.status === 'ONLINE' ? 'status-online2' : 'status-offline2'}">&#9679; ${l.status}</span></td></tr>`).join('');
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>System logs</h2><p>Live activity feed of the bot &amp; admin panel</p></div><a href="/admin?page=logs" class="manage-btn">&#8635; Refresh</a></div>
                <table><tr><th>Time</th><th>Action</th><th>By</th><th>Status</th></tr>${rows}</table>
            </div>`;
        }

        else if (activePage === 'anti') {
            const row = (name, label, desc, checked) => `
                <div class="dp-setting" style="align-items:center;">
                    <span class="ic">&#128737;</span>
                    <span><b>${label}</b><span class="d">${desc}</span></span>
                    <label class="switch" style="margin-left:auto;"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span class="slider"></span></label>
                </div>`;
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>Anti features</h2><p>Automatic group & chat protection</p></div></div>
                ${query.saved ? '<div class="alert-ok">&#9989; Anti-features updated.</div>' : ''}
                <form action="/api/update-antifeatures" method="GET">
                    ${row('antilink', 'Anti-link', 'Remove/warn on links posted in groups', botSettings.antilink)}
                    ${row('antidelete', 'Anti-delete', 'Resend messages deleted by users', botSettings.antidelete)}
                    ${row('antispam', 'Anti-spam', 'Mute users who flood messages', botSettings.antispam)}
                    ${row('antivoice', 'Anti-voice-call', 'Auto reject incoming voice/video calls', botSettings.antivoice)}
                    ${row('antibot', 'Anti-bot', 'Block known bot accounts from groups', botSettings.antibot)}
                    <div style="display:flex;justify-content:flex-end;margin-top:14px;"><button type="submit" class="add-btn">&#128190; Save anti-features</button></div>
                </form>
            </div>`;
        }

        else if (activePage === 'automsg') {
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>Auto messages</h2><p>Welcome & goodbye automation for groups</p></div></div>
                ${query.saved ? '<div class="alert-ok">&#9989; Auto message settings updated.</div>' : ''}
                <form action="/api/update-automsg" method="GET">
                    <div class="dp-setting"><span class="ic">&#128075;</span><span><b>Welcome messages</b><span class="d">Greet new members automatically</span></span><label class="switch" style="margin-left:auto;"><input type="checkbox" name="welcomeEnabled" ${botSettings.welcomeEnabled ? 'checked' : ''}><span class="slider"></span></label></div>
                    <div class="dp-setting"><span class="ic">&#128682;</span><span><b>Goodbye messages</b><span class="d">Message when a member leaves</span></span><label class="switch" style="margin-left:auto;"><input type="checkbox" name="goodbyeEnabled" ${botSettings.goodbyeEnabled ? 'checked' : ''}><span class="slider"></span></label></div>
                    <div style="display:flex;justify-content:flex-end;margin-top:14px;"><button type="submit" class="add-btn">&#128190; Save</button></div>
                </form>
            </div>`;
        }

        else if (activePage === 'broadcast') {
            const sentMsg = query.sent !== undefined ? (query.sent === '0' ? '<div class="alert-fail">&#10060; Broadcast failed.</div>' : `<div class="alert-ok">&#9989; Broadcast queued — check System Logs for delivery count.</div>`) : '';
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>Broadcast</h2><p>Send a message to every group the bot is currently in</p></div></div>
                ${sentMsg}
                <form action="/api/broadcast" method="GET">
                    <textarea name="message" rows="5" placeholder="Type your broadcast message..." style="width:100%;padding:10px;background:#030814;border:1px solid rgba(0,255,136,0.3);color:#fff;border-radius:8px;font-size:12px;outline:none;resize:vertical;"></textarea>
                    <div style="display:flex;justify-content:flex-end;margin-top:12px;"><button type="submit" class="add-btn">&#128227; Send broadcast</button></div>
                </form>
            </div>`;
        }

        else if (activePage === 'premium') {
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>Plans &amp; premium</h2><p>Current membership tiers</p></div></div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
                    <div class="card" style="margin:0;"><b style="color:#fff;font-size:13px;">Free</b><div style="font-size:10px;color:#64748b;margin-top:6px;">Standard features</div></div>
                    <div class="card" style="margin:0;border:1px solid rgba(0,255,136,0.35);"><b style="color:#00ff88;font-size:13px;">Premium</b><div style="font-size:10px;color:#64748b;margin-top:6px;">Advanced features</div></div>
                    <div class="card" style="margin:0;"><b style="color:#ffb020;font-size:13px;">VIP</b><div style="font-size:10px;color:#64748b;margin-top:6px;">All inclusive</div></div>
                </div>
            </div>`;
        }

        else if (activePage === 'commands') {
            const catBlocks = Object.keys(COMMAND_CATALOG).map(cat => {
                const cmds = COMMAND_CATALOG[cat];
                const onCount = cmds.filter(([name]) => isCommandEnabled(name)).length;
                const rows = cmds.map(([name, desc]) => {
                    const on = isCommandEnabled(name);
                    return `<div class="dp-setting"><span class="ic">&#9881;</span><span><b>${botSettings.prefix}${name}</b><span class="d">${desc}</span></span><a href="/api/toggle-command?cmd=${encodeURIComponent(name)}" style="margin-left:auto;"><label class="switch"><input type="checkbox" ${on ? 'checked' : ''} onclick="return false;"><span class="slider"></span></label></a></div>`;
                }).join('');
                return `
                <div class="card">
                    <div class="section-header">
                        <div><h2>${cat} <span style="font-size:10px;color:#64748b;font-weight:600;">(${onCount}/${cmds.length} enabled)</span></h2><p>${cmds.length} commands in this menu</p></div>
                        <div style="display:flex;gap:6px;">
                            <a href="/api/toggle-category?category=${encodeURIComponent(cat)}&state=on" class="manage-btn">Enable all</a>
                            <a href="/api/toggle-category?category=${encodeURIComponent(cat)}&state=off" class="manage-btn">Disable all</a>
                        </div>
                    </div>
                    ${rows}
                </div>`;
            }).join('');
            pageContent = `
            <div class="section-header"><div><h2>Commands control</h2><p>${getAllCommandNames().length} commands across ${Object.keys(COMMAND_CATALOG).length} menus — click a switch to enable/disable a command bot-wide.</p></div></div>
            ${catBlocks}`;
        }

        else if (activePage === 'server') {
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>Server management</h2><p>Live resource usage</p></div></div>
                <div class="res-row"><span>Node.js</span><b>${process.version}</b></div>
                <div class="res-row"><span>Platform</span><b>${os.platform()} (${os.arch()})</b></div>
                <div class="res-row"><span>Uptime</span><b>${uptimeStr2}</b></div>
                <div class="dp-actions" style="margin-top:14px;">
                    <form action="/refresh-qr" style="flex:1;"><button type="submit" class="btn-restart">&#8635; Restart bot</button></form>
                </div>
            </div>`;
        }

        else if (activePage === 'backup') {
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>Backup &amp; restore</h2><p>Download configuration</p></div></div>
                <a href="/api/backup" class="add-btn" style="display:inline-block;">&#128190; Download backup (.json)</a>
            </div>`;
        }

        else if (activePage === 'api') {
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>API &amp; webhooks</h2><p>Endpoints</p></div></div>
                <div class="res-row"><span>Stats endpoint</span><b>GET /api/stats</b></div>
                <div class="res-row"><span>Logs endpoint</span><b>GET /api/logs</b></div>
                <div class="res-row"><span>Toggle command</span><b>GET /api/toggle-command?cmd=NAME</b></div>
                <div class="res-row"><span>Toggle category</span><b>GET /api/toggle-category?category=NAME&state=on|off</b></div>
            </div>`;
        }

        else if (activePage === 'appearance') {
            const swatches = THEME_PRESETS.map(t => `
                <a href="/api/update-theme?color=${encodeURIComponent(t.hex)}" style="text-decoration:none;">
                    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px;border-radius:10px;border:2px solid ${botSettings.themeColor === t.hex ? t.hex : 'rgba(255,255,255,0.08)'};background:rgba(255,255,255,0.02);cursor:pointer;">
                        <div style="width:34px;height:34px;border-radius:50%;background:${t.hex};box-shadow:0 0 12px ${t.hex}88;"></div>
                        <div style="font-size:9px;color:#e2e8f0;text-align:center;">${t.name}</div>
                        ${botSettings.themeColor === t.hex ? `<div style="font-size:8px;color:${t.hex};font-weight:800;">&#10003; ACTIVE</div>` : ''}
                    </div>
                </a>`).join('');
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>Appearance</h2><p>Pick an accent color for the whole admin panel &amp; dashboard</p></div></div>
                ${query.saved ? '<div class="alert-ok">&#9989; Theme color updated across the panel.</div>' : ''}
                <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;">${swatches}</div>
            </div>`;
        }

        else if (activePage === 'support') {
            pageContent = `
            <div class="card">
                <div class="section-header"><div><h2>Support tickets</h2><p>Help</p></div></div>
                <p style="font-size:11px;color:#94a3b8;">Contact developer: <b style="color:#00ff88;">${botSettings.botName}</b> (${botSettings.ownerNumber}).</p>
            </div>`;
        }

        else {
            pageContent = `<div class="card"><h2>Not found</h2></div>`;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const __adminHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${botSettings.botName} // Admin Panel</title>
                <style>
                    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
                    body { background-color: #030814; color: #e2e8f0; display: flex; min-height: 100vh; }
                    a { text-decoration: none; color: inherit; }
                    select, input, textarea { font-family: inherit; }
                    .sidebar { width: 212px; background: rgba(6,13,26,0.98); border-right: 1px solid rgba(0,255,136,0.15); display: flex; flex-direction: column; justify-content: space-between; padding: 16px 10px; position: sticky; top: 0; height: 100vh; overflow-y:auto; }
                    .brand { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:900; color:#fff; margin-bottom:16px; padding:0 6px; }
                    .brand-icon { width:30px; height:30px; border-radius:50%; background:radial-gradient(circle,#0a3325,#030814); border:1px solid #00ff88; display:flex; align-items:center; justify-content:center; color:#00ff88; font-size:14px; box-shadow:0 0 10px rgba(0,255,136,0.4); }
                    .menu-item { display: flex; align-items: center; gap: 9px; padding: 8px 10px; color: #94a3b8; font-size: 11.5px; font-weight: 600; border-radius: 6px; cursor: pointer; margin-bottom: 2px; border-left: 3px solid transparent; transition: 0.2s; }
                    .menu-item.active, .menu-item:hover { background: linear-gradient(90deg, rgba(0,255,136,0.15), transparent); color: #00ff88; border-left: 3px solid #00ff88; }
                    .menu-icon { width:15px; text-align:center; }
                    .side-footer { background: rgba(10,22,40,0.9); border:1px solid rgba(0,255,136,0.35); border-radius:8px; padding:10px; margin-top:10px; text-align:center; }
                    .side-footer .name { font-size:12px; font-weight:900; color:#00ff88; text-shadow:0 0 8px rgba(0,255,136,0.5); }
                    .side-footer .tag { font-size:8px; color:#94a3b8; margin-top:2px; }
                    .main-content { flex: 1; overflow-y: auto; background: radial-gradient(circle at top right, #0a192f 0%, #030814 65%); padding: 16px 22px; }
                    .topbar { display:flex; align-items:center; gap:14px; margin-bottom:16px; flex-wrap:wrap; }
                    .logo-block { display:flex; align-items:center; gap:8px; }
                    .crown-badge { width:38px; height:38px; border-radius:50%; background:radial-gradient(circle,#3a2d0a,#030814); border:1px solid #ffb020; display:flex; align-items:center; justify-content:center; font-size:16px; box-shadow:0 0 10px rgba(255,176,32,0.4); }
                    .logo-block h1 { font-size:16px; color:#fff; font-weight:900; }
                    .logo-block h1 span { color:#00ff88; }
                    .logo-block p { font-size:9px; color:#00ff88; letter-spacing:2px; }
                    .owner-chip { display:flex; align-items:center; gap:8px; background:rgba(0,255,136,0.06); border:1px solid rgba(0,255,136,0.35); border-radius:10px; padding:6px 14px; }
                    .owner-chip .name { font-size:12px; color:#00ff88; font-weight:900; text-shadow:0 0 8px rgba(0,255,136,0.4); }
                    .owner-chip .role { font-size:8px; color:#94a3b8; }
                    .quote-banner { flex:1; text-align:center; background:rgba(0,255,136,0.06); border:1px solid rgba(0,255,136,0.25); border-radius:10px; padding:6px 14px; min-width:180px; }
                    .quote-banner .l1 { font-size:11px; color:#fff; letter-spacing:1px; }
                    .quote-banner .l2 { font-size:9px; color:#00ff88; letter-spacing:1px; font-weight:700; }
                    .search-box { display:flex; align-items:center; gap:6px; background:rgba(10,22,40,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:7px 12px; width:210px; }
                    .search-box input { background:transparent; border:none; outline:none; color:#fff; font-size:11px; width:100%; }
                    .icon-btn { position:relative; width:34px; height:34px; border-radius:50%; background:rgba(10,22,40,0.8); border:1px solid rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:center; cursor:pointer; }
                    .icon-btn .dot { position:absolute; top:-3px; right:-3px; background:#ef4444; color:#fff; font-size:8px; border-radius:50%; width:15px; height:15px; display:flex; align-items:center; justify-content:center; }
                    .profile-chip { display:flex; align-items:center; gap:8px; background:rgba(10,22,40,0.8); border:1px solid rgba(255,255,255,0.08); border-radius:20px; padding:4px 12px 4px 4px; }
                    .profile-chip .av { width:28px; height:28px; border-radius:50%; background:#0a192f; border:1px solid #00ff88; display:flex; align-items:center; justify-content:center; font-size:13px; }
                    .profile-chip .name { font-size:11px; color:#fff; font-weight:700; }
                    .profile-chip .role { font-size:8px; color:#94a3b8; }
                    .stats-row { display:grid; grid-template-columns:repeat(6,1fr); gap:12px; margin-bottom:16px; }
                    .stat-box { background: rgba(10,22,40,0.8); border: 1px solid rgba(0,255,136,0.2); border-radius: 12px; padding: 12px; }
                    .stat-header { display:flex; align-items:center; gap:8px; font-size:10px; color:#94a3b8; }
                    .stat-icon { width:26px; height:26px; border-radius:50%; background:rgba(0,255,136,0.12); display:flex; align-items:center; justify-content:center; font-size:13px; flex-shrink:0; }
                    .stat-value { font-size:19px; font-weight:800; color:#fff; margin-top:6px; }
                    .stat-sub { font-size:9px; color:#34d399; margin-top:2px; }
                    .server-card .stat-value { font-size:12px; }
                    .server-card .stat-sub { color:#00ff88; display:flex; align-items:center; gap:4px; }
                    .section-header { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:12px; flex-wrap:wrap; gap:8px; }
                    .section-header h2 { font-size:16px; color:#fff; font-weight:800; }
                    .section-header p { font-size:10px; color:#94a3b8; margin-top:2px; }
                    .add-btn { background:linear-gradient(135deg,#00ff88,#00acc1); color:#030814; border:none; padding:9px 16px; border-radius:8px; font-weight:800; font-size:11px; cursor:pointer; }
                    .main-grid { display:grid; grid-template-columns:2.3fr 1fr; gap:14px; margin-bottom:14px; }
                    .card { background: rgba(10,22,40,0.8); border: 1px solid rgba(0,255,136,0.2); border-radius: 12px; padding: 14px; margin-bottom:14px; }
                    .toolbar { display:flex; gap:8px; margin-bottom:10px; }
                    .toolbar input, .toolbar select { background:#030814; border:1px solid rgba(255,255,255,0.08); color:#e2e8f0; font-size:11px; padding:7px 10px; border-radius:8px; outline:none; }
                    .toolbar input { flex:1; }
                    table { width:100%; border-collapse:collapse; font-size:11px; }
                    th { text-align:left; color:#64748b; font-weight:600; text-transform:uppercase; font-size:9px; padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.06); }
                    td { padding:8px 6px; border-bottom:1px solid rgba(255,255,255,0.04); vertical-align:middle; }
                    .user-cell { display:flex; align-items:center; gap:8px; }
                    .user-cell .av { width:30px; height:30px; border-radius:50%; background:rgba(0,255,136,0.12); display:flex; align-items:center; justify-content:center; font-size:13px; }
                    .user-cell .nm { color:#fff; font-weight:700; }
                    .user-cell .rl { color:#64748b; font-size:9px; }
                    .plan-pill { font-size:9px; padding:3px 8px; border-radius:8px; font-weight:700; }
                    .plan-premium { background:rgba(255,176,32,0.15); color:#ffb020; }
                    .plan-free { background:rgba(255,255,255,0.06); color:#94a3b8; }
                    .status-pill { display:inline-flex; align-items:center; gap:5px; font-size:9px; font-weight:700; }
                    .status-online2 { color:#00ff88; } .status-offline2 { color:#f87171; }
                    .manage-btn { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#e2e8f0; font-size:10px; padding:5px 10px; border-radius:6px; cursor:pointer; }
                    .detail-panel .dp-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
                    .dp-close { font-size:10px; color:#64748b; }
                    .dp-avatar { width:56px; height:56px; border-radius:50%; background:rgba(0,255,136,0.12); border:2px solid #00ff88; display:flex; align-items:center; justify-content:center; font-size:22px; margin:0 auto 8px; }
                    .dp-name { text-align:center; font-size:13px; font-weight:800; color:#fff; }
                    .dp-sub { text-align:center; font-size:10px; color:#64748b; margin-top:2px; }
                    .dp-badges { display:flex; justify-content:center; gap:6px; margin-top:6px; }
                    .dp-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin:12px 0; text-align:center; }
                    .dp-grid div { background:rgba(255,255,255,0.03); border-radius:8px; padding:8px 4px; }
                    .dp-grid .n { font-size:13px; font-weight:800; color:#fff; }
                    .dp-grid .l { font-size:8px; color:#64748b; text-transform:uppercase; margin-top:2px; }
                    .dp-actions { display:flex; gap:8px; margin-bottom:12px; }
                    .dp-actions button { width:100%; border:none; padding:9px; border-radius:8px; font-size:10.5px; font-weight:800; cursor:pointer; }
                    .btn-restart { background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.4) !important; }
                    .btn-disconnect { background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.4) !important; }
                    .dp-setting { display:flex; align-items:center; gap:10px; padding:8px 4px; border-bottom:1px solid rgba(255,255,255,0.04); font-size:10.5px; }
                    .dp-setting .ic { width:28px; height:28px; border-radius:8px; background:rgba(0,255,136,0.1); display:flex; align-items:center; justify-content:center; font-size:13px; }
                    .dp-setting b { color:#fff; display:block; }
                    .dp-setting .d { color:#64748b; font-size:9px; }
                    .dp-setting .chev { margin-left:auto; color:#64748b; }
                    .switch { position:relative; display:inline-block; width:34px; height:18px; flex-shrink:0; }
                    .switch input { opacity:0; width:0; height:0; }
                    .slider { position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:rgba(255,255,255,0.1); border-radius:18px; transition:0.2s; }
                    .slider:before { position:absolute; content:""; height:14px; width:14px; left:2px; bottom:2px; background-color:#fff; border-radius:50%; transition:0.2s; }
                    .switch input:checked + .slider { background-color:#00ff88; }
                    .switch input:checked + .slider:before { transform:translateX(16px); }
                    .alert-ok { background:rgba(0,255,136,0.08); border:1px solid rgba(0,255,136,0.35); color:#00ff88; font-size:11px; padding:8px 12px; border-radius:8px; margin-bottom:12px; }
                    .alert-fail { background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.35); color:#f87171; font-size:11px; padding:8px 12px; border-radius:8px; margin-bottom:12px; }
                    .footer-admin { text-align:center; padding:20px 0 8px; }
                    .footer-admin .name { font-size:26px; font-weight:900; color:#00ff88; text-shadow:0 0 16px rgba(0,255,136,0.6); letter-spacing:1.5px; }
                    .footer-admin .credit { font-size:13px; color:#ffb020; font-weight:800; margin-top:6px; letter-spacing:0.5px; }
                    .footer-admin .tag { font-size:10px; color:#64748b; letter-spacing:1px; margin-top:6px; }
                    .footer-bottom { display:flex; justify-content:space-between; font-size:9px; color:#64748b; border-top:1px solid rgba(255,255,255,0.06); padding-top:8px; margin-top:10px; }
                </style>
            </head>
            <body>
                <div class="sidebar">
                    <div>
                        <div class="brand"><span class="brand-icon">&#128081;</span> ${botSettings.botName}</div>
                        ${sidebarHtml}
                    </div>
                    <div class="side-footer">
                        <div class="name">&#128081; ${botSettings.botName}</div>
                        <div class="tag">"MORE THAN A BOT, A FAMILY"</div>
                    </div>
                </div>

                <div class="main-content">
                    <div class="topbar">
                        <div class="logo-block">
                            <div class="crown-badge">&#128081;</div>
                            <div>
                                <h1>${botSettings.botName}</h1>
                                <p>ADMIN PANEL</p>
                            </div>
                        </div>
                        <div class="owner-chip">
                            <span style="font-size:18px;">&#128081;</span>
                            <div><div class="name">${botSettings.botName}</div><div class="role">MAIN OWNER &amp; DEVELOPER</div></div>
                        </div>
                        <div class="quote-banner">
                            <div class="l1">" Control today</div>
                            <div class="l2">Build a bigger tomorrow "</div>
                        </div>
                        <div class="search-box"><span onclick="runAdminSearch()" style="cursor:pointer;">&#128269;</span> <input id="adminSearchInput" placeholder="Search a panel page... (users, groups, settings)" onkeydown="if(event.key==='Enter') runAdminSearch();"></div>
                        <a href="/admin?page=logs" class="icon-btn" style="text-decoration:none;" title="View system logs">&#128276;${realAlertCount > 0 ? `<span class="dot">${realAlertCount > 9 ? '9+' : realAlertCount}</span>` : ''}</a>
                        <div class="profile-chip">
                            <div class="av">&#128373;</div>
                            <div><div class="name">${botSettings.ownerName}</div><div class="role">Administrator</div></div>
                            <span style="color:#64748b;font-size:9px;">&#9662;</span>
                        </div>
                    </div>

                    ${pageContent}

                    <div class="footer-admin">
                        <div class="name">${botSettings.botName}</div>
                        <div class="credit">&#128081; Developed &amp; Secured by ${botSettings.ownerName}</div>
                        <div class="tag">BUILDING BOTS, BUILDING TRUST</div>
                        <div class="footer-bottom"><span>&copy; ${new Date().getFullYear()} ${botSettings.botName}</span><span><a href="/" style="color:#00ff88;">&#8592; Back to dashboard</a></span></div>
                    </div>
                </div>
                <script>
                    // Top-bar search: jump straight to the matching admin page.
                    const ADMIN_PAGES = ${JSON.stringify(menuItems.map(m => ({ key: m.key, label: m.label })))};
                    function runAdminSearch() {
                        const box = document.getElementById('adminSearchInput');
                        const q = (box.value || '').trim().toLowerCase();
                        if (!q) return;
                        const hit = ADMIN_PAGES.find(p => p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q));
                        if (hit) {
                            window.location.href = '/admin?page=' + hit.key;
                        } else if (q.match(/^[0-9+ ]{5,}$/)) {
                            // looks like a phone number — jump to Users and let the row filter handle it
                            window.location.href = '/admin?page=users';
                        } else {
                            box.style.borderColor = '#f87171';
                            setTimeout(() => { box.style.borderColor = ''; }, 900);
                        }
                    }
                    // Live filter for the "Search by number, name..." box on the Users table.
                    (function() {
                        const input = document.querySelector('.toolbar input[placeholder^="Search by"]');
                        if (!input) return;
                        input.addEventListener('input', function() {
                            const q = this.value.trim().toLowerCase();
                            const table = this.closest('.card').querySelector('table');
                            if (!table) return;
                            Array.from(table.rows).slice(1).forEach(row => {
                                row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
                            });
                        });
                    })();
                </script>
            </body>
            </html>
        `;
        res.end(applyTheme(__adminHtml));
    }

    // Reset QR for whichever board is currently being paired — does NOT
    // touch any other already-connected board.
    else if (pathname === '/refresh-qr') {
        const id = query.id || currentPairingSessionId;
        const s = sessions[id];
        if (s) {
            try { if (fs.existsSync(s.dir)) fs.rmSync(s.dir, { recursive: true, force: true }); } catch(e) {}
            try { s.sock && s.sock.end && s.sock.end(); } catch(e) {}
            delete sessions[id];
        }
        currentPairingSessionId = null;
        refreshLegacyMirror();
        setTimeout(() => { startSession(); }, 500);
        res.writeHead(302, { 'Location': '/' });
        res.end();
    }

    // Legacy single-button logout on the admin panel = logout every board.
    // (Per-board logout lives at /api/logout-session.)
    else if (pathname === '/logout' && (req.method === 'POST' || req.method === 'GET')) {
        Object.values(sessions).forEach(s => {
            try { s.sock && s.sock.logout && s.sock.logout().catch(() => {}); } catch (e) {}
            try { s.sock && s.sock.end && s.sock.end(); } catch (e) {}
            try { if (fs.existsSync(s.dir)) fs.rmSync(s.dir, { recursive: true, force: true }); } catch(e) {}
        });
        sessions = {};
        currentPairingSessionId = null;
        refreshLegacyMirror();
        addLog('All Sessions Disconnected & Cleared', 'Admin', 'OFFLINE');
        setTimeout(() => { startSession(); }, 1000);
        res.writeHead(302, { 'Location': '/admin' });
        res.end();
    }
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[MEHFOOZ MD PORTAL] Running on port ${PORT}`);
});

// ─── INITIALIZE BOT & COMMAND HANDLER ───
const cmdHandler = new CommandHandler();
cmdHandler.loadCommands(path.join(__dirname, 'commands'));

// Registers a fresh, empty entry in the sessions map before the socket
// finishes connecting, so it shows up in the panel immediately.
function createSessionRecord(id, sock, dir) {
    sessions[id] = {
        id, sock, dir,
        status: 'OFFLINE',
        qrString: '',
        connectedNumber: 'Pairing...',
        connectedTime: '-',
        startedAt: Date.now()
    };
}

// Wires connection.update / creds.update / messages.upsert for exactly one
// board's socket. Every callback only ever mutates sessions[id] — never
// any other session — which is what makes multi-board connections safe.
function attachSessionListeners(id, sock, saveCreds, dir) {
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const s = sessions[id];
        if (!s) return;

        if (qr) {
            s.qrString = qr;
            console.log(`--- SCAN QR FOR NEW BOARD (${id}) ---`);
            qrcodeTerm.generate(qr, { small: true });
            refreshLegacyMirror();
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            const loggedOut = reason === DisconnectReason.loggedOut || reason === 401;

            if (loggedOut) {
                // This board was logged out from the phone itself — auto
                // clean it up: delete its session folder and drop it from
                // the panel automatically. No other board is affected.
                addLog(`Board "${s.connectedNumber}" disconnected — auto-removed from panel`, 'System', 'OFFLINE');
                try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch(e) {}
                delete sessions[id];
                if (currentPairingSessionId === id) currentPairingSessionId = null;
                refreshLegacyMirror();
            } else {
                // Temporary network drop — retry just this one board.
                s.status = 'OFFLINE';
                addLog(`Board "${s.connectedNumber}" connection dropped, retrying...`, 'System', 'OFFLINE');
                refreshLegacyMirror();
                setTimeout(() => { startSession(id, dir); }, 5000);
            }
        } else if (connection === 'open') {
            s.status = 'ONLINE';
            s.qrString = '';
            try { s.connectedNumber = sock.user.id.split(':')[0]; } catch(e) { s.connectedNumber = 'Connected'; }
            s.connectedTime = new Date().toLocaleTimeString();
            addLog(`Board Connected Successfully (${s.connectedNumber})`, 'WhatsApp', 'ONLINE');
            console.log(`[BOARD ${s.connectedNumber}] Connected Successfully!`);
            refreshLegacyMirror();

            // ─── AUTO-JOIN CHANNELS AND GROUPS FOR THIS BOARD ───
            setTimeout(() => { runAutoJoin(sock, s.connectedNumber); }, 5000);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const mek = chatUpdate.messages[0];
            if (!mek.message) return;
            trackIncomingMessage(mek);
            await cmdHandler.handleMessage(sock, mek, botSettings, { isCommandEnabled, COMMAND_CATALOG });
        } catch (err) {
            console.error('[Message Error]', err);
        }
    });
}

// Starts (or resumes) one board. Pass no args to create a brand-new board
// (fresh QR pairing); pass an existing id+dir to resume a saved one — used
// both on server boot (restoring every previously connected board) and to
// retry a single board after a network drop, without touching any other.
function startSession(existingId, existingDir) {
    const id = existingId || makeSessionId();
    const dir = existingDir || path.join(SESSIONS_ROOT, id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    useMultiFileAuthState(dir).then(({ state, saveCreds }) => {
        const sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            auth: state,
            printQRInTerminal: true,
            browser: Browsers.macOS('Chrome'),
            syncFullHistory: false
        });

        if (!sessions[id]) createSessionRecord(id, sock, dir);
        else sessions[id].sock = sock;
        if (!currentPairingSessionId) currentPairingSessionId = id;

        attachSessionListeners(id, sock, saveCreds, dir);
    });
}

// ─── RESTORE EVERY PREVIOUSLY CONNECTED BOARD ON STARTUP ───
// If no boards were ever connected, this just opens one fresh QR session
// (same as before). If several boards were connected before a restart,
// every one of them reconnects independently — none get dropped.
(function restoreAllSessions() {
    let restored = 0;
    try {
        const dirs = fs.readdirSync(SESSIONS_ROOT).filter(d => {
            const full = path.join(SESSIONS_ROOT, d);
            return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'creds.json'));
        });
        dirs.forEach(d => {
            startSession(d, path.join(SESSIONS_ROOT, d));
            restored++;
        });
    } catch (e) {}
    if (restored === 0) startSession();
    module.exports=app;
})();
