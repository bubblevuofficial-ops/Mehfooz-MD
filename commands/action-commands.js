'use strict';

/*
|--------------------------------------------------------------------------
| MEHFOOZ MD - ACTIONS & SOCIAL  (commands/action-commands.js)
|--------------------------------------------------------------------------
| Menu ki saari 55 commands yahan REAL logic ke saath hain.
| Koi npm package ya internet API nahi chahiye.
|
| Kis command ka kya kaam hai  ->  file ke aakhir mein HELP list dekhein.
| Data (score, likes, follow, topics ...) yahan save hota hai:
|   <handler folder>/data/actions/<bot-number>.json   (har bot number ka alag)
|
| Format: array of { name, execute({ sock, m, args, reply, prefix,
|                                     privileged, reloadCommands }) }
|--------------------------------------------------------------------------
*/

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- helpers
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const cleanNum = (j = '') => String(j).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
const toJid = (j = '') => {
    const s = String(j); if (!s.includes('@')) return cleanNum(s) + '@s.whatsapp.net';
    const [u, d] = s.split('@'); return u.split(':')[0] + '@' + d;
};
const tag = (jid) => '@' + cleanNum(jid);

// ---- persistent store (per bot number)
const STORE_DIR = path.join(__dirname, '..', 'data', 'actions');
const stores = new Map();
function getStore(sock) {
    const key = cleanNum(sock?.user?.id) || 'default';
    if (stores.has(key)) return stores.get(key);
    let d = {};
    try { d = JSON.parse(fs.readFileSync(path.join(STORE_DIR, key + '.json'), 'utf8')) || {}; } catch {}
    d.users = d.users || {}; d.topics = d.topics || {}; d.flags = d.flags || []; d.cool = d.cool || {};
    const st = { key, d };
    stores.set(key, st);
    return st;
}
function save(st) {
    try {
        fs.mkdirSync(STORE_DIR, { recursive: true });
        fs.writeFileSync(path.join(STORE_DIR, st.key + '.json'), JSON.stringify(st.d), 'utf8');
    } catch (e) { console.error('[MEHFOOZ MD] actions save fail:', e.message); }
}
const user = (st, num) => (st.d.users[num] = Object.assign(
    { score: 0, level: 1, rank: 0, wins: 0, losses: 0, rep: 0, following: [], gameAt: 0 }, st.d.users[num] || {}));

// ---- in-memory state
const stopwatches = new Map();   // "chat:num" -> {start, acc, running, laps}
const pending = new Map();       // "chat:num" -> {label, run, exp}

const RANKS = ['Bronze 🥉', 'Silver 🥈', 'Gold 🥇', 'Platinum 💠', 'Diamond 💎', 'Legend 👑'];

function fmtTime(ms) {
    const t = Math.floor(ms / 100) / 10, h = Math.floor(t / 3600), mi = Math.floor((t % 3600) / 60), s = (t % 60).toFixed(1);
    return `${h ? h + ':' : ''}${String(mi).padStart(2, '0')}:${s.padStart(4, '0')}`;
}
const bar10 = (p) => '▰'.repeat(Math.round(p * 10)) + '▱'.repeat(10 - Math.round(p * 10));
const fmtUptime = (sec) => { sec = Math.floor(sec); return `${Math.floor(sec / 3600)}h ${Math.floor(sec % 3600 / 60)}m ${sec % 60}s`; };

// ---- sending
async function say(sock, m, text, mentions = []) {
    return sock.sendMessage(m.key.remoteJid, { text, mentions }, { quoted: m });
}
async function animate(sock, m, frames, mentions = [], delay = 750) {
    let sent = await say(sock, m, frames[0], mentions);
    for (let i = 1; i < frames.length; i++) {
        await sleep(delay);
        try {
            if (!sent?.key) throw new Error('no key');
            await sock.sendMessage(m.key.remoteJid, { text: frames[i], mentions, edit: sent.key });
        } catch {                       // edit support nahi -> aakhri frame naya message
            if (i < frames.length - 1) continue;
            await say(sock, m, frames[i], mentions);
        }
    }
}

// ---- group helpers
async function adminInfo(sock, m, privileged) {
    const chat = m.key.remoteJid;
    if (!chat.endsWith('@g.us')) return { group: false };
    const meta = await sock.groupMetadata(chat);
    const numsOf = (p) => [p.id, p.jid, p.phoneNumber, p.lid].filter(Boolean).map(cleanNum);
    const admins = meta.participants.filter(p => p.admin).flatMap(numsOf);
    const bots = [cleanNum(sock.user?.id), cleanNum(sock.user?.lid)].filter(Boolean);
    const senders = [m.key.participant, m.key.participantAlt].filter(Boolean).map(cleanNum);
    return {
        group: true, meta,
        botAdmin: bots.some(b => admins.includes(b)),
        senderAdmin: !!privileged || m.key.fromMe || senders.some(s => admins.includes(s))
    };
}

