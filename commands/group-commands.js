/**
 * MEHFOOZ MD - Group Management Commands
 * Library: @whiskeysockets/baileys (Baileys)
 *
 * HOW TO USE:
 * Import this file in your handler.js:
 *   const groupCommands = require('./group-commands');
 *
 * Then in your switch-case (where `cmd` is the command name without the dot,
 * `sock` is your Baileys socket, `m` is the message object, `from` is the
 * group JID, `sender` is the sender's JID, `args` is the array of text
 * after the command):
 *
 *   case 'lock': await groupCommands.lock(sock, from, m); break;
 *   case 'kick': await groupCommands.kick(sock, from, m, args); break;
 *   ...
 *
 * You must already have your own isAdmin / isBotAdmin checks before
 * calling these (or use the helper `isGroupAdmin` provided below).
 */

const fs = require('fs');
const path = require('path');

// ---------- simple JSON-based storage (for warnings, welcome/goodbye msgs) ----------
const DB_DIR = path.join(__dirname, 'database');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const WARN_FILE = path.join(DB_DIR, 'warnings.json');
const WELCOME_FILE = path.join(DB_DIR, 'welcome.json');
const BANNED_FILE = path.join(DB_DIR, 'banned.json');

function readJSON(file) {
    if (!fs.existsSync(file)) return {};
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return {}; }
}
function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------- helpers ----------

/**
 * Strips the WhatsApp JID down to just the raw number/id part, ignoring
 * the device suffix (":12") and whether it's an @s.whatsapp.net or @lid
 * address, so two JIDs referring to the same account can be compared.
 */
function normalizeId(jid = '') {
    return jid.split('@')[0].split(':')[0];
}

/**
 * Returns { isSenderAdmin, isBotAdmin, participants, groupMetadata }
 *
 * WhatsApp accounts can appear in a group's participant list either as a
 * normal phone-number JID (123456789@s.whatsapp.net) or as a newer "lid"
 * JID (123456789@lid) - sometimes the bot's own account shows up in the
 * group under a different form than sock.user.id uses. To avoid wrongly
 * saying "bot is not admin" when it actually is, we collect every known
 * identifier for the bot and match against any of them.
 */
async function getGroupAdminInfo(sock, groupId, senderId) {
    const groupMetadata = await sock.groupMetadata(groupId);
    const participants = groupMetadata.participants;

    // Collect every id Baileys might expose for "this is me".
    const myIds = new Set();
    if (sock.user?.id) myIds.add(normalizeId(sock.user.id));
    if (sock.user?.lid) myIds.add(normalizeId(sock.user.lid));
    if (sock.authState?.creds?.me?.id) myIds.add(normalizeId(sock.authState.creds.me.id));
    if (sock.authState?.creds?.me?.lid) myIds.add(normalizeId(sock.authState.creds.me.lid));

    const senderParticipant = participants.find(
        p => p.id === senderId || normalizeId(p.id) === normalizeId(senderId)
    );
    const botParticipant = participants.find(
        p => myIds.has(normalizeId(p.id)) || (p.lid && myIds.has(normalizeId(p.lid)))
    );

    const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';
    const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

    return { isSenderAdmin, isBotAdmin, participants, groupMetadata };
}

function extractTargetJid(m, args) {
    // Priority 1: replied/quoted message sender
    if (m.message?.extendedTextMessage?.contextInfo?.participant) {
        return m.message.extendedTextMessage.contextInfo.participant;
    }
    // Priority 2: mentioned user
    const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid;
    if (mentioned && mentioned.length > 0) return mentioned[0];

    // Priority 3: number typed as argument, e.g. .kick 923001234567
    if (args && args[0]) {
        const num = args[0].replace(/[^0-9]/g, '');
        if (num) return num + '@s.whatsapp.net';
    }
    return null;
}

// ==================================================================
// LOCK / UNLOCK  (only admins can send messages)
// ==================================================================
async function lock(sock, groupId, m) {
    await sock.groupSettingUpdate(groupId, 'announcement');
    await sock.sendMessage(groupId, { text: '🔒 Group has been locked. Only admins can send messages now.' }, { quoted: m });
}

