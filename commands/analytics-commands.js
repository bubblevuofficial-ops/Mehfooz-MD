'use strict';

/*
|--------------------------------------------------------------------------
| MEHFOOZ MD - GROUP ANALYTICS ENGINE (real backend, not placeholders)
|--------------------------------------------------------------------------
| Kya hai:
|  - trackMessage(botKey, m)  -> commandHandler.js se har group message
|    par call hoga (command ho ya na ho), isi se saara data banta hai.
|  - commands[]                -> .stats, .msgstats, .topchatters ...
|    jaise ~55 real commands, sab isi tracked data par kaam karte hain.
|  - hooks{}                   -> agar mehfooz-security.js / group-commands.js
|    warn/kick/delete/link/spam/join/leave par yeh hooks call kar dein
|    to warstats/linkstats/joinstats waghera bhi real numbers dikhayenge.
|    Jab tak hook na lage, yeh counters 0 se shuru hote hain (jhooti
|    value kabhi nahi dikhayi jati).
|
| Data file: data/analytics/<bot-number>.json
| Storage design: per-user all-time totals + pichle 40 din ki daily/
| hourly breakdown. Isse 1h se le kar 30d tak har .stats range nikal
| sakte hain, file zyada bari huye baghair.
|--------------------------------------------------------------------------
*/

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'analytics');
const RETENTION_DAYS_DEFAULT = 40;

const cache = new Map();
const saveTimers = new Map();

const cleanId = (id = '') => String(id).split('@')[0].split(':')[0];
const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
const num = (n) => Number(n || 0).toLocaleString('en-US');
const fmtHour = (h) => `${String(h).padStart(2, '0')}:00`;
const mention = (uid) => `@${uid}`;

// ---------------------------------------------------------------- storage
function loadStore(botKey) {
    if (cache.has(botKey)) return cache.get(botKey);
    let data = { groups: {} };
    try {
        data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, botKey + '.json'), 'utf8'));
    } catch { /* pehli dafa - koi file nahi, khaali se shuru */ }
    if (!data.groups) data.groups = {};
    cache.set(botKey, data);
    return data;
}

function saveStore(botKey) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, botKey + '.json'), JSON.stringify(cache.get(botKey) || { groups: {} }));
    } catch (e) {
        console.error('[MEHFOOZ MD][Analytics] save fail:', e.message);
    }
}

// har message par foran disk write nahi - 4 sec baad ek hi save (fast + safe)
function scheduleSave(botKey) {
    if (saveTimers.has(botKey)) return;
    saveTimers.set(botKey, setTimeout(() => {
        saveStore(botKey);
        saveTimers.delete(botKey);
    }, 4000));
}

function getGroup(botKey, groupId) {
    const store = loadStore(botKey);
    if (!store.groups[groupId]) {
        store.groups[groupId] = {
            users: {},       // uid -> {count, first, last, hourly[24], types{}}
            daily: {},       // 'YYYY-MM-DD' -> {total, users:{uid:count}, hourly[24]}
            total: 0,
            warns: 0, links: 0, spam: 0, deletes: 0, kicks: 0,
            joins: 0, leaves: 0, modlog: [],
            paused: false,
            retentionDays: RETENTION_DAYS_DEFAULT,
            backup: null,
            createdAt: Date.now()
        };
    }
    return store.groups[groupId];
}

function pruneOldDays(g) {
    const keep = g.retentionDays || RETENTION_DAYS_DEFAULT;
    const cutoff = Date.now() - keep * 86400000;
    for (const k of Object.keys(g.daily)) {
        if (new Date(k + 'T00:00:00.000Z').getTime() < cutoff) delete g.daily[k];
    }
}

function messageType(m) {
    const msg = m.message || {};
    if (msg.imageMessage) return 'image';
    if (msg.videoMessage) return 'video';
    if (msg.audioMessage) return 'audio';
    if (msg.stickerMessage) return 'sticker';
    if (msg.documentMessage) return 'document';
    if (msg.conversation || msg.extendedTextMessage) return 'text';
    return 'other';
}