// ------------------------------------------------------------------ ROLEPLAY
const ROLE = {
    cry:   { e: '😭', solo: ['{a} zaar-o-qatar ro raha hai 😭💧', '{a} ki aankhon se dariya beh nikla 😭', '{a} ne rumaal ka poora packet khatam kar diya 🥲'], tgt: ['{a} {t} ke kandhe par sar rakh kar ro raha hai 😭', '{a} ne {t} ko dekh kar rona shuru kar diya 🥹'] },
    dance: { e: '💃', solo: ['{a} ne kamaal ka dance shuru kar diya 💃🕺', '{a} floor par aag laga raha hai 🔥💃', '{a} ka dance dekh kar sab hairan hain 😲🕺'], tgt: ['{a} aur {t} ka jodi-dar dance chal raha hai 💃🕺', '{a} ne {t} ko dance ke liye bulaya 🎶'] },
    laugh: { e: '😂', solo: ['{a} hans hans kar lot-pot ho gaya 😂', '{a} ki hansi ruk hi nahi rahi 🤣', '{a} itna hansa ke pet mein dard ho gaya 😆'], tgt: ['{a} {t} ko dekh kar hans pada 🤣', '{a} {t} ki baat par hansi se lot-pot 😂'] },
    sleep: { e: '😴', solo: ['{a} gehri neend mein so gaya 😴💤', '{a} ne khurrate lene shuru kar diye 😪💤', '{a} sapno ki duniya mein chala gaya 🌙💤'], tgt: ['{a} ne {t} ko lori suna kar sula diya 😴🎶', '{a} {t} ke saath so gaya 😴💤'] },
    eat:   { e: '🍽️', solo: ['{a} ne {f} kha liya 😋', '{a} maze se {f} kha raha hai 🤤', '{a} ne {f} ka poora plate saaf kar diya 😋'], tgt: ['{a} ne {t} ko {f} khilaya 🍽️', '{a} ne {t} ke saath {f} share kiya 😋'], pool: ['biryani 🍛', 'pizza 🍕', 'burger 🍔', 'samosa 🥟', 'paratha 🫓', 'kebab 🍢', 'gulab jamun 🍮', 'pani puri 🥙'] },
    drink: { e: '🥤', solo: ['{a} ne {f} pi liya 😌', '{a} thanda {f} pee raha hai 🥶', '{a} ek hi ghont mein {f} ghata-ghat pi gaya 😮‍💨'], tgt: ['{a} ne {t} ko {f} pilaya 🥤', '{a} aur {t} ne saath mein {f} piya 🤝'], pool: ['chai ☕', 'lassi 🥛', 'cold drink 🥤', 'sharbat 🍹', 'coffee ☕', 'juice 🧃', 'doodh 🥛', 'nimbu pani 🍋'] },
    sing:  { e: '🎤', solo: ['🎶 {a} ne mic pakda: "la la la, dil ka sur, chalo gaayein door door" 🎤', '🎶 {a}: "sur mila, taal mila, mehfil ban gayi kamaal" 🎤', '🎶 {a}: "aaj mausam hai suhana, gungunao tum bhi zara" 🎤'], tgt: ['🎶 {a} ne {t} ke liye gaana gaaya: "tere naam ka sur lagaya" 🎤'] }
};

const SCENE = {
    run:  { e: '🏃', trail: '💨', lines: ['{a} ne race jeet li 🏁', '{a} bijli ki raftaar se bhaga ⚡'], tgt: ['{a} ne {t} ko race mein peeche chhod diya 🏁'] },
    jump: { e: '🦘', trail: '⬆️', lines: ['{a} ne oonchi chhalaang laga di 🦘', '{a} bandar ki tarah kood gaya 🐒'], tgt: ['{a} {t} ke upar se kood gaya 🦘'] },
    fly:  { e: '🕊️', trail: '☁️', lines: ['{a} aasman mein udd gaya 🕊️', '{a} badalon ke upar pahunch gaya ☁️✨'], tgt: ['{a} ne {t} ko saath udaya 🕊️☁️'] },
    swim: { e: '🏊', trail: '🌊', lines: ['{a} samundar paar kar gaya 🏊🌊', '{a} machhli ki tarah tair raha hai 🐟'], tgt: ['{a} ne {t} ke saath tairayi ki 🏊🌊'] }
};