async function unlock(sock, groupId, m) {
    await sock.groupSettingUpdate(groupId, 'not_announcement');
    await sock.sendMessage(groupId, { text: '🔓 Group has been unlocked. Everyone can send messages now.' }, { quoted: m });
}

// ==================================================================
// MUTE / UNMUTE  (alias of lock/unlock in most bots)
// ==================================================================
async function mute(sock, groupId, m) {
    await sock.groupSettingUpdate(groupId, 'announcement');
    await sock.sendMessage(groupId, { text: '🔇 Group muted. Only admins can chat.' }, { quoted: m });
}

async function unmute(sock, groupId, m) {
    await sock.groupSettingUpdate(groupId, 'not_announcement');
    await sock.sendMessage(groupId, { text: '🔊 Group unmuted. Everyone can chat.' }, { quoted: m });
}

// ==================================================================
// KICK
// ==================================================================
async function kick(sock, groupId, m, args) {
    const target = extractTargetJid(m, args);
    if (!target) {
        return sock.sendMessage(groupId, {
            text:
                '🚫 *Kick karne ka tareeqa:*\n\n' +
                'Kisi member ke message par reply karke `.kick` likhein,\n' +
                'YA number ke sath likhein: `.kick 923001234567`'
        }, { quoted: m });
    }
    await sock.groupParticipantsUpdate(groupId, [target], 'remove');
    await sock.sendMessage(groupId, { text: `✅ @${target.split('@')[0]} has been kicked.`, mentions: [target] }, { quoted: m });
}

// ==================================================================
// KICKME (self remove)
// ==================================================================
async function kickme(sock, groupId, m) {
    const senderId = m.key.participant || m.key.remoteJid;
    await sock.sendMessage(groupId, { text: '👋 Bye bye!' }, { quoted: m });
    await sock.groupParticipantsUpdate(groupId, [senderId], 'remove');
}

// ==================================================================
// ADD
// ==================================================================
async function add(sock, groupId, m, args) {
    if (!args[0]) return sock.sendMessage(groupId, {
        text:
            '➕ *Member add karne ka tareeqa:*\n\n' +
            '`.add 923001234567`\n\n' +
            'Country code ke sath poora number likhein, + ya spaces ke bagair.'
    }, { quoted: m });
    const num = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    const result = await sock.groupParticipantsUpdate(groupId, [num], 'add');
    const status = result[0]?.status;
    if (status === '403') {
        // couldn't add directly, send invite link instead
        const code = await sock.groupInviteCode(groupId);
        await sock.sendMessage(num, { text: `You've been invited to join the group:\nhttps://chat.whatsapp.com/${code}` });
        await sock.sendMessage(groupId, { text: `⚠️ Couldn't add directly, invite link sent to the user.` }, { quoted: m });
    } else {
        await sock.sendMessage(groupId, { text: `✅ Added successfully.` }, { quoted: m });
    }
}

// ==================================================================
// PROMOTE / DEMOTE
// ==================================================================
async function promote(sock, groupId, m, args) {
    const target = extractTargetJid(m, args);
    if (!target) return sock.sendMessage(groupId, {
        text:
            '⬆️ *Admin banane ka tareeqa:*\n\n' +
            'Jis member ko admin banana hai uske message par reply karke `.promote` likhein,\n' +
            'YA number ke sath: `.promote 923001234567`'
    }, { quoted: m });
    await sock.groupParticipantsUpdate(groupId, [target], 'promote');
    await sock.sendMessage(groupId, { text: `⬆️ @${target.split('@')[0]} is now an admin.`, mentions: [target] }, { quoted: m });
}

async function demote(sock, groupId, m, args) {
    const target = extractTargetJid(m, args);
    if (!target) return sock.sendMessage(groupId, {
        text:
            '⬇️ *Admin hatane ka tareeqa:*\n\n' +
            'Jis admin ko hatana hai uske message par reply karke `.demote` likhein,\n' +
            'YA number ke sath: `.demote 923001234567`'
    }, { quoted: m });
    await sock.groupParticipantsUpdate(groupId, [target], 'demote');
    await sock.sendMessage(groupId, { text: `⬇️ @${target.split('@')[0]} is no longer an admin.`, mentions: [target] }, { quoted: m });
}