// -------------------------------------------------------------- tracking
// commandHandler.js har group-message par yeh call karega (command ho ya na ho)
function trackMessage(botKey, m) {
    try {
        const groupId = m.key?.remoteJid;
        if (!groupId || !groupId.endsWith('@g.us') || m.key.fromMe) return;
        const g = getGroup(botKey, groupId);
        if (g.paused) return;

        const uid = cleanId(m.key.participant || m.key.participantAlt || groupId);
        const now = Date.now();
        const hour = new Date(now).getHours();
        const today = dayKey(now);

        if (!g.users[uid]) g.users[uid] = { count: 0, first: now, last: now, hourly: Array(24).fill(0), types: {} };
        const u = g.users[uid];
        u.count++; u.last = now;
        u.hourly[hour]++;
        const type = messageType(m);
        u.types[type] = (u.types[type] || 0) + 1;

        if (!g.daily[today]) g.daily[today] = { total: 0, users: {}, hourly: Array(24).fill(0) };
        const d = g.daily[today];
        d.total++; d.hourly[hour]++;
        d.users[uid] = (d.users[uid] || 0) + 1;

        g.total++;
        pruneOldDays(g);
        scheduleSave(botKey);
    } catch { /* analytics kabhi bhi asal message flow ko block na kare */ }
}

// ---- dusre modules (security / group-commands) real events yahan feed karen ----
// example: require('./analytics-commands').hooks.warn(botKey, groupId)
function bump(botKey, gid, field) {
    const g = getGroup(botKey, gid);
    g[field] = (g[field] || 0) + 1;
    scheduleSave(botKey);
}
const hooks = {
    warn: (botKey, gid) => bump(botKey, gid, 'warns'),
    kick: (botKey, gid) => bump(botKey, gid, 'kicks'),
    delete: (botKey, gid) => bump(botKey, gid, 'deletes'),
    link: (botKey, gid) => bump(botKey, gid, 'links'),
    spam: (botKey, gid) => bump(botKey, gid, 'spam'),
    join: (botKey, gid) => bump(botKey, gid, 'joins'),
    leave: (botKey, gid) => bump(botKey, gid, 'leaves'),
    modlog: (botKey, gid, line) => {
        const g = getGroup(botKey, gid);
        g.modlog.push({ t: Date.now(), line: String(line).slice(0, 200) });
        if (g.modlog.length > 300) g.modlog = g.modlog.slice(-300);
        scheduleSave(botKey);
    }
};

// -------------------------------------------------------------- ranges
const RANGE_HOURS = { '1h': 1, '6h': 6, '12h': 12, '24h': 24, '2d': 48, '7d': 168, '30d': 720 };
function parseRangeToHours(str) {
    if (!str) return 24;
    str = String(str).toLowerCase();
    if (RANGE_HOURS[str]) return RANGE_HOURS[str];
    const m = str.match(/^(\d+)(h|d)$/);
    if (m) return Number(m[1]) * (m[2] === 'h' ? 1 : 24);
    return 24;
}

function collectDays(g, hoursBack) {
    const days = Math.max(1, Math.ceil(hoursBack / 24));
    const out = [];
    for (let i = 0; i < days; i++) {
        const k = dayKey(Date.now() - i * 86400000);
        if (g.daily[k]) out.push({ key: k, data: g.daily[k] });
    }
    return out;
}

function statsForRange(g, rangeStr) {
    const hours = parseRangeToHours(rangeStr);
    const days = collectDays(g, hours);
    let total = 0;
    const userTotals = {};
    const hourly = Array(24).fill(0);

    for (const { data } of days) {
        total += data.total;
        for (const [u, c] of Object.entries(data.users)) userTotals[u] = (userTotals[u] || 0) + c;
        for (let h = 0; h < 24; h++) hourly[h] += data.hourly[h];
    }

    const sorted = Object.entries(userTotals).sort((a, b) => b[1] - a[1]);
    const peakHour = hourly.reduce((best, v, h) => (v > hourly[best] ? h : best), 0);
    const quietHour = hourly.reduce((best, v, h) => (v < hourly[best] ? h : best), 0);
    const activeDays = Math.max(1, Math.min(days.length, Math.ceil(hours / 24)));

    return {
        total,
        activeUsers: sorted.length,
        top: sorted[0] || null,
        least: sorted[sorted.length - 1] || null,
        sorted,
        hourly,
        peakHour, quietHour,
        avgPerDay: Math.round(total / activeDays),
        avgPerHour: Math.round((total / hours) * 100) / 100,
        daysCovered: days.length
    };
}

function dayOfWeekBreakdown(g) {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const totals = Array(7).fill(0);
    for (const [k, d] of Object.entries(g.daily)) {
        const dow = new Date(k + 'T00:00:00.000Z').getDay();
        totals[dow] += d.total;
    }
    return names.map((n, i) => ({ day: n, total: totals[i] }));
}