const WORK = {
    clean:   { icon: '🧹', label: 'Safai', done: ['{a} ne {f} chamka diya ✨', '{a} ne {f} ki poori safai kar di 🧼'], pool: ['ghar', 'kamra', 'group', 'gaadi', 'chhat'] },
    wash:    { icon: '🧼', label: 'Dhulai', done: ['{a} ne {f} dho kar saaf kar diya 🫧', '{a} ne {f} ki dhulai poori kar di 💦'], pool: ['kapde', 'gaadi', 'bartan', 'haath', 'joote'] },
    fix:     { icon: '🔧', label: 'Repair', done: ['{a} ne {f} theek kar diya 🔧✅', '{a} ne {f} ko naye jaisa bana diya 🛠️'], pool: ['phone', 'laptop', 'bike', 'nal', 'wifi'] },
    build:   { icon: '🏗️', label: 'Construction', done: ['{a} ne {f} bana diya 🏗️✅', '{a} ne {f} khada kar diya 🧱'], pool: ['ghar', 'mahal', 'pul', 'kila', 'mandir', 'robot'] },
    cook:    { icon: '🍳', label: 'Cooking', done: ['{a} ne {f} pakaya, khushboo se pura ghar mehak gaya 😋', '{a} ka banaya {f} taiyar hai 🍽️'], pool: ['biryani 🍛', 'karahi 🍲', 'daal chawal 🍚', 'pulao 🍛', 'halwa 🍮'] },
    bake:    { icon: '🧁', label: 'Baking', done: ['{a} ne {f} bake kar liya 🥳', '{a} ka {f} oven se nikal aaya 🔥'], pool: ['chocolate cake 🎂', 'cupcakes 🧁', 'cookies 🍪', 'brownie 🍫', 'bread 🍞'] }
};

async function roleplay(c, name) {
    const { sock, m, target, me } = c;
    const tgtTxt = target ? tag(target) : null;
    const mentions = [me, target].filter(Boolean);
    const fill = (s, f) => s.replace('{a}', tag(me)).replace('{t}', tgtTxt || '').replace('{f}', f || '');

    if (ROLE[name]) {
        const r = ROLE[name], f = r.pool ? pick(r.pool) : '';
        const line = (target && r.tgt) ? pick(r.tgt) : pick(r.solo);
        return say(sock, m, `${r.e} ${fill(line, f)}`, mentions);
    }
    if (SCENE[name]) {
        const s = SCENE[name], frames = [];
        for (let i = 0; i < 5; i++) frames.push('·'.repeat(i * 2) + s.e + s.trail + '·'.repeat((4 - i) * 2));
        frames.push(fill(pick(target ? s.tgt : s.lines), ''));
        return animate(sock, m, frames, mentions, 600);
    }
    if (WORK[name]) {
        const w = WORK[name], f = pick(w.pool), frames = [];
        for (let i = 1; i <= 5; i++) frames.push(`${w.icon} ${w.label}... ${'▰'.repeat(i)}${'▱'.repeat(5 - i)} ${i * 20}%`);
        frames.push(fill(pick(w.done), f));
        return animate(sock, m, frames, mentions, 650);
    }
    if (name === 'destroy') {
        const who = tgtTxt || 'sab kuch';
        const frames = ['💣 3...', '💣 2...', '💣 1...', `💥 BOOM! ${tag(me)} ne ${who} ko destroy kar diya 🔥`];
        return animate(sock, m, frames, mentions, 800);
    }
}

// ------------------------------------------------------------------ ART
const ART = {
    heart:   [' ♥♥   ♥♥ ', '♥♥♥♥ ♥♥♥♥', '♥♥♥♥♥♥♥♥♥', ' ♥♥♥♥♥♥♥ ', '  ♥♥♥♥♥  ', '   ♥♥♥   ', '    ♥    '],
    star:    ['    *    ', '   ***   ', '*********', ' ******* ', '  *****  ', ' ***_*** ', '**     **'],
    house:   ['    /\\    ', '   /  \\   ', '  /____\\  ', '  | [] |  ', '  |    |  ', '  |_||_|  '],
    smile:   ['  .-"""-.  ', ' /  o o  \\ ', '|    ^    |', ' \\  \\_/  / ', "  '-...-'  "],
    cat:     [' /\\_/\\ ', '( o.o )', ' > ^ < ', '/|   |\\', '(_|_|_)'],
    tree:    ['    ^    ', '   ^^^   ', '  ^^^^^  ', ' ^^^^^^^ ', '^^^^^^^^^', '   |||   ', '   |||   '],
    diamond: ['   /\\   ', '  /  \\  ', ' /    \\ ', ' \\    / ', '  \\  /  ', '   \\/   '],
    arrow:   ['    /\\    ', '   /  \\   ', '  / || \\  ', '    ||    ', '    ||    ', '    ||    '],
    sun:     ['  \\ | /  ', '   .-.   ', '-- (   ) --', "   '-'   ", '  / | \\  '],
    fish:    ['   ><(((º>', '  ><(((º> ', ' ><(((º>  ']
};