// ==================================================================
// TAGALL / HIDETAG
// ==================================================================
async function tagall(sock, groupId, m, args) {
    const metadata = await sock.groupMetadata(groupId);
    const participants = metadata.participants;
    const text = args.join(' ') || '📢 Attention everyone!';
    let message = `${text}\n\n`;
    participants.forEach(p => { message += `@${p.id.split('@')[0]}\n`; });
    await sock.sendMessage(groupId, { text: message, mentions: participants.map(p => p.id) }, { quoted: m });
}

async function hidetag(sock, groupId, m, args) {
    const metadata = await sock.groupMetadata(groupId);
    const participants = metadata.participants;
    const text = args.join(' ') || '';
    await sock.sendMessage(groupId, { text, mentions: participants.map(p => p.id) }, { quoted: m });
}

// ==================================================================
// GROUPINFO
// ==================================================================
async function groupinfo(sock, groupId, m) {
    const metadata = await sock.groupMetadata(groupId);
    const admins = metadata.participants.filter(p => p.admin).length;
    const info = `📋 *Group Info*\n\n` +
        `Name: ${metadata.subject}\n` +
        `Description: ${metadata.desc || 'None'}\n` +
        `Members: ${metadata.participants.length}\n` +
        `Admins: ${admins}\n` +
        `Created: ${new Date(metadata.creation * 1000).toLocaleString()}\n` +
        `ID: ${metadata.id}`;
    await sock.sendMessage(groupId, { text: info }, { quoted: m });
}

// ==================================================================
// LINK / REVOKE / GROUPLINK
// ==================================================================
async function link(sock, groupId, m) {
    const code = await sock.groupInviteCode(groupId);
    await sock.sendMessage(groupId, { text: `🔗 https://chat.whatsapp.com/${code}` }, { quoted: m });
}

async function grouplink(sock, groupId, m) {
    return link(sock, groupId, m);
}

async function revoke(sock, groupId, m) {
    await sock.groupRevokeInvite(groupId);
    const newCode = await sock.groupInviteCode(groupId);
    await sock.sendMessage(groupId, { text: `♻️ Old link revoked.\nNew link: https://chat.whatsapp.com/${newCode}` }, { quoted: m });
}

// ==================================================================
// SETNAME / SETDESC / SETPP / GROUPNAME / GROUPDESC
// ==================================================================
async function setname(sock, groupId, m, args) {
    const newName = args.join(' ');
    if (!newName) return sock.sendMessage(groupId, {
        text: '📛 *Group ka naam badalne ka tareeqa:*\n\n`.setname Naya Group Name`'
    }, { quoted: m });
    await sock.groupUpdateSubject(groupId, newName);
    await sock.sendMessage(groupId, { text: `✅ Group name changed to: ${newName}` }, { quoted: m });
}

async function groupname(sock, groupId, m) {
    const metadata = await sock.groupMetadata(groupId);
    await sock.sendMessage(groupId, { text: `📛 Current group name: ${metadata.subject}` }, { quoted: m });
}

async function setdesc(sock, groupId, m, args) {
    const newDesc = args.join(' ');
    if (!newDesc) return sock.sendMessage(groupId, {
        text: '📝 *Group description badalne ka tareeqa:*\n\n`.setdesc Nayi description yahan likhein`'
    }, { quoted: m });
    await sock.groupUpdateDescription(groupId, newDesc);
    await sock.sendMessage(groupId, { text: `✅ Group description updated.` }, { quoted: m });
}

async function groupdesc(sock, groupId, m) {
    const metadata = await sock.groupMetadata(groupId);
    await sock.sendMessage(groupId, { text: `📝 Current description:\n${metadata.desc || 'None'}` }, { quoted: m });
}

/**
 * setpp expects `imageBuffer` — you must extract this from the quoted/attached
 * image in your handler.js first, e.g. using downloadMediaMessage(m, 'buffer').
 */