// -------------------------------------------------------------- ctx helpers
function needsGroup(m, reply) {
    const gid = m.key.remoteJid;
    if (!gid || !gid.endsWith('@g.us')) { reply('⚠️ Yeh command sirf group mein kaam karti hai.'); return null; }
    return gid;
}
function targetUser(m, args) {
    const ci = m.message?.extendedTextMessage?.contextInfo || {};
    const raw = (ci.mentionedJid && ci.mentionedJid[0]) ||
        ((args[0] || '').replace('@', '').trim() ? (args[0].replace('@', '').trim() + '@s.whatsapp.net') : null) ||
        (m.key.participant || m.key.remoteJid);
    return cleanId(raw);
}
function getBotKey(sock) { return cleanId(sock?.user?.id) || 'default'; }
async function mreply(sock, m, text, mentions = []) {
    await sock.sendMessage(
        m.key.remoteJid,
        { text, mentions: mentions.filter(Boolean).map(u => (u.includes('@') ? u : u + '@s.whatsapp.net')) },
        { quoted: m }
    );
}
async function requireGroupAdmin(sock, m, reply) {
    try {
        const gid = m.key.remoteJid;
        const meta = await sock.groupMetadata(gid);
        const senderId = cleanId(m.key.participant || m.key.participantAlt || '');
        const participant = meta.participants.find(p => cleanId(p.id) === senderId);
        if (!participant || !['admin', 'superadmin'].includes(participant.admin)) {
            await reply('⚠️ Yeh command sirf group admins use kar sakte hain.');
            return false;
        }
        return true;
    } catch {
        return true; // metadata na mile to block na karo, aage jaane do
    }
}

// -------------------------------------------------------------- report builders
function groupReportText(range, s) {
    const topLine = s.top ? `${mention(s.top[0])} (${num(s.top[1])})` : '—';
    return `📊 *GROUP ACTIVITY — ${range.toUpperCase()}*\n\n` +
        `• Total Messages: ${num(s.total)}\n` +
        `• Active Users: ${num(s.activeUsers)}\n` +
        `• Top Chatter: ${topLine}\n` +
        `• Peak Hour: ${fmtHour(s.peakHour)}\n` +
        `• Average/Day: ${num(s.avgPerDay)}\n\n👑 *MEHFOOZ MD*`;
}

function rangeReportCmd(name, range) {
    return {
        name,
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const s = statsForRange(g, range);
            await mreply(sock, m, groupReportText(range, s), s.top ? [s.top[0]] : []);
        }
    };
}