// ------------------------------------------------------------------ HANDLERS
const H = {};
for (const n of [...Object.keys(ROLE), ...Object.keys(SCENE), ...Object.keys(WORK), 'destroy']) H[n] = (c) => roleplay(c, n);

H.write = async (c) => {
    const t = c.text || c.quotedText;
    if (!t) return c.usage('write', 'Salam dosto');
    const src = t.slice(0, 200), script = require('./text-commands').STYLES.fancytext;
    const frames = []; const step = Math.max(1, Math.ceil(src.length / 5));
    for (let i = step; i < src.length; i += step) frames.push('✍️ ' + script(src.slice(0, i)) + ' ▌');
    frames.push('✍️ ' + script(src));
    return animate(c.sock, c.m, frames, [], 600);
};

H.read = async (c) => {
    const t = c.text || c.quotedText;
    if (!t) return c.usage('read', 'koi lamba text') + '\n(ya kisi message ko reply karke .read)';
    const words = t.split(/\s+/).filter(Boolean).length, sentences = (t.match(/[.!?۔।]+/g) || []).length || 1;
    const mins = words / 200, secs = Math.max(1, Math.round(mins * 60));
    return c.say(`📖 *Read Report*\n\n📝 Words: ${words}\n🔤 Characters: ${t.length}\n📄 Sentences: ${sentences}\n⏱️ Padhne mein: ~${secs >= 60 ? Math.floor(secs / 60) + ' min ' + (secs % 60) + ' sec' : secs + ' sec'}`);
};

H.draw = async (c) => {
    const name = (c.args[0] || '').toLowerCase();
    const key = ART[name] ? name : (name ? null : pick(Object.keys(ART)));
    if (!key) return c.say(`⚠️ Aisi drawing nahi hai.\n🎨 Available: ${Object.keys(ART).join(', ')}\nExample: ${c.prefix}draw heart`);
    return c.say('```' + ART[key].join('\n') + '```\n🎨 ' + key);
};

H.paint = async (c) => {
    let pal = [...c.args.join('')].filter(ch => ch.codePointAt(0) > 0x2000);
    if (pal.length < 2) pal = ['🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜'];
    const rows = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => pick(pal)).join(''));
    return c.say('🎨 *Paint*\n\n' + rows.join('\n'));
};

// ---- stopwatch: start / pause / resume / record / stop
const swKey = (c) => `${c.chat}:${c.meNum}`;
H.start = async (c) => {
    const k = swKey(c), s = stopwatches.get(k);
    if (s) return c.say(s.running ? '⏱️ Stopwatch pehle se chal raha hai.' : `⏸️ Stopwatch paused hai. ${c.prefix}resume likhein.`);
    stopwatches.set(k, { start: Date.now(), acc: 0, running: true, laps: [] });
    return c.say(`▶️ Stopwatch shuru!\n${c.prefix}pause • ${c.prefix}resume • ${c.prefix}record (lap) • ${c.prefix}stop`);
};
const elapsed = (s) => s.acc + (s.running ? Date.now() - s.start : 0);
H.pause = async (c) => {
    const s = stopwatches.get(swKey(c));
    if (!s) return c.say(`⚠️ Pehle ${c.prefix}start likhein.`);
    if (!s.running) return c.say('⏸️ Stopwatch pehle se paused hai.');
    s.acc += Date.now() - s.start; s.running = false;
    return c.say(`⏸️ Paused at *${fmtTime(s.acc)}*`);
};
H.resume = async (c) => {
    const s = stopwatches.get(swKey(c));
    if (!s) return c.say(`⚠️ Pehle ${c.prefix}start likhein.`);
    if (s.running) return c.say('▶️ Stopwatch chal hi raha hai.');
    s.start = Date.now(); s.running = true;
    return c.say(`▶️ Resume! Ab tak: *${fmtTime(s.acc)}*`);
};
H.record = async (c) => {
    const s = stopwatches.get(swKey(c));
    if (!s) return c.say(`⚠️ Pehle ${c.prefix}start likhein.`);
    const t = elapsed(s), prev = s.laps.length ? s.laps[s.laps.length - 1] : 0;
    s.laps.push(t);
    return c.say(`🏁 Lap ${s.laps.length}: *${fmtTime(t)}*  (+${fmtTime(t - prev)})`);
};
H.stop = async (c) => {
    const k = swKey(c), s = stopwatches.get(k);
    if (!s) return c.say(`⚠️ Koi stopwatch nahi chal raha. ${c.prefix}start likhein.`);
    const t = elapsed(s); stopwatches.delete(k);
    const laps = s.laps.length ? '\n\n' + s.laps.map((l, i) => `Lap ${i + 1}: ${fmtTime(l)}`).join('\n') : '';
    return c.say(`⏹️ Stopwatch band.\n⏱️ Total: *${fmtTime(t)}*${laps}`);
};