async function setpp(sock, groupId, m, imageBuffer) {
    if (!imageBuffer) return sock.sendMessage(groupId, {
        text: '🖼️ *Group ki picture badalne ka tareeqa:*\n\nKisi image par reply karke `.setpp` likhein.'
    }, { quoted: m });
    await sock.updateProfilePicture(groupId, imageBuffer);
    await sock.sendMessage(groupId, { text: '✅ Group picture updated.' }, { quoted: m });
}

// ==================================================================
// LEAVE
// ==================================================================
async function leave(sock, groupId, m) {
    await sock.sendMessage(groupId, { text: '👋 Goodbye everyone!' }, { quoted: m });
    await sock.groupLeave(groupId);
}

// ==================================================================
// ADMINS / LISTADMIN
// ==================================================================
async function admins(sock, groupId, m) {
    const metadata = await sock.groupMetadata(groupId);
    const adminList = metadata.participants.filter(p => p.admin);
    let text = '👑 *Group Admins*\n\n';
    adminList.forEach(a => { text += `@${a.id.split('@')[0]}\n`; });
    await sock.sendMessage(groupId, { text, mentions: adminList.map(a => a.id) }, { quoted: m });
}

async function listadmin(sock, groupId, m) {
    return admins(sock, groupId, m);
}

// ==================================================================
// EPHEMERAL (disappearing messages)
// ==================================================================
async function ephemeral(sock, groupId, m, args) {
    // args[0] can be: off, 24h, 7d, 90d
    const map = { off: 0, '24h': 86400, '7d': 604800, '90d': 7776000 };
    const duration = map[args[0]];
    if (duration === undefined) {
        return sock.sendMessage(groupId, {
            text:
                '⏱️ *Disappearing messages ka tareeqa:*\n\n' +
                '`.ephemeral off` — band karein\n' +
                '`.ephemeral 24h` — 24 ghante\n' +
                '`.ephemeral 7d` — 7 din\n' +
                '`.ephemeral 90d` — 90 din'
        }, { quoted: m });
    }
    await sock.groupToggleEphemeral(groupId, duration);
    await sock.sendMessage(groupId, { text: `⏱️ Disappearing messages set to: ${args[0]}` }, { quoted: m });
}

// ==================================================================
// WELCOME / GOODBYE / SETWELCOME / SETGOODBYE
// (call handleWelcome/handleGoodbye from your 'group-participants.update' event)
// ==================================================================
async function setwelcome(sock, groupId, m, args) {
    const msg = args.join(' ');
    if (!msg) return sock.sendMessage(groupId, { text: '⚠️ Give welcome text. Use {user} and {group} as placeholders.' }, { quoted: m });
    const data = readJSON(WELCOME_FILE);
    data[groupId] = data[groupId] || {};
    data[groupId].welcomeText = msg;
    data[groupId].welcomeEnabled = true;
    writeJSON(WELCOME_FILE, data);
    await sock.sendMessage(groupId, { text: '✅ Welcome message saved.' }, { quoted: m });
}

async function setgoodbye(sock, groupId, m, args) {
    const msg = args.join(' ');
    if (!msg) return sock.sendMessage(groupId, { text: '⚠️ Give goodbye text. Use {user} and {group} as placeholders.' }, { quoted: m });
    const data = readJSON(WELCOME_FILE);
    data[groupId] = data[groupId] || {};
    data[groupId].goodbyeText = msg;
    data[groupId].goodbyeEnabled = true;
    writeJSON(WELCOME_FILE, data);
    await sock.sendMessage(groupId, { text: '✅ Goodbye message saved.' }, { quoted: m });
}

async function welcome(sock, groupId, m, args) {
    // .welcome on/off toggle
    const data = readJSON(WELCOME_FILE);
    data[groupId] = data[groupId] || {};
    if (args[0] === 'off') data[groupId].welcomeEnabled = false;
    else data[groupId].welcomeEnabled = true;
    writeJSON(WELCOME_FILE, data);
    await sock.sendMessage(groupId, { text: `✅ Welcome messages turned ${data[groupId].welcomeEnabled ? 'ON' : 'OFF'}.` }, { quoted: m });
}