// -------------------------------------------------------------- commands
const commands = [

    // ---------------- master command: .stats [range|@user range|top range|group range]
    {
        name: 'stats',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const botKey = getBotKey(sock);
            const g = getGroup(botKey, gid);
            const ci = m.message?.extendedTextMessage?.contextInfo || {};
            const mentioned = ci.mentionedJid && ci.mentionedJid[0];

            let sub = (args[0] || '24h').toLowerCase();
            let mode = 'group', range = '24h';

            if (mentioned) { mode = 'user'; range = args[1] || '24h'; }
            else if (sub === 'group') { mode = 'group'; range = args[1] || '24h'; }
            else if (sub === 'top') { mode = 'top'; range = args[1] || '24h'; }
            else { mode = 'group'; range = sub; }

            const s = statsForRange(g, range);

            if (mode === 'user') {
                const uid = cleanId(mentioned);
                const u = g.users[uid];
                if (!u) return reply('⚠️ Is user ka koi record nahi mila.');
                const rc = s.sorted.find(([id]) => id === uid);
                await mreply(sock, m,
                    `📊 *USER STATS — ${range.toUpperCase()}*\n\n` +
                    `• User: ${mention(uid)}\n` +
                    `• Messages (range): ${num(rc ? rc[1] : 0)}\n` +
                    `• Messages (all-time): ${num(u.count)}\n` +
                    `• First seen: ${new Date(u.first).toLocaleString()}\n` +
                    `• Last seen: ${new Date(u.last).toLocaleString()}\n\n👑 *MEHFOOZ MD*`, [uid]);
                return;
            }

            if (mode === 'top') {
                const top10 = s.sorted.slice(0, 10);
                const lines = top10.map(([uid, c], i) => `${i + 1}. ${mention(uid)} — ${num(c)}`);
                await mreply(sock, m,
                    `🏆 *TOP CHATTERS — ${range.toUpperCase()}*\n\n${lines.join('\n') || 'Koi data nahi.'}\n\n👑 *MEHFOOZ MD*`,
                    top10.map(([uid]) => uid));
                return;
            }

            await mreply(sock, m, groupReportText(range, s), s.top ? [s.top[0]] : []);
        }
    },

    // ---------------- quick range aliases
    rangeReportCmd('msgstats', '24h'),
    rangeReportCmd('dailystats', '24h'),
    rangeReportCmd('hourlystats', '1h'),
    rangeReportCmd('weeklystats', '7d'),
    rangeReportCmd('monthlystats', '30d'),
    {
        name: 'groupactivity',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const range = args[0] || '7d';
            const s = statsForRange(g, range);
            await mreply(sock, m, groupReportText(range, s), s.top ? [s.top[0]] : []);
        }
    },
    {
        name: 'activityrange',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const range = args[0] || '7d';
            const s = statsForRange(g, range);
            await mreply(sock, m, groupReportText(range, s), s.top ? [s.top[0]] : []);
        }
    },

    // ---------------- top / least chatters
    {
        name: 'topchatters',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const s = statsForRange(g, args[0] || '30d');
            const top = s.sorted.slice(0, 10);
            const lines = top.map(([uid, c], i) => `${i + 1}. ${mention(uid)} — ${num(c)}`);
            await mreply(sock, m, `🏆 *TOP CHATTERS*\n\n${lines.join('\n') || 'Koi data nahi.'}\n\n👑 *MEHFOOZ MD*`, top.map(x => x[0]));
        }
    },
    {
        name: 'leastchatters',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const s = statsForRange(g, args[0] || '30d');
            const least = s.sorted.slice(-10).reverse();
            const lines = least.map(([uid, c], i) => `${i + 1}. ${mention(uid)} — ${num(c)}`);
            await mreply(sock, m, `📉 *LEAST ACTIVE CHATTERS*\n\n${lines.join('\n') || 'Koi data nahi.'}\n\n👑 *MEHFOOZ MD*`, least.map(x => x[0]));
        }
    },

    // ---------------- single user lookups
    {
        name: 'usercount',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const uid = targetUser(m, args);
            const u = g.users[uid];
            await mreply(sock, m, `📨 ${mention(uid)} ke total messages: *${num(u ? u.count : 0)}*\n\n👑 *MEHFOOZ MD*`, [uid]);
        }
    },
    { name: 'msgcount', async execute(ctx) { return commands.find(c => c.name === 'usercount').execute(ctx); } },

    {
        name: 'useractivity',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const uid = targetUser(m, args);
            const u = g.users[uid];
            if (!u) return reply('⚠️ Is user ka koi record nahi mila.');
            const peakHour = u.hourly.reduce((best, v, h) => (v > u.hourly[best] ? h : best), 0);
            await mreply(sock, m,
                `👤 *USER ACTIVITY*\n\n` +
                `• User: ${mention(uid)}\n` +
                `• Total Messages: ${num(u.count)}\n` +
                `• Most Active Hour: ${fmtHour(peakHour)}\n` +
                `• First seen: ${new Date(u.first).toLocaleString()}\n` +
                `• Last seen: ${new Date(u.last).toLocaleString()}\n\n👑 *MEHFOOZ MD*`, [uid]);
        }
    },
    { name: 'report', async execute(ctx) { return commands.find(c => c.name === 'userreport').execute(ctx); } },
    {
        name: 'userreport',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const uid = targetUser(m, args);
            const u = g.users[uid];
            if (!u) return reply('⚠️ Is user ka koi record nahi mila.');
            const peakHour = u.hourly.reduce((best, v, h) => (v > u.hourly[best] ? h : best), 0);
            const types = Object.entries(u.types).map(([t, c]) => `   - ${t}: ${num(c)}`).join('\n') || '   - koi data nahi';
            const rank = Object.entries(g.users).sort((a, b) => b[1].count - a[1].count).findIndex(([id]) => id === uid) + 1;
            await mreply(sock, m,
                `📋 *FULL USER REPORT*\n\n` +
                `• User: ${mention(uid)}\n` +
                `• Rank: #${rank}\n` +
                `• Total Messages: ${num(u.count)}\n` +
                `• Message Types:\n${types}\n` +
                `• Most Active Hour: ${fmtHour(peakHour)}\n` +
                `• First seen: ${new Date(u.first).toLocaleString()}\n` +
                `• Last seen: ${new Date(u.last).toLocaleString()}\n\n👑 *MEHFOOZ MD*`, [uid]);
        }
    },
    {
        name: 'msgtypes',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const uid = targetUser(m, args);
            const u = g.users[uid];
            if (!u) return reply('⚠️ Is user ka koi record nahi mila.');
            const lines = Object.entries(u.types).map(([t, c]) => `• ${t}: ${num(c)}`).join('\n') || 'Koi data nahi.';
            await mreply(sock, m, `📨 *MESSAGE TYPES* — ${mention(uid)}\n\n${lines}\n\n👑 *MEHFOOZ MD*`, [uid]);
        }
    },
    {
        name: 'firstmsg',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const uid = targetUser(m, args);
            const u = g.users[uid];
            if (!u) return reply('⚠️ Is user ka koi record nahi mila.');
            await mreply(sock, m, `🕐 ${mention(uid)} ka pehla record: *${new Date(u.first).toLocaleString()}*\n\n👑 *MEHFOOZ MD*`, [uid]);
        }
    },
    {
        name: 'lastmsg',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const uid = targetUser(m, args);
            const u = g.users[uid];
            if (!u) return reply('⚠️ Is user ka koi record nahi mila.');
            await mreply(sock, m, `🕐 ${mention(uid)} ka aakhri record: *${new Date(u.last).toLocaleString()}*\n\n👑 *MEHFOOZ MD*`, [uid]);
        }
    },
    {
        name: 'activehours',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const uid = targetUser(m, args);
            const u = g.users[uid];
            if (!u) return reply('⚠️ Is user ka koi record nahi mila.');
            const top3 = u.hourly.map((c, h) => [h, c]).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(x => x[1] > 0);
            const lines = top3.map(([h, c]) => `• ${fmtHour(h)} — ${num(c)} messages`).join('\n') || 'Abhi kaafi data nahi.';
            await mreply(sock, m, `⏰ *MOST ACTIVE HOURS* — ${mention(uid)}\n\n${lines}\n\n👑 *MEHFOOZ MD*`, [uid]);
        }
    },
    {
        name: 'activitydays',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const uid = targetUser(m, args);
            const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const totals = Array(7).fill(0);
            for (const [k, d] of Object.entries(g.daily)) {
                totals[new Date(k + 'T00:00:00.000Z').getDay()] += d.users[uid] || 0;
            }
            const lines = names.map((n, i) => `• ${n}: ${num(totals[i])}`).join('\n');
            await mreply(sock, m, `📅 *ACTIVITY BY DAY* — ${mention(uid)}\n\n${lines}\n\n👑 *MEHFOOZ MD*`, [uid]);
        }
    },
    {
        name: 'userrank',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const uid = targetUser(m, args);
            const sorted = Object.entries(g.users).sort((a, b) => b[1].count - a[1].count);
            const idx = sorted.findIndex(([id]) => id === uid);
            if (idx === -1) return reply('⚠️ Is user ka koi record nahi mila.');
            await mreply(sock, m, `🏅 ${mention(uid)} ka rank: *#${idx + 1}* / ${sorted.length}\n\n👑 *MEHFOOZ MD*`, [uid]);
        }
    },
    {
        name: 'usertrend',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const uid = targetUser(m, args);
            const last7 = statsForRange(g, '7d').sorted.find(([id]) => id === uid);
            const g14 = collectDays(g, 336); // 14 din
            let prev7 = 0;
            for (const { key, data } of g14) {
                const age = (Date.now() - new Date(key + 'T00:00:00.000Z').getTime()) / 86400000;
                if (age >= 7 && age < 14) prev7 += data.users[uid] || 0;
            }
            const curr = last7 ? last7[1] : 0;
            const diff = curr - prev7;
            const trend = diff > 0 ? '📈 Barh rahi hai' : diff < 0 ? '📉 Kam ho rahi hai' : '➡️ Same rehe hai';
            await mreply(sock, m,
                `📊 *ACTIVITY TREND* — ${mention(uid)}\n\n` +
                `• Pichle 7 din: ${num(curr)}\n` +
                `• Uss se pichle 7 din: ${num(prev7)}\n` +
                `• Trend: ${trend} (${diff >= 0 ? '+' : ''}${num(diff)})\n\n👑 *MEHFOOZ MD* — pure numbers par mabni, koi anumaan nahi`, [uid]);
        }
    },
    {
        name: 'compareactivity',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const ci = m.message?.extendedTextMessage?.contextInfo || {};
            const mentions = (ci.mentionedJid || []).map(cleanId);
            if (mentions.length < 2) return reply('⚠️ Do users ko mention karein.\nExample: .compareactivity @user1 @user2');
            const [a, b] = mentions;
            const ua = g.users[a] || { count: 0 };
            const ub = g.users[b] || { count: 0 };
            await mreply(sock, m,
                `⚖️ *COMPARE ACTIVITY*\n\n` +
                `• ${mention(a)}: ${num(ua.count)} messages\n` +
                `• ${mention(b)}: ${num(ub.count)} messages\n\n` +
                `🏆 Aage: ${ua.count === ub.count ? 'Barabar' : mention(ua.count > ub.count ? a : b)}\n\n👑 *MEHFOOZ MD*`, [a, b]);
        }
    },

    // ---------------- group-wide breakdowns
    {
        name: 'daystats',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const rows = dayOfWeekBreakdown(g).map(r => `• ${r.day}: ${num(r.total)}`).join('\n');
            await mreply(sock, m, `📅 *ACTIVITY BY WEEKDAY*\n\n${rows}\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'activitychart',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const s = statsForRange(g, args[0] || '7d');
            const max = Math.max(1, ...s.hourly);
            const lines = s.hourly.map((c, h) => {
                const bars = Math.round((c / max) * 10);
                return `${fmtHour(h)} ${'█'.repeat(bars)}${bars === 0 ? '·' : ''} ${num(c)}`;
            }).join('\n');
            await mreply(sock, m, `📈 *ACTIVITY CHART (hour-wise)*\n\n${lines}\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'peakactivity',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const s = statsForRange(g, args[0] || '7d');
            await mreply(sock, m, `🔥 Group ka peak time: *${fmtHour(s.peakHour)}* (${num(s.hourly[s.peakHour])} messages)\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'quiettime',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const s = statsForRange(g, args[0] || '7d');
            await mreply(sock, m, `😴 Group ka sabse kam active time: *${fmtHour(s.quietHour)}* (${num(s.hourly[s.quietHour])} messages)\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'msgperhour',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const s = statsForRange(g, args[0] || '7d');
            await mreply(sock, m, `⏱️ Average messages/hour: *${num(s.avgPerHour)}*\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'msgperday',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const s = statsForRange(g, args[0] || '7d');
            await mreply(sock, m, `📅 Average messages/day: *${num(s.avgPerDay)}*\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'activeusers',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const s = statsForRange(g, args[0] || '7d');
            await mreply(sock, m, `🟢 Active users (${args[0] || '7d'}): *${num(s.activeUsers)}*\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'inactiveusers',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const s = statsForRange(g, args[0] || '7d');
            const totalKnown = Object.keys(g.users).length;
            const inactive = Math.max(0, totalKnown - s.activeUsers);
            await mreply(sock, m, `🔴 Inactive users (${args[0] || '7d'}): *${num(inactive)}* (record mein total ${num(totalKnown)} users)\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'userstats',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const s = statsForRange(g, args[0] || '30d');
            const top20 = s.sorted.slice(0, 20);
            const lines = top20.map(([uid, c], i) => `${i + 1}. ${mention(uid)} — ${num(c)}`).join('\n') || 'Koi data nahi.';
            await mreply(sock, m, `👥 *USER STATS (${args[0] || '30d'})*\n\n${lines}\n\n👑 *MEHFOOZ MD*`, top20.map(x => x[0]));
        }
    },

    // ---------------- data management
    {
        name: 'exportstats',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const buffer = Buffer.from(JSON.stringify(g, null, 2), 'utf8');
            await sock.sendMessage(gid, {
                document: buffer,
                fileName: `group-stats-${dayKey(Date.now())}.json`,
                mimetype: 'application/json'
            }, { quoted: m });
        }
    },
    {
        name: 'activitylog',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const recent = g.modlog.slice(-20).reverse();
            const lines = recent.map(e => `• ${new Date(e.t).toLocaleString()} — ${e.line}`).join('\n') || 'Log khaali hai.';
            await mreply(sock, m, `📜 *ACTIVITY LOG (last 20)*\n\n${lines}\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'clearstats',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            if (!(await requireGroupAdmin(sock, m, reply))) return;
            await reply('⚠️ Confirm ke saath data delete karne ke liye .statsreset confirm use karein.');
        }
    },
    {
        name: 'statsreset',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            if (!(await requireGroupAdmin(sock, m, reply))) return;
            if ((args[0] || '').toLowerCase() !== 'confirm') {
                return reply('⚠️ Data delete honay se pehle confirm karein:\n.statsreset confirm');
            }
            const botKey = getBotKey(sock);
            const store = loadStore(botKey);
            const g = getGroup(botKey, gid);
            store.groups[gid].backup = JSON.parse(JSON.stringify(g)); // safety backup rakho
            store.groups[gid] = {
                ...store.groups[gid],
                users: {}, daily: {}, total: 0, warns: 0, links: 0, spam: 0,
                deletes: 0, kicks: 0, joins: 0, leaves: 0, modlog: []
            };
            saveStore(botKey);
            await reply('✅ Group ki saari statistics reset ho gayi hain (backup mehfooz hai, .restorestats se wapis mil sakti hai).\n\n👑 *MEHFOOZ MD*');
        }
    },
    {
        name: 'backupstats',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            if (!(await requireGroupAdmin(sock, m, reply))) return;
            const botKey = getBotKey(sock);
            const g = getGroup(botKey, gid);
            g.backup = JSON.parse(JSON.stringify(g));
            saveStore(botKey);
            await reply('✅ Statistics ka backup ban gaya.\n\n👑 *MEHFOOZ MD*');
        }
    },
    {
        name: 'restorestats',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            if (!(await requireGroupAdmin(sock, m, reply))) return;
            const botKey = getBotKey(sock);
            const store = loadStore(botKey);
            const g = store.groups[gid];
            if (!g || !g.backup) return reply('⚠️ Koi backup nahi mila.');
            const backup = g.backup;
            store.groups[gid] = { ...backup, backup };
            saveStore(botKey);
            await reply('✅ Statistics backup se restore ho gayi hain.\n\n👑 *MEHFOOZ MD*');
        }
    },
    {
        name: 'retention',
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const days = parseInt(args[0], 10);
            if (!days) {
                return reply(`⚙️ Statistics kitne din tak record mein rehti hain: *${g.retentionDays} din*\n\nBadalne ke liye: .retention 60`);
            }
            if (!(await requireGroupAdmin(sock, m, reply))) return;
            g.retentionDays = Math.max(1, Math.min(365, days));
            pruneOldDays(g);
            scheduleSave(getBotKey(sock));
            await reply(`✅ Retention *${g.retentionDays} din* set ho gayi.\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'privacy',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            await reply(
                `🔐 *ACTIVITY TRACKING CONFIG*\n\n` +
                `• Tracking: ${g.paused ? 'Paused ⏸️' : 'Active ✅'}\n` +
                `• Retention: ${g.retentionDays} din\n` +
                `• Known users: ${num(Object.keys(g.users).length)}\n` +
                `• Total messages recorded: ${num(g.total)}\n\n` +
                `Note: message ka *content* kahin store nahi hota — sirf counts, waqt aur type (text/image/...).\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // ---------------- moderation-analytics (real, agar hooks lage hon; warna 0)
    {
        name: 'warstats',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            await reply(`⚠️ Total warnings di gayi: *${num(g.warns)}*\n\n👑 *MEHFOOZ MD*`);
        }
    },
    { name: 'warnstats', async execute(ctx) { return commands.find(c => c.name === 'warstats').execute(ctx); } },
    {
        name: 'linkstats',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            await reply(`🔗 Total links detect huay: *${num(g.links)}*\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'spamstats',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            await reply(`🚫 Total spam detect hua: *${num(g.spam)}*\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'deletestats',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            await reply(`🗑️ Bot ne kitne messages delete kiye: *${num(g.deletes)}*\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'kickstats',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            await reply(`🦵 Total kicks: *${num(g.kicks)}*\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'modlog',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const recent = g.modlog.slice(-15).reverse();
            const lines = recent.map(e => `• ${new Date(e.t).toLocaleString()} — ${e.line}`).join('\n') || 'Koi moderation action record nahi hui.';
            await reply(`🛡️ *MODERATION LOG*\n\n${lines}\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'modreport',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            await reply(
                `🛡️ *MODERATION SUMMARY*\n\n` +
                `• Warnings: ${num(g.warns)}\n` +
                `• Kicks: ${num(g.kicks)}\n` +
                `• Deleted messages: ${num(g.deletes)}\n` +
                `• Links caught: ${num(g.links)}\n` +
                `• Spam caught: ${num(g.spam)}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // ---------------- join/leave/growth (real agar hooks.join/leave laga hon)
    {
        name: 'joinstats',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            await reply(`➕ Total joins (record se): *${num(g.joins)}*\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'leavestats',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            await reply(`➖ Total leaves (record se): *${num(g.leaves)}*\n\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'growth',
        async execute({ sock, m, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            const g = getGroup(getBotKey(sock), gid);
            const net = g.joins - g.leaves;
            await reply(`📈 *GROUP GROWTH*\n\n• Joins: ${num(g.joins)}\n• Leaves: ${num(g.leaves)}\n• Net: ${net >= 0 ? '+' : ''}${num(net)}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // ---------------- alert / monitoring toggles
    // Yeh config ON/OFF karte hain. Asal trigger firing ke liye
    // index.js mein sock.ev.on('group-participants.update', ...) aur
    // flood-detection hook se hooks.join/leave/spam call karayein.
    ...['activityalert', 'spamalert', 'floodalert', 'newuseralert', 'adminlog'].map(name => ({
        name,
        async execute({ sock, m, args, reply }) {
            const gid = needsGroup(m, reply); if (!gid) return;
            if (!(await requireGroupAdmin(sock, m, reply))) return;
            const g = getGroup(getBotKey(sock), gid);
            const key = 'alert_' + name;
            const want = (args[0] || '').toLowerCase();
            if (want === 'on') { g[key] = true; scheduleSave(getBotKey(sock)); return reply(`✅ ${name} ON kar diya.\n\n👑 *MEHFOOZ MD*`); }
            if (want === 'off') { g[key] = false; scheduleSave(getBotKey(sock)); return reply(`✅ ${name} OFF kar diya.\n\n👑 *MEHFOOZ MD*`); }
            return reply(`⚙️ ${name} abhi: *${g[key] ? 'ON' : 'OFF'}*\n\nBadalne ke liye: .${name} on ya .${name} off`);
        }
    })),

    // ---------------- automation presence toggles (autoread/autorespond
    // pehle se general.js ke security menu mein maujood hain, is liye
    // yahan dobara nahi banaye gaye)
    ...['autorecording', 'autotyping', 'autoonline', 'autooffline', 'autostatus', 'autopause', 'autoresume', 'autoschedule', 'autoreact', 'autodelete'].map(name => ({
        name,
        async execute({ sock, m, args, reply }) {
            const gid = m.key.remoteJid;
            const g = getGroup(getBotKey(sock), gid);
            const key = 'auto_' + name;
            const want = (args[0] || '').toLowerCase();

            if (name === 'autopause') { g.paused = true; scheduleSave(getBotKey(sock)); return reply('⏸️ Statistics tracking is group ke liye pause kar di gayi.\n\n👑 *MEHFOOZ MD*'); }
            if (name === 'autoresume') { g.paused = false; scheduleSave(getBotKey(sock)); return reply('▶️ Statistics tracking dobara start ho gayi.\n\n👑 *MEHFOOZ MD*'); }

            if (want !== 'on' && want !== 'off') {
                return reply(`⚙️ ${name} abhi: *${g[key] ? 'ON' : 'OFF'}*\n\nBadalne ke liye: .${name} on ya .${name} off`);
            }
            g[key] = want === 'on';
            scheduleSave(getBotKey(sock));

            try {
                if (name === 'autotyping') await sock.sendPresenceUpdate(g[key] ? 'composing' : 'paused', gid);
                if (name === 'autorecording') await sock.sendPresenceUpdate(g[key] ? 'recording' : 'paused', gid);
                if (name === 'autoonline') await sock.sendPresenceUpdate(g[key] ? 'available' : 'unavailable');
                if (name === 'autooffline') await sock.sendPresenceUpdate(g[key] ? 'unavailable' : 'available');
            } catch { /* presence update fail ho to bhi setting save rahegi */ }

            await reply(`✅ ${name} *${g[key] ? 'ON' : 'OFF'}* kar diya.\n\n👑 *MEHFOOZ MD*`);
        }
    }))
];

module.exports = { commands, trackMessage, hooks, getGroup, getBotKey };