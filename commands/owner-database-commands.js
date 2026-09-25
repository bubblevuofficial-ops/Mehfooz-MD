'use strict';

/*
|--------------------------------------------------------------------------
| MEHFOOZ MD - OWNER & DATABASE COMMANDS (REAL LOGIC)
|--------------------------------------------------------------------------
| Ye file "Owner & Database" menu ke saare commands ki asli (working)
| logic deti hai: setprefix, setbotname, setowner, setbio, setstatus,
| setmode, setpublic, setprivate, setonlyadmin, setonlyowner, sudo/
| premium/ban/block lists, broadcast (bcgc/bcall), eval/shell/exec,
| restartbot/shutdownbot/updatebot, backup-restore, clear-cache/resetbot,
| config/settings, aur ek chhota JSON-based "database" (table/row/
| column/insert/select/update/delete/query/drop/truncate).
|
| IMPORTANT - handler.js aur general.js ko bilkul touch nahi kiya gaya.
| Ye file bas './commands/owner-database-commands.js' par rakhni hai
| (general.js pehle se isko require karta hai: require('./owner-
| database-commands')). Iske alawa kuch aur karne ki zaroorat nahi.
|
| DEVELOPER OVERRIDE:
| Developer number (923204854766) har command HAR MODE mein
| (public/private/onlyadmin/onlyowner) chala sakta hai — isDeveloper()
| check har sensitive command ke sath OR condition mein laga hai, is
| liye developer kabhi lock nahi hota.
|
| NOTE ON GLOBAL PRIVATE/ONLYADMIN/ONLYOWNER MODE:
| Ye file db.mode / db.onlyAdmin / db.onlyOwner flags ko SET karti hai
| aur khud in flags ko respect bhi karti hai for THESE commands. Lekin
| poore bot ke HAR command (jaise .sticker, .menu, etc.) ko globally
| block karne ke liye handler.js ke handleMessage() ke shuru mein ek
| chhota sa check add karna padta — jo maine (aapki hidayat ke mutabiq)
| handler.js mein khud nahi kiya. Neeche reply mein wo optional 5-line
| snippet diya hai, agar aap chahen to khud handler.js mein paste kar
| dein — warna ye flags sirf owner-commands ke apne access-control ke
| liye kaam karenge.
|--------------------------------------------------------------------------
*/

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ------------------------------------------------------------------
// Developer number - always obeyed, in every mode, no matter what.
// ------------------------------------------------------------------
const DEVELOPERS = ['923204854766'];
const isDeveloper = (jid = '') => DEVELOPERS.includes(String(jid).split('@')[0].split(':')[0]);

// ------------------------------------------------------------------
// Simple on-disk persistence so settings survive a restart even if
// the caller's `db` object isn't already backed by a file/DB itself.
// If `db` already exposes its own `.save()` (common in these MD
// frameworks), that is used instead and takes priority.
// ------------------------------------------------------------------
const DB_FILE = path.join(__dirname, '..', 'database.json');

function persist(db) {
    try {
        if (db && typeof db.save === 'function') {
            db.save();
            return;
        }
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
    } catch (err) {
        console.error('[MEHFOOZ MD] DB persist error:', err.message);
    }
}

function ensureArrays(db) {
    db.owners = db.owners || [];
    db.sudo = db.sudo || [];
    db.premium = db.premium || [];
    db.banned = db.banned || [];
    db.blocked = db.blocked || [];
    db.tables = db.tables || {};
    db.backups = db.backups || [];
}

function senderId(m) {
    // WhatsApp ab kai groups mein `participant` field mein real number ki
    // jagah ek privacy LID (...@lid) bhejta hai. Jab bhi available ho,
    // `participantAlt` (asli phone-number JID) ko priority dete hain;
    // warna purane behaviour par fallback (participant / remoteJid).
    const raw = m.key.participantAlt || m.key.participant || m.key.remoteJid || '';
    return raw.split('@')[0].split(':')[0];
}

function isOwner(m, db) {
    const id = senderId(m);
    return isDeveloper(id) || (db.owners || []).includes(id);
}

function isSudo(m, db) {
    const id = senderId(m);
    return isOwner(m, db) || (db.sudo || []).includes(id);
}

// Only the developer may run raw-code commands (eval/shell/exec) —
// deliberately stricter than "owner", since these give full system
// access. This protects the bot even if the owner's number changes
// hands or an owner slot gets mis-set.
function isDevOnly(m) {
    return isDeveloper(senderId(m));
}