// ---- topics + voting: create / find / agree / disagree / cancel <id>
const topicsOf = (c) => (c.st.d.topics[c.chat] = c.st.d.topics[c.chat] || { next: 1, list: [] });
H.create = async (c) => {
    if (!c.text) return c.usage('create', 'Kya hum picnic par chalein?');
    const t = topicsOf(c), item = { id: t.next++, text: c.text.slice(0, 200), by: c.meNum, agree: [], disagree: [], ts: Date.now() };
    t.list.push(item); if (t.list.length > 100) t.list.shift(); save(c.st);
    return c.say(`🗳️ *Topic #${item.id} ban gaya*\n${item.text}\n\n✅ ${c.prefix}agree   ❌ ${c.prefix}disagree`);
};
const tally = (it) => {
    const a = it.agree.length, d = it.disagree.length, tot = a + d || 1;
    return `🗳️ *Topic #${it.id}:* ${it.text}\n\n✅ Agree: ${a}  ${bar10(a / tot)}\n❌ Disagree: ${d}  ${bar10(d / tot)}`;
};
const vote = async (c, side) => {
    const t = topicsOf(c); if (!t.list.length) return c.say(`⚠️ Koi topic nahi. Pehle ${c.prefix}create <baat> likhein.`);
    const id = parseInt(c.args[0]); const it = isNaN(id) ? t.list[t.list.length - 1] : t.list.find(x => x.id === id);
    if (!it) return c.say('⚠️ Yeh topic number nahi mila.');
    const other = side === 'agree' ? 'disagree' : 'agree';
    it[other] = it[other].filter(x => x !== c.meNum);
    if (!it[side].includes(c.meNum)) it[side].push(c.meNum);
    save(c.st);
    return c.say(tally(it));
};
H.agree = (c) => vote(c, 'agree');
H.disagree = (c) => vote(c, 'disagree');
H.find = async (c) => {
    const t = topicsOf(c), kw = c.text.toLowerCase();
    const res = (kw ? t.list.filter(x => x.text.toLowerCase().includes(kw)) : t.list).slice(-8).reverse();
    if (!res.length) return c.say(kw ? `🔍 "${c.text}" se koi topic nahi mila.` : `🔍 Abhi koi topic nahi. ${c.prefix}create likhein.`);
    return c.say('🔍 *Topics*\n\n' + res.map(x => `#${x.id}  ${x.text}  (✅${x.agree.length} ❌${x.disagree.length})`).join('\n'));
};

// ---- confirm / cancel (pending actions)
const askConfirm = (c, label, run) => {
    pending.set(`${c.chat}:${c.meNum}`, { label, run, exp: Date.now() + 60000 });
    return c.say(`⚠️ *${label}*\nPakka? 60 second mein ${c.prefix}confirm likhein, ya ${c.prefix}cancel.`);
};
H.confirm = async (c) => {
    const k = `${c.chat}:${c.meNum}`, p = pending.get(k);
    if (!p || p.exp < Date.now()) { pending.delete(k); return c.say('ℹ️ Koi pending action nahi hai.'); }
    pending.delete(k);
    return p.run();
};
H.cancel = async (c) => {
    const k = `${c.chat}:${c.meNum}`, id = parseInt(c.args[0]);
    if (!isNaN(id)) {                                   // .cancel 3  -> topic #3 delete
        const t = topicsOf(c), i = t.list.findIndex(x => x.id === id);
        if (i < 0) return c.say('⚠️ Yeh topic number nahi mila.');
        if (t.list[i].by !== c.meNum && !c.privileged) return c.say('⚠️ Topic sirf ban-ne wala (ya owner) cancel kar sakta hai.');
        t.list.splice(i, 1); save(c.st); return c.say(`🗑️ Topic #${id} cancel ho gaya.`);
    }
    if (pending.delete(k)) return c.say('❌ Pending action cancel kar diya.');
    return c.say('ℹ️ Cancel karne ke liye kuch nahi hai.');
};