async function goodbye(sock, groupId, m, args) {
    const data = readJSON(WELCOME_FILE);
    data[groupId] = data[groupId] || {};
    if (args[0] === 'off') data[groupId].goodbyeEnabled = false;
    else data[groupId].goodbyeEnabled = true;
    writeJSON(WELCOME_FILE, data);
    await sock.sendMessage(groupId, { text: `✅ Goodbye messages turned ${data[groupId].goodbyeEnabled ? 'ON' : 'OFF'}.` }, { quoted: m });
}

/**
 * Call this from your index.js inside:
 * sock.ev.on('group-participants.update', async (update) => { ... })
 * for action === 'add'
 */
async function handleWelcomeEvent(sock, update) {
    const data = readJSON(WELCOME_FILE);
    const groupId = update.id;
    const settings = data[groupId];
    if (!settings?.welcomeEnabled) return;
    const metadata = await sock.groupMetadata(groupId);
    for (const participant of update.participants) {
        const text = (settings.welcomeText || 'Welcome {user} to {group}!')
            .replace('{user}', `@${participant.split('@')[0]}`)
            .replace('{group}', metadata.subject);
        await sock.sendMessage(groupId, { text, mentions: [participant] });
    }
}

/**
 * Call this from the same event listener for action === 'remove'
 */
async function handleGoodbyeEvent(sock, update) {
    const data = readJSON(WELCOME_FILE);
    const groupId = update.id;
    const settings = data[groupId];
    if (!settings?.goodbyeEnabled) return;
    const metadata = await sock.groupMetadata(groupId);
    for (const participant of update.participants) {
        const text = (settings.goodbyeText || 'Goodbye {user}!')
            .replace('{user}', `@${participant.split('@')[0]}`)
            .replace('{group}', metadata.subject);
        await sock.sendMessage(groupId, { text, mentions: [participant] });
    }
}

// ==================================================================
// GROUP (generic toggle - example: enable/disable bot in group)
// ==================================================================
async function group(sock, groupId, m, args) {
    const data = readJSON(WELCOME_FILE);
    data[groupId] = data[groupId] || {};
    if (args[0] === 'off') {
        data[groupId].botEnabled = false;
        writeJSON(WELCOME_FILE, data);
        return sock.sendMessage(groupId, { text: '🔴 Bot commands disabled in this group.' }, { quoted: m });
    }
    data[groupId].botEnabled = true;
    writeJSON(WELCOME_FILE, data);
    await sock.sendMessage(groupId, { text: '🟢 Bot commands enabled in this group.' }, { quoted: m });
}

// ==================================================================
// POLL
// ==================================================================
async function poll(sock, groupId, m, args) {
    // usage: .poll Question | option1 | option2 | option3
    const parts = args.join(' ').split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) {
        return sock.sendMessage(groupId, {
            text:
                '📊 *Poll banane ka tareeqa:*\n\n' +
                '.poll Sawal | Option1 | Option2 | Option3\n\n' +
                '*Misaal:*\n' +
                '.poll Kal ki meeting kis time rakhein? | 5 PM | 7 PM | 9 PM\n\n' +
                '➖ Har hissa " | " (space-pipe-space) se alag karein.\n' +
                '➖ Pehla hissa sawal hai, uske baad kam az kam 2 options.'
        }, { quoted: m });
    }
    const [question, ...options] = parts;
    await sock.sendMessage(groupId, {
        poll: {
            name: question,
            values: options,
            selectableCount: 1
        }
    }, { quoted: m });
}