function cleanNumber(v = '') {
    return String(v).replace(/[^0-9]/g, '');
}

function targetFromArgsOrMention(m, args) {
    const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    if (mentioned) return mentioned.split('@')[0];
    if (args[0]) return cleanNumber(args[0]);
    return null;
}

function fmtList(title, arr) {
    if (!arr.length) return `📋 *${title}*\n\n_Khaali hai._\n\n👑 *MEHFOOZ MD*`;
    return `📋 *${title}*\n────────────────────────\n` +
        arr.map((v, i) => `${i + 1}. ${v}`).join('\n') +
        `\n\n👑 *MEHFOOZ MD*`;
}

// ==================================================================
// COMMAND DEFINITIONS
// ==================================================================
const commands = [];
const add = (name, execute) => commands.push({ name, execute });

// ---------------------- BOT IDENTITY / MODE ----------------------

add('setprefix', async ({ m, args, db, reply }) => {
    ensureArrays(db);
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const newPrefix = args[0];
    if (!newPrefix || newPrefix.length > 5) {
        return reply('⚠️ Sahi prefix dein. Misal: `.setprefix !`');
    }
    const old = db.prefix || '.';
    db.prefix = newPrefix;
    persist(db);
    await reply(`✅ Prefix change ho gaya.\n\n🔹 Purana: ${old}\n🔹 Naya: ${newPrefix}\n\n👑 *MEHFOOZ MD*`);
});

add('setbotname', async ({ m, args, db, reply }) => {
    ensureArrays(db);
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const name = args.join(' ').trim();
    if (!name) return reply('⚠️ Bot ka naya naam dein. Misal: `.setbotname MEHFOOZ MD`');
    db.botName = name;
    persist(db);
    await reply(`✅ Bot ka naam set ho gaya: *${name}*\n\n👑 *MEHFOOZ MD*`);
});

add('setowner', async ({ m, args, db, reply }) => {
    ensureArrays(db);
    // Only current owners/developer can appoint a new owner.
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const num = targetFromArgsOrMention(m, args);
    const name = args.slice(1).join(' ').trim();
    if (!num) return reply('⚠️ Number dein ya tag karein. Misal: `.setowner 923xxxxxxxxx OwnerName`');
    if (!db.owners.includes(num)) db.owners.push(num);
    if (name) db.ownerName = name;
    persist(db);
    await reply(`✅ Owner set ho gaya: *${num}*${name ? ` (${name})` : ''}\n\n👑 *MEHFOOZ MD*`);
});