// ---- social: like / dislike / follow / unfollow / flag
const needTarget = (c, cmd) => c.target ? null : c.say(`⚠️ Kisi ko mention ya reply karein.\nExample: ${c.prefix}${cmd} @user`);
async function rep(c, delta, cmd) {
    const bad = needTarget(c, cmd); if (bad) return bad;
    const tn = cleanNum(c.target);
    if (tn === c.meNum) return c.say('😅 Apne aap ko nahi kar sakte.');
    const ck = `${cmd}:${c.meNum}:${tn}`, last = c.st.d.cool[ck] || 0;
    if (Date.now() - last < 6 * 3600 * 1000) return c.say('⏳ Aap is user ko 6 ghante mein sirf ek baar yeh kar sakte hain.');
    c.st.d.cool[ck] = Date.now();
    const u = user(c.st, tn); u.rep += delta; c.st.d.users[tn] = u; save(c.st);
    return say(c.sock, c.m, `${delta > 0 ? '👍' : '👎'} ${tag(c.me)} ne ${tag(c.target)} ko ${delta > 0 ? 'like' : 'dislike'} kiya.\n⭐ Reputation: *${u.rep}*`, [c.me, c.target]);
}
H.like = (c) => rep(c, +1, 'like');
H.dislike = (c) => rep(c, -1, 'dislike');
const followers = (st, num) => Object.values(st.d.users).filter(u => (u.following || []).includes(num)).length;
H.follow = async (c) => {
    const bad = needTarget(c, 'follow'); if (bad) return bad;
    const tn = cleanNum(c.target); if (tn === c.meNum) return c.say('😅 Khud ko follow nahi kar sakte.');
    const u = user(c.st, c.meNum); c.st.d.users[c.meNum] = u;
    if (u.following.includes(tn)) return c.say('ℹ️ Aap pehle se follow kar rahe hain.');
    u.following.push(tn); save(c.st);
    return say(c.sock, c.m, `➕ ${tag(c.me)} ne ${tag(c.target)} ko follow kiya.\n👥 Followers: *${followers(c.st, tn)}*`, [c.me, c.target]);
};
H.unfollow = async (c) => {
    const bad = needTarget(c, 'unfollow'); if (bad) return bad;
    const tn = cleanNum(c.target), u = user(c.st, c.meNum); c.st.d.users[c.meNum] = u;
    if (!u.following.includes(tn)) return c.say('ℹ️ Aap isay follow nahi kar rahe the.');
    u.following = u.following.filter(x => x !== tn); save(c.st);
    return say(c.sock, c.m, `➖ ${tag(c.me)} ne ${tag(c.target)} ko unfollow kiya.\n👥 Followers: *${followers(c.st, tn)}*`, [c.me, c.target]);
};
H.flag = async (c) => {
    if (!c.target && !c.quotedText) return c.say(`⚠️ Jis message/user ko flag karna hai usay reply karein.\nExample: reply karke ${c.prefix}flag spam`);
    const rec = { by: c.meNum, target: c.target ? cleanNum(c.target) : '?', chat: c.chat, reason: c.text || 'no reason', text: (c.quotedText || '').slice(0, 300), ts: Date.now() };
    c.st.d.flags.push(rec); if (c.st.d.flags.length > 200) c.st.d.flags.shift(); save(c.st);
    try {   // bot ke apne number par report bhej do
        await c.sock.sendMessage(toJid(c.sock.user.id), { text: `🚩 *FLAG REPORT*\n\nChat: ${c.chat}\nBy: ${rec.by}\nTarget: ${rec.target}\nReason: ${rec.reason}\n\n${rec.text}` });
    } catch {}
    const cnt = c.st.d.flags.filter(f => f.target === rec.target).length;
    return c.say(`🚩 Flag ho gaya. Is user par ab tak *${cnt}* flag(s).`);
};