// ==================================================================
// WARN / RESETWARN / LISTWARN
// ==================================================================
async function warn(sock, groupId, m, args) {
    const target = extractTargetJid(m, args);
    if (!target) return sock.sendMessage(groupId, {
        text:
            '⚠️ *Warning dene ka tareeqa:*\n\n' +
            'Jis member ko warning deni hai uske message par reply karke `.warn` likhein,\n' +
            'YA number ke sath: `.warn 923001234567`\n\n' +
            '3 warnings poori hone par member khud-ba-khud group se nikal diya jayega.'
    }, { quoted: m });

    const data = readJSON(WARN_FILE);
    data[groupId] = data[groupId] || {};
    data[groupId][target] = (data[groupId][target] || 0) + 1;
    writeJSON(WARN_FILE, data);

    const count = data[groupId][target];
    await sock.sendMessage(groupId, {
        text: `⚠️ @${target.split('@')[0]} has been warned. (${count}/3)`,
        mentions: [target]
    }, { quoted: m });

    if (count >= 3) {
        await sock.groupParticipantsUpdate(groupId, [target], 'remove');
        data[groupId][target] = 0;
        writeJSON(WARN_FILE, data);
        await sock.sendMessage(groupId, { text: `🚫 @${target.split('@')[0]} reached 3 warnings and was removed.`, mentions: [target] });
    }
}

async function resetwarn(sock, groupId, m, args) {
    const target = extractTargetJid(m, args);
    if (!target) return sock.sendMessage(groupId, {
        text: '♻️ *Warnings reset karne ka tareeqa:*\n\nJis member ki warnings hataani hain uske message par reply karke `.resetwarn` likhein.'
    }, { quoted: m });
    const data = readJSON(WARN_FILE);
    if (data[groupId]) data[groupId][target] = 0;
    writeJSON(WARN_FILE, data);
    await sock.sendMessage(groupId, { text: `✅ Warnings reset for @${target.split('@')[0]}`, mentions: [target] }, { quoted: m });
}

async function listwarn(sock, groupId, m) {
    const data = readJSON(WARN_FILE);
    const groupWarns = data[groupId] || {};
    const entries = Object.entries(groupWarns).filter(([, count]) => count > 0);
    if (entries.length === 0) return sock.sendMessage(groupId, { text: '✅ No warnings in this group.' }, { quoted: m });
    let text = '⚠️ *Warning List*\n\n';
    const mentions = [];
    entries.forEach(([jid, count]) => {
        text += `@${jid.split('@')[0]}: ${count}/3\n`;
        mentions.push(jid);
    });
    await sock.sendMessage(groupId, { text, mentions }, { quoted: m });
}

// ==================================================================
// BANNED (list/manage globally banned users the bot should auto-kick)
// ==================================================================
async function banned(sock, groupId, m, args) {
    const data = readJSON(BANNED_FILE);
    const list = data.list || [];

    if (args[0] === 'add') {
        const target = extractTargetJid(m, args.slice(1));
        if (!target) return sock.sendMessage(groupId, {
            text: '🚫 *Ban list mein add karne ka tareeqa:*\n\nJis member ko banned list mein daalna hai uske message par reply karke `.banned add` likhein.'
        }, { quoted: m });
        if (!list.includes(target)) list.push(target);
        data.list = list;
        writeJSON(BANNED_FILE, data);
        return sock.sendMessage(groupId, { text: `🚫 @${target.split('@')[0]} added to banned list.`, mentions: [target] }, { quoted: m });
    }

    if (args[0] === 'remove') {
        const target = extractTargetJid(m, args.slice(1));
        data.list = list.filter(j => j !== target);
        writeJSON(BANNED_FILE, data);
        return sock.sendMessage(groupId, { text: `✅ @${target.split('@')[0]} removed from banned list.`, mentions: [target] }, { quoted: m });
    }

    // default: show list
    if (list.length === 0) return sock.sendMessage(groupId, { text: 'No banned users.' }, { quoted: m });
    let text = '🚫 *Banned Users*\n\n';
    list.forEach(j => { text += `@${j.split('@')[0]}\n`; });
    await sock.sendMessage(groupId, { text, mentions: list }, { quoted: m });
}

// ==================================================================
// PING / BOTSTATUS
// ==================================================================
async function ping(sock, groupId, m) {
    const start = Date.now();
    const sent = await sock.sendMessage(groupId, { text: '🏓 Pinging...' }, { quoted: m });
    const latency = Date.now() - start;
    await sock.sendMessage(groupId, { text: `🏓 Pong! ${latency}ms` }, { edit: sent.key });
}

const BOT_START_TIME = Date.now();