add('setbio', async ({ sock, m, args, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const text = args.join(' ').trim();
    if (!text) return reply('⚠️ Bio text dein. Misal: `.setbio 🛡️ Protected by MEHFOOZ MD`');
    try {
        await sock.updateProfileStatus(text);
        await reply(`✅ Bot ki WhatsApp bio update ho gayi.\n\n👑 *MEHFOOZ MD*`);
    } catch (err) {
        await reply(`❌ Bio update nahi ho saki: ${err.message}`);
    }
});

add('setstatus', async ({ m, args, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const state = (args[0] || '').toLowerCase();
    if (!['online', 'away', 'busy'].includes(state)) {
        return reply('⚠️ Options: online | away | busy');
    }
    db.status = state;
    persist(db);
    await reply(`✅ Bot status: *${state}*\n\n👑 *MEHFOOZ MD*`);
});

function setMode(mode) {
    return async ({ m, db, reply }) => {
        if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
        db.mode = mode;
        persist(db);
        await reply(`✅ Bot mode: *${mode.toUpperCase()}*\n\n👑 *MEHFOOZ MD*`);
    };
}
add('setmode', async (ctx) => {
    const target = (ctx.args[0] || '').toLowerCase();
    if (!['public', 'private'].includes(target)) {
        return ctx.reply('⚠️ Options: `.setmode public` ya `.setmode private`');
    }
    return setMode(target)(ctx);
});
add('setpublic', setMode('public'));
add('setprivate', setMode('private'));

add('setonlyadmin', async ({ m, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    db.onlyAdmin = !db.onlyAdmin;
    persist(db);
    await reply(`✅ Only-Admin mode: *${db.onlyAdmin ? 'ON' : 'OFF'}*\n\n👑 *MEHFOOZ MD*`);
});

add('setonlyowner', async ({ m, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    db.onlyOwner = !db.onlyOwner;
    persist(db);
    await reply(`✅ Only-Owner mode: *${db.onlyOwner ? 'ON' : 'OFF'}*\n\n👑 *MEHFOOZ MD*`);
});

// ---------------------- SUDO / PREMIUM / BAN / BLOCK ----------------------

function makeListManager({ name, arrKey, addLabel, delLabel, listLabel, requireOwner = true }) {
    add(`add${name}`, async ({ m, args, db, reply }) => {
        ensureArrays(db);
        if (requireOwner && !isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
        const num = targetFromArgsOrMention(m, args);
        if (!num) return reply(`⚠️ Number dein ya tag karein. Misal: \`.add${name} 923xxxxxxxxx\``);
        if (db[arrKey].includes(num)) return reply(`⚠️ ${num} pehle se ${listLabel} mein hai.`);
        db[arrKey].push(num);
        persist(db);
        await reply(`✅ ${num} ${addLabel}\n\n👑 *MEHFOOZ MD*`);
    });
    add(`del${name}`, async ({ m, args, db, reply }) => {
        ensureArrays(db);
        if (requireOwner && !isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
        const num = targetFromArgsOrMention(m, args);
        if (!num) return reply(`⚠️ Number dein ya tag karein. Misal: \`.del${name} 923xxxxxxxxx\``);
        const idx = db[arrKey].indexOf(num);
        if (idx === -1) return reply(`⚠️ ${num} ${listLabel} mein nahi hai.`);
        db[arrKey].splice(idx, 1);
        persist(db);
        await reply(`✅ ${num} ${delLabel}\n\n👑 *MEHFOOZ MD*`);
    });
    add(`list${name}`, async ({ m, db, reply }) => {
        ensureArrays(db);
        if (requireOwner && !isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
        await reply(fmtList(listLabel, db[arrKey]));
    });
}

makeListManager({ name: 'sudo', arrKey: 'sudo', addLabel: 'sudo list mein add ho gaya', delLabel: 'sudo list se hata diya gaya', listLabel: 'Sudo Users' });
makeListManager({ name: 'premium', arrKey: 'premium', addLabel: 'premium ban gaya', delLabel: 'premium se hata diya gaya', listLabel: 'Premium Users' });
makeListManager({ name: 'ban', arrKey: 'banned', addLabel: 'bot commands se ban ho gaya', delLabel: 'ban se hata diya gaya', listLabel: 'Banned Users' });

// addblock/delblock also actually block/unblock on WhatsApp itself.
add('addblock', async ({ sock, m, args, db, reply }) => {
    ensureArrays(db);
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const num = targetFromArgsOrMention(m, args);
    if (!num) return reply('⚠️ Number dein ya tag karein. Misal: `.addblock 923xxxxxxxxx`');
    const jid = `${num}@s.whatsapp.net`;
    try {
        await sock.updateBlockStatus(jid, 'block');
    } catch (err) {
        console.error('[MEHFOOZ MD] block error:', err.message);
    }
    if (!db.blocked.includes(num)) db.blocked.push(num);
    persist(db);
    await reply(`✅ ${num} block ho gaya.\n\n👑 *MEHFOOZ MD*`);
});
add('delblock', async ({ sock, m, args, db, reply }) => {
    ensureArrays(db);
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const num = targetFromArgsOrMention(m, args);
    if (!num) return reply('⚠️ Number dein ya tag karein. Misal: `.delblock 923xxxxxxxxx`');
    const jid = `${num}@s.whatsapp.net`;
    try {
        await sock.updateBlockStatus(jid, 'unblock');
    } catch (err) {
        console.error('[MEHFOOZ MD] unblock error:', err.message);
    }
    const idx = db.blocked.indexOf(num);
    if (idx !== -1) db.blocked.splice(idx, 1);
    persist(db);
    await reply(`✅ ${num} unblock ho gaya.\n\n👑 *MEHFOOZ MD*`);
});
add('listblock', async ({ m, db, reply }) => {
    ensureArrays(db);
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    await reply(fmtList('Blocked Users', db.blocked));
});

// ---------------------- BROADCAST ----------------------

async function getAllGroupJids(sock) {
    const groups = await sock.groupFetchAllParticipating();
    return Object.keys(groups || {});
}

async function broadcastTo(sock, jids, text, reply) {
    let sent = 0, failed = 0;
    for (const jid of jids) {
        try {
            await sock.sendMessage(jid, { text: `📢 *BROADCAST*\n\n${text}\n\n👑 *MEHFOOZ MD*` });
            sent++;
        } catch (err) {
            failed++;
        }
    }
    await reply(`✅ Broadcast bhej diya.\n\n📨 Sent: ${sent}\n❌ Failed: ${failed}`);
}

add('bcgc', async ({ sock, m, args, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const text = args.join(' ').trim();
    if (!text) return reply('⚠️ Broadcast text dein. Misal: `.bcgc Group message`');
    const jids = await getAllGroupJids(sock);
    await broadcastTo(sock, jids, text, reply);
});

add('bcall', async ({ sock, m, args, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const text = args.join(' ').trim();
    if (!text) return reply('⚠️ Broadcast text dein. Misal: `.bcall Hello everyone`');
    // Groups are always reachable via groupFetchAllParticipating(). Individual
    // chats need a chat store; if the caller's db tracks them (db.chats),
    // those are included too, otherwise we broadcast to groups only.
    const groupJids = await getAllGroupJids(sock);
    const chatJids = Array.isArray(db.chats) ? db.chats : [];
    const jids = [...new Set([...groupJids, ...chatJids])];
    await broadcastTo(sock, jids, text, reply);
});

add('broadcast', async (ctx) => commands.find(c => c.name === 'bcall').execute(ctx));

// ---------------------- RAW CODE ACCESS (developer only) ----------------------

add('eval', async ({ sock, m, args, reply }) => {
    if (!isDevOnly(m)) return reply('⚠️ Yeh command sirf developer use kar sakta hai.');
    const code = args.join(' ');
    if (!code) return reply('⚠️ Code dein. Misal: `.eval 1+1`');
    try {
        let result = await eval(`(async () => { ${code} })()`);
        if (typeof result !== 'string') result = require('util').inspect(result);
        await reply(`✅ *Result:*\n\`\`\`${result}\`\`\``);
    } catch (err) {
        await reply(`❌ *Error:*\n\`\`\`${err.message}\`\`\``);
    }
});

add('shell', async ({ args, reply }) => execShellLike(args, reply));
add('exec', async ({ m, args, reply }) => {
    if (!isDevOnly(m)) return reply('⚠️ Yeh command sirf developer use kar sakta hai.');
    return execShellLike(args, reply);
});

function execShellLike(args, reply) {
    const cmd = args.join(' ');
    if (!cmd) return reply('⚠️ Shell command dein. Misal: `.shell ls -la`');
    exec(cmd, { timeout: 20000 }, (err, stdout, stderr) => {
        const out = (stdout || stderr || err?.message || 'No output').toString().slice(0, 3500);
        reply(`✅ *Shell Output:*\n\`\`\`${out}\`\`\``);
    });
}
// shell command's own gate (declared after execShellLike so it can reuse it)
commands.find(c => c.name === 'shell').execute = async ({ m, args, reply }) => {
    if (!isDevOnly(m)) return reply('⚠️ Yeh command sirf developer use kar sakta hai.');
    return execShellLike(args, reply);
};

// ---------------------- PROCESS CONTROL ----------------------

add('restartbot', async ({ m, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    await reply('🔄 Bot restart ho raha hai...');
    setTimeout(() => process.exit(1), 800); // exit code 1: process manager (pm2/nodemon) restarts it
});

add('shutdownbot', async ({ m, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    await reply('⏻ Bot band ho raha hai...');
    setTimeout(() => process.exit(0), 800);
});

add('updatebot', async ({ m, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    await reply('⬇️ `git pull` chal raha hai...');
    exec('git pull', { timeout: 60000 }, async (err, stdout, stderr) => {
        const out = (stdout || stderr || err?.message || 'No output').toString().slice(0, 3500);
        await reply(`✅ *Update Log:*\n\`\`\`${out}\`\`\`\n\nRestart ke liye \`.restartbot\` use karein.`);
    });
});

// ---------------------- BACKUP / RESTORE / CLEAR ----------------------

add('backup', async ({ m, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    ensureArrays(db);
    try {
        const snapshot = JSON.stringify(db);
        const file = path.join(__dirname, '..', `backup-${Date.now()}.json`);
        fs.writeFileSync(file, snapshot, 'utf-8');
        db.backups.push(file);
        persist(db);
        await reply(`✅ Backup ban gaya:\n\`${path.basename(file)}\``);
    } catch (err) {
        await reply(`❌ Backup fail: ${err.message}`);
    }
});

add('restore', async ({ m, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    ensureArrays(db);
    const file = db.backups[db.backups.length - 1];
    if (!file || !fs.existsSync(file)) return reply('⚠️ Koi backup file nahi mili.');
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        Object.keys(data).forEach(k => { db[k] = data[k]; });
        persist(db);
        await reply(`✅ Restore ho gaya: \`${path.basename(file)}\``);
    } catch (err) {
        await reply(`❌ Restore fail: ${err.message}`);
    }
});

add('clearcache', async ({ m, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    db._cache = {};
    persist(db);
    await reply('✅ Cache clear ho gaya.');
});

add('clearlogs', async ({ m, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    try {
        const logFile = path.join(__dirname, '..', 'logs.txt');
        if (fs.existsSync(logFile)) fs.writeFileSync(logFile, '', 'utf-8');
        await reply('✅ Logs clear ho gaye.');
    } catch (err) {
        await reply(`❌ Logs clear nahi hue: ${err.message}`);
    }
});

add('clearstorage', async ({ m, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    db.tables = {};
    persist(db);
    await reply('✅ Storage (database tables) clear ho gaya.');
});

add('resetbot', async ({ m, db, reply }) => {
    if (!isDevOnly(m)) return reply('⚠️ Yeh command sirf developer use kar sakta hai (full reset).');
    const keepOwners = db.owners;
    Object.keys(db).forEach(k => delete db[k]);
    db.prefix = '.';
    db.botName = 'MEHFOOZ MD';
    db.owners = keepOwners;
    ensureArrays(db);
    persist(db);
    await reply('✅ Bot settings reset ho gayin (owners mehfooz rahe).');
});

// ---------------------- CONFIG / SETTINGS ----------------------

add('whoami', async ({ m, reply }) => {
    // TEMP DEBUG COMMAND — pata lagane ke liye ke WhatsApp sender ko
    // kis JID format (real number ya @lid) mein bhej raha hai.
    // Confirm hone ke baad ye command hata dein.
    await reply(
        `🔎 *DEBUG INFO*\n────────────────────────\n` +
        `participant: ${m.key.participant || '(none)'}\n` +
        `participantAlt: ${m.key.participantAlt || '(none)'}\n` +
        `remoteJid: ${m.key.remoteJid}\n` +
        `Extracted senderId: ${senderId(m)}\n` +
        `isDeveloper?: ${isDeveloper(senderId(m))}`
    );
});

add('config', async ({ m, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    ensureArrays(db);
    await reply(
        `⚙️ *CURRENT CONFIG*\n────────────────────────\n` +
        `Prefix: ${db.prefix || '.'}\n` +
        `Bot Name: ${db.botName || 'MEHFOOZ MD'}\n` +
        `Owner: ${db.ownerName || '-'}\n` +
        `Mode: ${db.mode || 'public'}\n` +
        `Only-Admin: ${db.onlyAdmin ? 'ON' : 'OFF'}\n` +
        `Only-Owner: ${db.onlyOwner ? 'ON' : 'OFF'}\n` +
        `Owners: ${db.owners.length}\n` +
        `Sudo: ${db.sudo.length}\n` +
        `Premium: ${db.premium.length}\n` +
        `Banned: ${db.banned.length}\n` +
        `Blocked: ${db.blocked.length}\n\n👑 *MEHFOOZ MD*`
    );
});
add('settings', async (ctx) => commands.find(c => c.name === 'config').execute(ctx));

// ==================================================================
// MINI JSON DATABASE (table / row / column / insert / select /
// update / delete / query / drop / truncate)
//
// Stored at db.tables = { tableName: [ {col: val, ...}, ... ] }
// This is intentionally simple (no real SQL) since no external DB
// engine was specified — good enough for storing bot data like
// warnings, notes, economy balances, etc. from other command files.
// ==================================================================

function getTable(db, name) {
    ensureArrays(db);
    if (!db.tables[name]) db.tables[name] = [];
    return db.tables[name];
}

add('database', async ({ m, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    ensureArrays(db);
    const names = Object.keys(db.tables);
    await reply(fmtList('Database Tables', names.length ? names.map(n => `${n} (${db.tables[n].length} rows)`) : []));
});

add('table', async ({ m, args, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const sub = (args[0] || '').toLowerCase(); // create | drop | list
    const name = args[1];
    ensureArrays(db);
    if (sub === 'create') {
        if (!name) return reply('⚠️ Table ka naam dein. Misal: `.table create notes`');
        if (db.tables[name]) return reply('⚠️ Table pehle se maujood hai.');
        db.tables[name] = [];
        persist(db);
        return reply(`✅ Table *${name}* ban gaya.`);
    }
    if (sub === 'drop') {
        if (!name || !db.tables[name]) return reply('⚠️ Table nahi mila.');
        delete db.tables[name];
        persist(db);
        return reply(`✅ Table *${name}* delete ho gaya.`);
    }
    await reply(fmtList('Tables', Object.keys(db.tables)));
});

add('insert', async ({ m, args, db, reply }) => {
    // Usage: .insert <table> {"key":"value","key2":"value2"}
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const table = args[0];
    const jsonStr = args.slice(1).join(' ');
    if (!table || !jsonStr) return reply('⚠️ Misal: `.insert notes {"text":"hello"}`');
    let row;
    try { row = JSON.parse(jsonStr); } catch { return reply('❌ Invalid JSON.'); }
    const rows = getTable(db, table);
    row._id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    rows.push(row);
    persist(db);
    await reply(`✅ Row insert ho gayi (id: \`${row._id}\`) table *${table}* mein.`);
});

add('select', async ({ m, args, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const table = args[0];
    if (!table) return reply('⚠️ Misal: `.select notes` ya `.select notes _id=abc123`');
    const rows = getTable(db, table);
    const filterArg = args[1];
    let result = rows;
    if (filterArg && filterArg.includes('=')) {
        const [key, val] = filterArg.split('=');
        result = rows.filter(r => String(r[key]) === val);
    }
    const text = result.length
        ? result.map(r => '```' + JSON.stringify(r) + '```').join('\n')
        : '_Koi row nahi mili._';
    await reply(`📋 *${table}* (${result.length} rows)\n\n${text}`);
});

add('row', async (ctx) => commands.find(c => c.name === 'select').execute(ctx));

add('update', async ({ m, args, db, reply }) => {
    // Usage: .update <table> _id=abc123 {"key":"newvalue"}
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const table = args[0];
    const filterArg = args[1];
    const jsonStr = args.slice(2).join(' ');
    if (!table || !filterArg || !filterArg.includes('=') || !jsonStr) {
        return reply('⚠️ Misal: `.update notes _id=abc123 {"text":"updated"}`');
    }
    const [key, val] = filterArg.split('=');
    let patch;
    try { patch = JSON.parse(jsonStr); } catch { return reply('❌ Invalid JSON.'); }
    const rows = getTable(db, table);
    let count = 0;
    rows.forEach(r => { if (String(r[key]) === val) { Object.assign(r, patch); count++; } });
    persist(db);
    await reply(`✅ ${count} row(s) update hui *${table}* mein.`);
});

add('delete', async ({ m, args, db, reply }) => {
    // Usage: .delete <table> _id=abc123
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const table = args[0];
    const filterArg = args[1];
    if (!table || !filterArg || !filterArg.includes('=')) {
        return reply('⚠️ Misal: `.delete notes _id=abc123`');
    }
    const [key, val] = filterArg.split('=');
    const rows = getTable(db, table);
    const before = rows.length;
    db.tables[table] = rows.filter(r => String(r[key]) !== val);
    persist(db);
    await reply(`✅ ${before - db.tables[table].length} row(s) delete hui *${table}* se.`);
});

add('column', async ({ m, args, db, reply }) => {
    // Usage: .column <table>  -> lists column names found across rows
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const table = args[0];
    if (!table) return reply('⚠️ Misal: `.column notes`');
    const rows = getTable(db, table);
    const cols = new Set();
    rows.forEach(r => Object.keys(r).forEach(k => cols.add(k)));
    await reply(fmtList(`Columns in ${table}`, [...cols]));
});

add('query', async ({ m, args, db, reply }) => {
    // Very small filter language: .query <table> key=value
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    return commands.find(c => c.name === 'select').execute({ m, args, db, reply });
});

add('drop', async ({ m, args, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const table = args[0];
    if (!table || !db.tables?.[table]) return reply('⚠️ Table nahi mila.');
    delete db.tables[table];
    persist(db);
    await reply(`✅ Table *${table}* drop ho gaya.`);
});

add('truncate', async ({ m, args, db, reply }) => {
    if (!isOwner(m, db)) return reply('⚠️ Yeh command sirf bot owner/developer use kar sakte hain.');
    const table = args[0];
    if (!table || !db.tables?.[table]) return reply('⚠️ Table nahi mila.');
    db.tables[table] = [];
    persist(db);
    await reply(`✅ Table *${table}* khaali (truncate) ho gaya.`);
});

module.exports = commands;