// ---- system: check / verify / refresh / reload / hide / show
H.check = async (c) => {
    const lat = Math.max(0, Date.now() - (Number(c.m.messageTimestamp) || 0) * 1000);
    const mem = Math.round(process.memoryUsage().rss / 1048576);
    return c.say(`✅ *Bot Status*\n\n🟢 Online\n⏱️ Uptime: ${fmtUptime(process.uptime())}\n📡 Latency: ~${lat > 60000 ? '-' : lat + ' ms'}\n💾 Memory: ${mem} MB\n🧩 Node: ${process.version}`);
};
H.verify = async (c) => {
    const num = cleanNum(c.args[0] || '') || cleanNum(c.target || '') || c.meNum;
    if (num.length < 7) return c.say(`⚠️ Poora number likhein (country code ke saath).\nExample: ${c.prefix}verify 923001234567`);
    try {
        const r = await c.sock.onWhatsApp(num + '@s.whatsapp.net');
        const hit = Array.isArray(r) ? r[0] : null;
        return c.say(hit?.exists ? `✅ +${num} WhatsApp par *maujood* hai.` : `❌ +${num} WhatsApp par *nahi* mila.`);
    } catch (e) { return c.say('❌ Verify nahi ho saka: ' + e.message); }
};
H.refresh = async (c) => {
    try { await c.sock.sendPresenceUpdate('available'); } catch {}
    if (c.chat.endsWith('@g.us')) {
        try {
            const meta = await c.sock.groupMetadata(c.chat);
            const adm = meta.participants.filter(p => p.admin).length;
            return c.say(`🔄 Refresh ho gaya.\n\n👥 ${meta.subject}\n👤 Members: ${meta.participants.length}\n👮 Admins: ${adm}`);
        } catch {}
    }
    return c.say('🔄 Refresh ho gaya. Bot online hai ✅');
};
H.reload = async (c) => {
    if (!c.privileged) return c.say('⚠️ Yeh command sirf bot owner ke liye hai.');
    if (typeof c.reloadCommands !== 'function') return c.say('⚠️ Reload is handler mein available nahi.');
    try { c.reloadCommands(); return c.say('♻️ Saari commands dobara load ho gayi ✅'); }
    catch (e) { return c.say('❌ Reload fail: ' + e.message); }
};
H.hide = async (c) => {
    if (!c.privileged) return c.say('⚠️ Yeh command sirf bot owner ke liye hai.');
    try { await c.sock.sendPresenceUpdate('unavailable'); } catch (e) { return c.say('❌ ' + e.message); }
    return c.say('🙈 Bot ab offline dikhega (hide).');
};
H.show = async (c) => {
    if (!c.privileged) return c.say('⚠️ Yeh command sirf bot owner ke liye hai.');
    try { await c.sock.sendPresenceUpdate('available'); } catch (e) { return c.say('❌ ' + e.message); }
    return c.say('👀 Bot ab online dikhega (show).');
};

// ---- group: open / close
async function groupSetting(c, mode) {
    let info; try { info = await adminInfo(c.sock, c.m, c.privileged); } catch (e) { return c.say('❌ Group info nahi mili: ' + e.message); }
    if (!info.group) return c.say('⚠️ Yeh command sirf group mein kaam karti hai.');
    if (!info.senderAdmin) return c.say('⚠️ Yeh command sirf group admins use kar sakte hain.');
    if (!info.botAdmin) return c.say('⚠️ Pehle bot ko group admin banayein.');
    try { await c.sock.groupSettingUpdate(c.chat, mode); } catch (e) { return c.say('❌ ' + e.message); }
    return c.say(mode === 'not_announcement' ? '🔓 Group *open* — ab sab message kar sakte hain.' : '🔒 Group *close* — ab sirf admins message kar sakte hain.');
}
H.open = (c) => groupSetting(c, 'not_announcement');
H.close = (c) => groupSetting(c, 'announcement');

// ---- bot power: exit / quit / logout  (owner only + confirm)
H.exit = async (c) => {
    if (!c.privileged) return c.say('⚠️ Yeh command sirf bot owner ke liye hai.');
    if (!c.chat.endsWith('@g.us')) return c.say('⚠️ Yeh command sirf group mein kaam karti hai.');
    return askConfirm(c, 'Bot is group se exit ho jayega', async () => {
        await c.say('👋 Allah Hafiz! Bot group chhod raha hai.');
        try { await c.sock.groupLeave(c.chat); } catch (e) { await c.say('❌ ' + e.message); }
    });
};
H.quit = async (c) => {
    if (!c.privileged) return c.say('⚠️ Yeh command sirf bot owner ke liye hai.');
    return askConfirm(c, 'Bot band (quit) ho jayega', async () => {
        await c.say('🛑 Bot band ho raha hai...'); await sleep(800); process.exit(0);
    });
};
H.logout = async (c) => {
    if (!c.privileged) return c.say('⚠️ Yeh command sirf bot owner ke liye hai.');
    return askConfirm(c, 'Bot WhatsApp se LOGOUT ho jayega (dobara QR/pairing chahiye hoga)', async () => {
        await c.say('🚪 Logout ho raha hai...');
        try { await c.sock.logout(); } catch (e) { await c.say('❌ ' + e.message); }
    });
};