async function botstatus(sock, groupId, m) {
    const uptimeMs = Date.now() - BOT_START_TIME;
    const seconds = Math.floor(uptimeMs / 1000) % 60;
    const minutes = Math.floor(uptimeMs / (1000 * 60)) % 60;
    const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
    const text = `🤖 *MEHFOOZ MD Status*\n\nUptime: ${hours}h ${minutes}m ${seconds}s\nStatus: Online ✅`;
    await sock.sendMessage(groupId, { text }, { quoted: m });
}

// ==================================================================
// TOTALMEMBER / ONLINE
// ==================================================================
async function totalmember(sock, groupId, m) {
    const metadata = await sock.groupMetadata(groupId);
    await sock.sendMessage(groupId, { text: `👥 Total members: ${metadata.participants.length}` }, { quoted: m });
}

/**
 * NOTE: Baileys does not reliably expose "online" presence for every
 * participant at once. This subscribes to presence updates for a short
 * window and reports who fired a presence event as "online" during it.
 * It is an approximation, not a guaranteed accurate online list.
 */
async function online(sock, groupId, m) {
    const metadata = await sock.groupMetadata(groupId);
    const onlineSet = new Set();

    const listener = (update) => {
        if (update.presences) {
            for (const jid of Object.keys(update.presences)) {
                const presence = update.presences[jid]?.lastKnownPresence;
                if (presence === 'available' || presence === 'composing') onlineSet.add(jid);
            }
        }
    };

    sock.ev.on('presence.update', listener);
    for (const p of metadata.participants) {
        await sock.presenceSubscribe(p.id).catch(() => {});
    }
    await new Promise(resolve => setTimeout(resolve, 4000));
    sock.ev.off('presence.update', listener);

    if (onlineSet.size === 0) {
        return sock.sendMessage(groupId, { text: 'Could not detect online members right now.' }, { quoted: m });
    }
    let text = '🟢 *Recently Active*\n\n';
    onlineSet.forEach(j => { text += `@${j.split('@')[0]}\n`; });
    await sock.sendMessage(groupId, { text, mentions: [...onlineSet] }, { quoted: m });
}

// ==================================================================
// INVITE / JOIN (bot joins another group via link)
// ==================================================================
async function invite(sock, groupId, m, args) {
    // sends the current group's invite link to a number given as arg
    if (!args[0]) return sock.sendMessage(groupId, {
        text: '📩 *Invite bhejne ka tareeqa:*\n\n`.invite 923001234567`'
    }, { quoted: m });
    const num = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    const code = await sock.groupInviteCode(groupId);
    await sock.sendMessage(num, { text: `You're invited to join: https://chat.whatsapp.com/${code}` });
    await sock.sendMessage(groupId, { text: '✅ Invite sent.' }, { quoted: m });
}

async function join(sock, groupId, m, args) {
    // bot joins a group using an invite link, e.g. .join https://chat.whatsapp.com/XXXX
    const link = args[0];
    if (!link || !link.includes('chat.whatsapp.com/')) {
        return sock.sendMessage(groupId, {
            text: '🔗 *Group join karne ka tareeqa:*\n\n`.join https://chat.whatsapp.com/XXXXXXXXXX`'
        }, { quoted: m });
    }
    const code = link.split('chat.whatsapp.com/')[1];
    try {
        await sock.groupAcceptInvite(code);
        await sock.sendMessage(groupId, { text: '✅ Joined the group successfully.' }, { quoted: m });
    } catch (err) {
        await sock.sendMessage(groupId, { text: `❌ Failed to join: ${err.message}` }, { quoted: m });
    }
}

module.exports = {
    getGroupAdminInfo,
    extractTargetJid,
    lock, unlock,
    mute, unmute,
    kick, kickme, add,
    promote, demote,
    tagall, hidetag,
    groupinfo,
    link, grouplink, revoke,
    setname, groupname, setdesc, groupdesc, setpp,
    leave,
    admins, listadmin,
    ephemeral,
    welcome, goodbye, setwelcome, setgoodbye, handleWelcomeEvent, handleGoodbyeEvent,
    group,
    poll,
    warn, resetwarn, listwarn,
    banned,
    ping, botstatus,
    totalmember, online,
    invite, join
};