// ---- game: win / lose / score / levelup / rankup / gameover
const GAME_COOL = 30 * 1000;
async function gameResult(c, won) {
    const u = user(c.st, c.meNum); c.st.d.users[c.meNum] = u;
    const left = GAME_COOL - (Date.now() - u.gameAt);
    if (left > 0) return c.say(`⏳ ${Math.ceil(left / 1000)} second baad dobara try karein.`);
    u.gameAt = Date.now();
    if (won) { u.wins++; u.score += 20; } else { u.losses++; u.score = Math.max(0, u.score - 5); }
    save(c.st);
    return say(c.sock, c.m, `${won ? '🏆 Jeet' : '💔 Haar'}! ${tag(c.me)}\n${won ? '+20' : '-5'} points\n⭐ Score: *${u.score}*`, [c.me]);
}
H.win = (c) => gameResult(c, true);
H.lose = (c) => gameResult(c, false);
H.score = async (c) => {
    const who = c.target || c.me, n = cleanNum(who), u = user(c.st, n); c.st.d.users[n] = u;
    return say(c.sock, c.m,
        `📊 *Score Card* ${tag(who)}\n\n⭐ Score: ${u.score}\n🎚️ Level: ${u.level}\n🏅 Rank: ${RANKS[u.rank]}\n🏆 Wins: ${u.wins}   💔 Losses: ${u.losses}\n👍 Reputation: ${u.rep}\n👥 Followers: ${followers(c.st, n)}   ➡️ Following: ${u.following.length}`, [who]);
};
H.levelup = async (c) => {
    const u = user(c.st, c.meNum); c.st.d.users[c.meNum] = u;
    const cost = u.level * 30;
    if (u.score < cost) return c.say(`❌ Level ${u.level + 1} ke liye *${cost}* score chahiye. Aapka score: ${u.score}\n(${c.prefix}win se score badhayein)`);
    u.score -= cost; u.level++; save(c.st);
    return c.say(`🎉 *Level Up!* Ab aap Level *${u.level}* par hain.\n⭐ Bacha score: ${u.score}`);
};
H.rankup = async (c) => {
    const u = user(c.st, c.meNum); c.st.d.users[c.meNum] = u;
    if (u.rank >= RANKS.length - 1) return c.say(`👑 Aap pehle se sabse ooncha rank (${RANKS[u.rank]}) par hain!`);
    const needLevel = (u.rank + 1) * 3, cost = 100;
    if (u.level < needLevel || u.score < cost) return c.say(`❌ Agle rank (${RANKS[u.rank + 1]}) ke liye Level *${needLevel}* aur *${cost}* score chahiye.\nAapka: Level ${u.level}, Score ${u.score}`);
    u.score -= cost; u.rank++; save(c.st);
    return c.say(`🏅 *Rank Up!* Naya rank: *${RANKS[u.rank]}*`);
};
H.gameover = async (c) => {
    const u = user(c.st, c.meNum); c.st.d.users[c.meNum] = u;
    const summary = `🎮 *GAME OVER*\n\n⭐ Final score: ${u.score}\n🎚️ Level: ${u.level}\n🏅 Rank: ${RANKS[u.rank]}\n🏆 Wins: ${u.wins}   💔 Losses: ${u.losses}\n\n🔄 Naya game shuru — score, level aur rank reset.`;
    u.score = 0; u.level = 1; u.rank = 0; save(c.st);
    return c.say(summary);
};

// ------------------------------------------------------------------ export
const HELP = {
    roleplay: 'cry dance laugh sleep eat drink sing run jump fly swim clean wash fix build cook bake destroy',
    tools: 'write read draw paint  |  start pause resume record stop (stopwatch)',
    vote: 'create find agree disagree cancel <id>',
    social: 'like dislike follow unfollow flag',
    system: 'check verify refresh reload hide show open close',
    power: 'exit quit logout (+ confirm / cancel)',
    game: 'win lose score levelup rankup gameover'
};

function buildContext(raw) {
    const { sock, m, args = [], prefix = '.', privileged = false, reloadCommands } = raw;
    const chat = m.key.remoteJid;
    const meJid = toJid(m.key.fromMe ? sock.user?.id : (m.key.participant || m.key.participantAlt || chat));
    const ci = m.message?.extendedTextMessage?.contextInfo || m.message?.imageMessage?.contextInfo || m.message?.videoMessage?.contextInfo || {};
    const target = (ci.mentionedJid && ci.mentionedJid[0]) || ci.participant || null;
    const q = ci.quotedMessage || {};
    const quotedText = (q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || '').trim();
    const c = {
        sock, m, args, prefix, privileged, reloadCommands, chat,
        me: meJid, meNum: cleanNum(meJid), target: target ? toJid(target) : null,
        text: args.filter(a => !a.startsWith('@')).join(' ').trim(), quotedText,
        st: getStore(sock)
    };
    c.say = (t, mentions = []) => say(sock, m, t, mentions);
    c.usage = (cmd, ex) => c.say(`⚠️ Text likhein.\nExample: ${prefix}${cmd} ${ex}`);
    return c;
}

module.exports = Object.keys(H).map(name => ({
    name,
    async execute(raw) {
        try { return await H[name](buildContext(raw)); }
        catch (e) {
            console.error(`[MEHFOOZ MD] .${name} error:`, e);
            try { await raw.reply(`❌ .${name} chalate waqt error aa gaya: ${e.message}`); } catch {}
        }
    }
}));
module.exports.HELP = HELP;
