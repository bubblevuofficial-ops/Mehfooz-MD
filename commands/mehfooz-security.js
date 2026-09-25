'use strict';
/**
 * ============================================================
 *  MEHFOOZ MD - SECURITY & ANTI MENU  (mehfooz-security.js)
 * ============================================================
 *  Built for Baileys (@whiskeysockets/baileys).
 *
 *  Install (only .autosticker needs the 2nd package):
 *     npm i @whiskeysockets/baileys wa-sticker-formatter
 *
 *  Wiring (already done in handler.js):
 *     sec.handleMessage(sock, m)        -> automatic anti filters
 *     sec.handleCommand(sock, m, opts)  -> all commands
 *  In index.js:
 *     sock.ev.on('group-participants.update', ev => sec.handleGroupUpdate(sock, ev));
 *     sock.ev.on('call', calls => sec.handleCall(sock, calls));
 *
 *  DEVELOPER NUMBER: numbers in CONFIG.developers are ALWAYS obeyed.
 *  They count as owner, bypass every filter, and can never be
 *  banned, blocked or kicked by this plugin.
 *
 *  The bot must be a group admin for delete / kick / lock to work.
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const {
  getContentType,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');

// ------------------------------------------------------------
//  CONFIG
// ------------------------------------------------------------
const CONFIG = {
  developers: ['923204854766'],     // ALWAYS obeyed, full access
  owners: ['923204854766'],         // extra owners (handler.js syncs db.owners here)
  prefix: '.',
  botName: 'MEHFOOZ MD',
  maxWarns: 3,                      // warnings before automatic kick
  spam: { limit: 5, seconds: 7 },   // >5 messages in 7s = spam
  repeatLimit: 3,                   // same message sent 3x in a row = spam
  tagLimit: 5,                      // mentioning this many people = antitag
  defaultFakePrefixes: ['92'],      // antifake: only these country codes may join
  stickerPack: 'MEHFOOZ MD',
  stickerAuthor: 'Bot',
};

// ------------------------------------------------------------
//  Database (JSON file)
// ------------------------------------------------------------
const DB_FILE = path.join(__dirname, 'mehfooz_security_db.json');
let db = { chats: {}, global: {}, banned: [] };
try {
  if (fs.existsSync(DB_FILE)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
} catch (e) {
  console.error('[security] db load error:', e.message);
}
let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
    catch (e) { console.error('[security] db save error:', e.message); }
  }, 500);
}
function getChat(jid) {
  if (!db.chats[jid]) db.chats[jid] = { f: {}, words: [], warns: {}, fakePrefixes: [...CONFIG.defaultFakePrefixes] };
  return db.chats[jid];
}
// migrate old ban list (plain number strings) -> { num, action, warns }
db.banned = (db.banned || []).map((b) => (typeof b === 'string' ? { num: b, action: 'delete', warns: 0 } : b));
function findBan(num) { return db.banned.find((b) => b.num === num); }

// ------------------------------------------------------------
//  Message style helpers (kept short - no long paragraphs)
// ------------------------------------------------------------
let P = CONFIG.prefix;
const BRAND = '👑 MEHFOOZ MD';
const card = (title, body) => `${title}\n${body}\n${BRAND}`;

// ------------------------------------------------------------
//  Features (name, scope, actions, one-line description)
// ------------------------------------------------------------
const GA = ['delete', 'warn', 'kick'];
const FEATURES = {
  // ---------- Group features (group admins / owner) ----------
  antilink:      { scope: 'group', actions: GA, desc: 'Blocks all links (WhatsApp, YouTube, websites, etc).' },
  antivideo:     { scope: 'group', actions: GA, desc: 'Blocks videos.' },
  antigif:       { scope: 'group', actions: GA, desc: 'Blocks GIFs.' },
  antiimage:     { scope: 'group', actions: GA, desc: 'Blocks images.' },
  antisticker:   { scope: 'group', actions: GA, desc: 'Blocks stickers.' },
  antidoc:       { scope: 'group', actions: GA, desc: 'Blocks documents/files.' },
  antivice:      { scope: 'group', actions: GA, desc: 'Blocks audio files.' },
  antirecording: { scope: 'group', actions: GA, desc: 'Blocks voice notes.' },
  antimap:       { scope: 'group', actions: GA, desc: 'Blocks map links.' },
  antilocation:  { scope: 'group', actions: GA, desc: 'Blocks shared locations.' },
  anticontact:   { scope: 'group', actions: GA, desc: 'Blocks contact cards.' },
  antiemoji:     { scope: 'group', actions: GA, desc: 'Blocks emoji-only messages.' },
  antibot:       { scope: 'group', actions: GA, desc: 'Blocks other bots.' },
  antispam:      { scope: 'group', actions: GA, desc: 'Blocks flooding & repeated messages.' },
  antitoxic:     { scope: 'group', actions: GA, desc: 'Blocks abusive words.' },
  antitag:       { scope: 'group', actions: GA, desc: 'Blocks mass tagging.' },
  antiword:      { scope: 'group', actions: GA, desc: 'Blocks your custom word list (.addword/.delword/.listword).' },
  nsfw:          { scope: 'group', actions: GA, desc: 'Blocks adult content.' },
  antifake:      { scope: 'group', actions: null, desc: 'Removes joiners with a wrong country code. Use: .antifake on 92,91' },
  // ---------- Global features (owner only) ----------
  antiedit:      { scope: 'global', actions: null, desc: 'Shows old + new text when a message is edited. Target: .antiedit on group|samechat|inbox' },
  antidelete:    { scope: 'global', actions: null, desc: 'Re-sends a message if it gets deleted. Target: .antidelete on group|samechat|inbox' },
  antiinbox:     { scope: 'global', actions: null, desc: 'Blocks and auto-blocks anyone who DMs the bot.' },
  anticall:      { scope: 'global', actions: ['reject', 'block'], desc: 'Rejects calls. Add "block" to also block the caller.' },
  autoread:      { scope: 'global', actions: null, desc: 'Marks every message as read.' },
  autosticker:   { scope: 'global', actions: null, desc: 'Turns images/short videos into stickers.' },
  autorespond:   { scope: 'global', actions: null, desc: 'Auto-replies to DMs. Set text: .autorespond on <text>' },
};
const FEATURE_ORDER = Object.keys(FEATURES);

// Short, simple mode names shown back to the user — just the mode word plus
// one plain-English hint, no "delete + X" combos to avoid confusion.
const ACTION_INFO = {
  delete: 'message is deleted',
  warn: `warn sent (${CONFIG.maxWarns} warns = kicked)`,
  kick: 'sender is kicked',
  reject: 'call is rejected',
  block: 'call rejected + caller blocked',
};

// ------------------------------------------------------------
//  Word lists / regex
// ------------------------------------------------------------
const LINK_RE = /((https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+|wa\.me\/\S+|t\.me\/\S+|youtu\.be\/\S+|youtube\.com\/\S+|\b[a-z0-9-]{2,}\.(com|net|org|io|xyz|pk|me|gg|ly|info|site|online|top|app)\b)/i;
const MAP_RE = /(maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|google\.com\/maps)/i;
const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}[\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]*|\s)+$/u;
const TOXIC_WORDS = [
  'fuck', 'bitch', 'bastard', 'asshole', 'motherfucker', 'dick', 'slut', 'whore',
  'madarchod', 'behenchod', 'bhenchod', 'bhosdi', 'chutiya', 'gandu', 'harami',
  'kamina', 'randi', 'lund', 'kutta', 'kutti', 'saala', 'haramzada',
];
const NSFW_WORDS = [
  'porn', 'xxx', 'sex video', 'nude', 'nudes', 'hentai', 'onlyfans',
  'xvideos', 'xnxx', 'pornhub', 'sexy video', 'blowjob',
];

// ------------------------------------------------------------
//  Helpers
// ------------------------------------------------------------
const jidNum = (j) => String(j || '').split('@')[0].split(':')[0];
const isDev = (j) => CONFIG.developers.includes(jidNum(j));
const isOwnerNum = (j) => isDev(j) || CONFIG.owners.includes(jidNum(j));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Real sender JID (also handles @lid ids when the phone number is available)
function getSender(sock, m) {
  const k = m.key || {};
  if (k.fromMe) return sock.user.id;
  const grp = (k.remoteJid || '').endsWith('@g.us');
  let j = grp ? k.participant : k.remoteJid;
  // Prefer whatever real phone-number JID WhatsApp supplies alongside a @lid
  // id — needed for DMs / business accounts, not only group @lid ids.
  const alt = grp ? (k.participantAlt || k.participantPn) : (k.remoteJidAlt || k.senderPn);
  if (alt) j = alt;
  return j || k.remoteJid;
}
// True if this message unambiguously belongs to the bot owner: either the
// sender's known number matches, or the message was sent from the bot's own
// connected account (covers DMs/business accounts where number-matching can
// be unreliable).
function isOwnerMsg(sender, m) {
  return isOwnerNum(sender) || !!(m?.key?.fromMe);
}

function unwrap(m) {
  let msg = m.message || {};
  for (let i = 0; i < 4; i++) {
    const inner =
      msg.ephemeralMessage?.message ||
      msg.viewOnceMessage?.message ||
      msg.viewOnceMessageV2?.message ||
      msg.documentWithCaptionMessage?.message;
    if (!inner) break;
    msg = inner;
  }
  return msg;
}

function getText(m) {
  const msg = unwrap(m);
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    msg.buttonsResponseMessage?.selectedButtonId ||
    msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  );
}

const metaCache = new Map();
async function getMeta(sock, jid) {
  const c = metaCache.get(jid);
  if (c && Date.now() - c.t < 30000) return c.d;
  const d = await sock.groupMetadata(jid);
  metaCache.set(jid, { t: Date.now(), d });
  return d;
}

// A participant's id can be in @lid form on newer WhatsApp privacy settings,
// in which case jidNum(p.id) is a LID, not the real phone number. Fall back
// to any phoneNumber/jid/pn field Baileys attaches to the participant.
function participantNum(p) {
  if (p.id && p.id.endsWith('@lid')) {
    const alt = p.phoneNumber || p.jid || p.pn;
    if (alt) return jidNum(alt);
  }
  return jidNum(p.id);
}

function adminInfo(sock, meta, senderJid) {
  const admins = meta.participants.filter((p) => p.admin).map(participantNum);
  const botNum = jidNum(sock.user.id);
  const botEntry = meta.participants.find((p) => participantNum(p) === botNum || jidNum(p.id) === botNum);
  return {
    isAdmin: admins.includes(jidNum(senderJid)),
    isBotAdmin: !!(botEntry && botEntry.admin),
    botNum,
  };
}

// Rate-limit the "I need admin" notice so it doesn't spam the group.
const adminNoticeMap = new Map();
function maybeNoticeNeedAdmin(chat) {
  const last = adminNoticeMap.get(chat) || 0;
  if (Date.now() - last > 10 * 60 * 1000) {
    adminNoticeMap.set(chat, Date.now());
    return true;
  }
  return false;
}

function isEnabled(feature, chatJid) {
  const F = FEATURES[feature];
  const cfg = F.scope === 'global' ? db.global[feature] : getChat(chatJid).f[feature];
  return !!(cfg && cfg.on);
}
function getCfg(feature, chatJid) {
  const F = FEATURES[feature];
  return (F.scope === 'global' ? db.global[feature] : getChat(chatJid).f[feature]) || {};
}
function setCfg(feature, chatJid, patch) {
  const F = FEATURES[feature];
  if (F.scope === 'global') {
    db.global[feature] = { ...(db.global[feature] || {}), ...patch };
  } else {
    const c = getChat(chatJid);
    c.f[feature] = { ...(c.f[feature] || {}), ...patch };
  }
  saveDB();
}

// where antiedit/antidelete notices are posted: 'group' | 'samechat' (same
// chat it happened in) or 'inbox' — the bot's own self-chat ("Message
// Yourself" / "You" in WhatsApp), NOT any particular person's number. The
// developer number only ever has command authority, it never receives content.
function notifyChat(feature, chatJid, sock) {
  const cfg = getCfg(feature, chatJid);
  if (cfg.target === 'inbox') {
    return `${jidNum(sock.user.id)}@s.whatsapp.net`;
  }
  return chatJid;
}

// ------------------------------------------------------------
//  Message store (for antidelete / antiedit)
// ------------------------------------------------------------
const msgStore = new Map();
function rememberMsg(m) {
  if (!m.key?.id) return;
  msgStore.set(m.key.id, m);
  if (msgStore.size > 3000) msgStore.delete(msgStore.keys().next().value);
}

// ------------------------------------------------------------
//  Punishment system (delete / warn / kick) - short messages
// ------------------------------------------------------------
async function punish(sock, m, chat, sender, feature, reason) {
  const cfg = getCfg(feature, chat);
  const action = cfg.action || 'delete';
  const num = jidNum(sender);
  const tag = `⚠️ ${feature.toUpperCase()}`;

  try { await sock.sendMessage(chat, { delete: m.key }); } catch (_) {}

  if (action === 'delete') {
    await sock.sendMessage(chat, {
      text: card(tag, `@${num} — ${reason} Message deleted.`),
      mentions: [sender],
    });
    return;
  }

  if (action === 'warn') {
    const c = getChat(chat);
    c.warns[num] = (c.warns[num] || 0) + 1;
    saveDB();
    if (c.warns[num] >= CONFIG.maxWarns) {
      c.warns[num] = 0;
      saveDB();
      await sock.sendMessage(chat, {
        text: card(`🚫 ${feature.toUpperCase()} - REMOVED`, `@${num} hit ${CONFIG.maxWarns}/${CONFIG.maxWarns} warns and is removed.`),
        mentions: [sender],
      });
      try { await sock.groupParticipantsUpdate(chat, [sender], 'remove'); } catch (_) {}
    } else {
      await sock.sendMessage(chat, {
        text: card(tag, `@${num} — ${reason} Warn ${c.warns[num]}/${CONFIG.maxWarns}.`),
        mentions: [sender],
      });
    }
    return;
  }

  if (action === 'kick') {
    await sock.sendMessage(chat, {
      text: card(`🚫 ${feature.toUpperCase()} - REMOVED`, `@${num} — ${reason} Removed from group.`),
      mentions: [sender],
    });
    try { await sock.groupParticipantsUpdate(chat, [sender], 'remove'); } catch (_) {}
  }
}

// ------------------------------------------------------------
//  Spam tracker: flood limit + same message repeated N times
// ------------------------------------------------------------
const spamMap = new Map();
function isSpamming(chat, sender) {
  const key = chat + '|' + sender;
  const now = Date.now();
  const arr = (spamMap.get(key) || []).filter((t) => now - t < CONFIG.spam.seconds * 1000);
  arr.push(now);
  spamMap.set(key, arr);
  return arr.length > CONFIG.spam.limit;
}

const repeatMap = new Map();
function isRepeatedMessage(chat, sender, text) {
  if (!text) return false;
  const key = chat + '|' + sender;
  const rec = repeatMap.get(key) || { text: '', count: 0 };
  if (rec.text === text) rec.count += 1;
  else { rec.text = text; rec.count = 1; }
  repeatMap.set(key, rec);
  return rec.count >= CONFIG.repeatLimit;
}

// ------------------------------------------------------------
//  Auto sticker
// ------------------------------------------------------------
async function makeSticker(sock, m, chat) {
  try {
    const { Sticker } = require('wa-sticker-formatter');
    const buf = await downloadMediaMessage(m, 'buffer', {});
    const st = new Sticker(buf, { pack: CONFIG.stickerPack, author: CONFIG.stickerAuthor, type: 'full', quality: 50 });
    await sock.sendMessage(chat, { sticker: await st.toBuffer() }, { quoted: m });
  } catch (e) {
    console.error('[autosticker]', e.message);
  }
}

// ============================================================
//  1) handleMessage : automatic protection on every message
// ============================================================
async function handleMessage(sock, m) {
  try {
    if (!m.message || !m.key) return;
    const chat = m.key.remoteJid;
    if (!chat || chat === 'status@broadcast') return;
    const isGroup = chat.endsWith('@g.us');
    const msg = unwrap(m);
    const type = getContentType(msg);

    // --- antidelete / antiedit ---
    if (type === 'protocolMessage') {
      const pm = msg.protocolMessage;
      const orig = pm.key?.id ? msgStore.get(pm.key.id) : null;
      const isRevoke = pm.type === 0 || pm.type === 'REVOKE';
      const isEdit = pm.type === 14 || pm.type === 'MESSAGE_EDIT';

      // Deleted message
      if (isRevoke && isEnabled('antidelete', chat)) {
        if (!(orig && orig.key.fromMe)) {
          const who = orig ? getSender(sock, orig) : null;
          const whoNum = who ? jidNum(who) : '';
          const target = notifyChat('antidelete', chat, sock);
          if (orig) {
            await sock.sendMessage(target, {
              text: card('🗑️ ANTIDELETE', whoNum ? `@${whoNum} deleted a message:` : 'A message was deleted:'),
              mentions: whoNum ? [who] : [],
            });
            try { await sock.sendMessage(target, { forward: orig }, { quoted: orig }); } catch (_) {}
          } else {
            await sock.sendMessage(target, { text: card('🗑️ ANTIDELETE', 'A message was deleted (original was not cached by the bot).') });
          }
        }
        return;
      }

      // Edited message
      if (isEdit && isEnabled('antiedit', chat)) {
        if (!m.key.fromMe) {
          const who = getSender(sock, m);
          const whoNum = who ? jidNum(who) : '';
          const oldText = orig ? (getText(orig) || '(media)') : '(not cached)';
          const newText =
            pm.editedMessage?.conversation ||
            pm.editedMessage?.extendedTextMessage?.text ||
            '(media)';
          const target = notifyChat('antiedit', chat, sock);
          await sock.sendMessage(target, {
            text: card('✏️ ANTIEDIT', (whoNum ? `@${whoNum} edited a message.` : 'A message was edited.') + `\nOld: ${oldText}\nNew: ${newText}`),
            mentions: whoNum ? [who] : [],
          });
          if (orig && pm.key?.id) {
            msgStore.set(pm.key.id, { ...orig, message: { conversation: newText } });
          }
        }
        return;
      }
      return;
    }

    rememberMsg(m);
    if (m.key.fromMe) return;

    const sender = getSender(sock, m);
    const num = jidNum(sender);
    const text = getText(m);

    // --- autoread ---
    if (isEnabled('autoread', chat)) {
      try { await sock.readMessages([m.key]); } catch (_) {}
    }

    // --- autosticker ---
    if (isEnabled('autosticker', chat) && (type === 'imageMessage' || (type === 'videoMessage' && (msg.videoMessage.seconds || 0) <= 10))) {
      await makeSticker(sock, m, chat);
    }

    // ==================== Private chat (inbox) ====================
    if (!isGroup) {
      if (isOwnerNum(sender)) return;
      if (findBan(num)) return; // WhatsApp does not allow deleting someone else's DM for them

      if (isEnabled('antiinbox', chat)) {
        await sock.sendMessage(chat, { text: card('🚫 ANTIINBOX', 'Private messages are not allowed. You are blocked.') });
        try { await sock.updateBlockStatus(chat, 'block'); } catch (_) {}
        return;
      }
      if (isEnabled('autorespond', chat) && !text.startsWith(P)) {
        const reply = getCfg('autorespond', chat).text || `Hi, I am ${CONFIG.botName}. Owner is busy, try again later.`;
        await sock.sendMessage(chat, { text: reply }, { quoted: m });
      }
      return;
    }

    // ==================== Group chat ====================
    const meta = await getMeta(sock, chat);
    const { isAdmin, isBotAdmin } = adminInfo(sock, meta, sender);

    // Banned sender in the group -> act per their ban mode (delete / warn / kick)
    const banEntry = findBan(num);
    if (banEntry && isBotAdmin && !isAdmin && !isOwnerNum(sender)) {
      try { await sock.sendMessage(chat, { delete: m.key }); } catch (_) {}

      if (banEntry.action === 'kick') {
        await sock.sendMessage(chat, { text: card('🚫 BAN - REMOVED', `@${num} is banned. Removed from group.`), mentions: [sender] });
        try { await sock.groupParticipantsUpdate(chat, [sender], 'remove'); } catch (_) {}
      } else if (banEntry.action === 'warn') {
        banEntry.warns = (banEntry.warns || 0) + 1;
        if (banEntry.warns >= CONFIG.maxWarns) {
          banEntry.warns = 0;
          saveDB();
          await sock.sendMessage(chat, { text: card('🚫 BAN - REMOVED', `@${num} hit ${CONFIG.maxWarns}/${CONFIG.maxWarns} warns. Removed.`), mentions: [sender] });
          try { await sock.groupParticipantsUpdate(chat, [sender], 'remove'); } catch (_) {}
        } else {
          saveDB();
          await sock.sendMessage(chat, { text: card('🚫 BANNED', `@${num} is banned. Warn ${banEntry.warns}/${CONFIG.maxWarns}.`), mentions: [sender] });
        }
      }
      // action 'delete' (default): message removed silently, no extra text
      return;
    }

    // Also delete any message that mentions or replies to a banned number.
    if (db.banned.length && !isDev(sender)) {
      const quotedParticipant = msg[type]?.contextInfo?.participant;
      const mentioned = msg[type]?.contextInfo?.mentionedJid || [];
      const touchesBanned =
        (quotedParticipant && findBan(jidNum(quotedParticipant))) ||
        mentioned.some((j) => findBan(jidNum(j)));
      if (touchesBanned && isBotAdmin) {
        try { await sock.sendMessage(chat, { delete: m.key }); } catch (_) {}
        return;
      }
    }

    // Admins, owners and the developer are never touched by filters.
    if (isAdmin || isOwnerNum(sender)) return;

    // Bot must be group admin to delete/kick. Instead of failing silently,
    // tell the group once (rate-limited) so this isn't invisible.
    if (!isBotAdmin) {
      const anyOn = FEATURE_ORDER.some((f) => FEATURES[f].scope === 'group' && isEnabled(f, chat));
      if (anyOn && maybeNoticeNeedAdmin(chat)) {
        await sock.sendMessage(chat, {
          text: card('⚠️ NEED ADMIN', 'Security filters are ON but I am not a group admin, so I cannot delete/kick. Please make me admin.'),
        });
      }
      return;
    }

    const c = getChat(chat);
    const lower = text.toLowerCase();
    const mentionCount = (msg[type]?.contextInfo?.mentionedJid || []).length;

    const rules = [
      ['antispam',      () => isSpamming(chat, sender) || isRepeatedMessage(chat, sender, text), 'no spamming.'],
      ['antilink',      () => LINK_RE.test(text),                                                 'links are not allowed.'],
      ['antimap',       () => MAP_RE.test(text),                                                  'map links are not allowed.'],
      ['antivideo',     () => type === 'videoMessage' && !msg.videoMessage.gifPlayback,           'videos are not allowed.'],
      ['antigif',       () => type === 'videoMessage' && !!msg.videoMessage.gifPlayback,          'GIFs are not allowed.'],
      ['antiimage',     () => type === 'imageMessage',                                            'images are not allowed.'],
      ['antisticker',   () => type === 'stickerMessage',                                          'stickers are not allowed.'],
      ['antidoc',       () => type === 'documentMessage',                                         'documents are not allowed.'],
      ['antivice',      () => type === 'audioMessage' && !msg.audioMessage.ptt,                   'audio files are not allowed.'],
      ['antirecording', () => type === 'audioMessage' && !!msg.audioMessage.ptt,                  'voice notes are not allowed.'],
      ['antilocation',  () => type === 'locationMessage' || type === 'liveLocationMessage',       'sharing location is not allowed.'],
      ['anticontact',   () => type === 'contactMessage' || type === 'contactsArrayMessage',       'sharing contacts is not allowed.'],
      ['antiemoji',     () => !!text && EMOJI_ONLY_RE.test(text.trim()),                          'emoji-only messages are not allowed.'],
      ['antibot',       () => /^(BAE5|3EB0)/.test(m.key.id || '') && !m.key.fromMe,               'bot messages are not allowed.'],
      ['antitoxic',     () => TOXIC_WORDS.some((w) => lower.includes(w)),                         'abusive language is not allowed.'],
      ['antitag',       () => mentionCount >= CONFIG.tagLimit,                                    'mass tagging is not allowed.'],
      ['antiword',      () => c.words.length && c.words.some((w) => lower.includes(w.toLowerCase())), 'that word is not allowed here.'],
      ['nsfw',          () => NSFW_WORDS.some((w) => lower.includes(w)),                          'adult content is not allowed.'],
    ];

    for (const [feature, test, reason] of rules) {
      if (isEnabled(feature, chat) && test()) {
        await punish(sock, m, chat, sender, feature, reason);
        return;
      }
    }
  } catch (e) {
    console.error('[security] handleMessage error:', e.message);
  }
}

// ============================================================
//  2) handleGroupUpdate : antifake on join
// ============================================================
async function handleGroupUpdate(sock, ev) {
  try {
    if (ev.action !== 'add') return;
    const chat = ev.id;
    if (!isEnabled('antifake', chat)) return;
    const meta = await getMeta(sock, chat);
    const botNum = jidNum(sock.user.id);
    const isBotAdmin = meta.participants.some((p) => p.admin && jidNum(p.id) === botNum);
    if (!isBotAdmin) return;
    const codes = getChat(chat).fakePrefixes.length ? getChat(chat).fakePrefixes : CONFIG.defaultFakePrefixes;
    for (const j of ev.participants) {
      const num = jidNum(j);
      if (isOwnerNum(j)) continue;
      if (!codes.some((c) => num.startsWith(c))) {
        try { await sock.groupParticipantsUpdate(chat, [j], 'remove'); } catch (_) {}
        await sock.sendMessage(chat, { text: card('🚫 ANTIFAKE', `@${num} removed — number not allowed here.`), mentions: [j] });
      }
    }
  } catch (e) {
    console.error('[security] handleGroupUpdate error:', e.message);
  }
}

// ============================================================
//  3) handleCall : anticall
// ============================================================
async function handleCall(sock, calls) {
  try {
    for (const call of calls) {
      const chat = call.chatId || call.from;
      if (!isEnabled('anticall', chat)) continue;
      const cfg = getCfg('anticall', chat);
      try { await sock.rejectCall(call.id, call.from); } catch (_) {}
      if (cfg.action === 'block') {
        try { await sock.updateBlockStatus(call.from, 'block'); } catch (_) {}
      }
    }
  } catch (e) {
    console.error('[security] handleCall error:', e.message);
  }
}

// ============================================================
//  4) handleCommand : all . commands for this module
// ============================================================
function shortMenu(prefix) {
  const lines = FEATURE_ORDER.map((f) => `• ${prefix}${f}`);
  return card('🛡️ SECURITY MENU', lines.join('\n') + `\n\nUse: ${prefix}<feature> on [action] / off / status`);
}

async function handleCommand(sock, m, opts) {
  const chat = m.key.remoteJid;
  try {
    return await handleCommandInner(sock, m, opts);
  } catch (e) {
    console.error('[security] handleCommand error:', e.message);
    try { await sock.sendMessage(chat, { text: '❌ Error running that command: ' + e.message }, { quoted: m }); } catch (_) {}
    return true;
  }
}

async function handleCommandInner(sock, m, opts) {
  const prefix = opts?.prefix || CONFIG.prefix;
  P = prefix;
  const chat = m.key.remoteJid;
  const isGroup = chat.endsWith('@g.us');
  const sender = getSender(sock, m);
  const text = getText(m);
  if (!text.startsWith(prefix)) return false;

  const args = text.slice(prefix.length).trim().split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  const reply = (t) => sock.sendMessage(chat, { text: t }, { quoted: m });

  // Permission: group-scope commands need group admin (or owner/dev); global-scope need owner/dev.
  async function checkPerm(feature) {
    if (isOwnerMsg(sender, m)) return true;
    if (FEATURES[feature].scope === 'global') return false;
    if (!isGroup) return false;
    const meta = await getMeta(sock, chat);
    return adminInfo(sock, meta, sender).isAdmin;
  }

  // ---- secmenu ----
  if (cmd === 'secmenu') {
    await reply(shortMenu(prefix));
    return true;
  }

  // ---- feature on/off/status ----
  if (FEATURES[cmd]) {
    const feature = cmd;
    const F = FEATURES[feature];
    if (!(await checkPerm(feature))) { await reply('⚠️ Not allowed. Admin/owner only.'); return true; }

    const sub = (args[0] || '').toLowerCase();
    if (sub === 'status') {
      const cfg = getCfg(feature, chat);
      await reply(card(`ℹ️ ${feature.toUpperCase()}`, cfg.on ? `ON (${cfg.action || cfg.target || 'default'})` : 'OFF'));
      return true;
    }
    if (sub === 'off') {
      setCfg(feature, chat, { on: false });
      await reply(card(`✅ ${feature.toUpperCase()}`, 'Turned OFF.'));
      return true;
    }
    if (sub === 'on') {
      const opt = (args[1] || '').toLowerCase();
      if (feature === 'antifake') {
        const codes = (args[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (codes.length) getChat(chat).fakePrefixes = codes;
        setCfg(feature, chat, { on: true });
        await reply(card('✅ ANTIFAKE', `ON. Allowed codes: ${getChat(chat).fakePrefixes.join(', ')}`));
        return true;
      }
      if (feature === 'antiedit' || feature === 'antidelete') {
        const target = ['group', 'samechat', 'inbox'].includes(opt) ? opt : 'group';
        setCfg(feature, chat, { on: true, target });
        const where = target === 'inbox' ? "bot's own self-chat (You)" : 'same chat';
        await reply(card(`✅ ${feature.toUpperCase()}`, `ON — sends to: ${where}`));
        return true;
      }
      if (feature === 'anticall') {
        const action = opt === 'block' ? 'block' : 'reject';
        setCfg(feature, chat, { on: true, action });
        await reply(card('✅ ANTICALL', `ON. ${ACTION_INFO[action]}`));
        return true;
      }
      if (feature === 'autorespond') {
        const t = args.slice(1).join(' ');
        setCfg(feature, chat, { on: true, text: t || undefined });
        await reply(card('✅ AUTORESPOND', 'ON.' + (t ? ' Reply set.' : '')));
        return true;
      }
      if (F.actions) {
        const action = F.actions.includes(opt) ? opt : 'delete';
        setCfg(feature, chat, { on: true, action });
        await reply(card(`✅ ${feature.toUpperCase()}`, `ON — mode: ${action.toUpperCase()} (${ACTION_INFO[action]})`));
        return true;
      }
      setCfg(feature, chat, { on: true });
      await reply(card(`✅ ${feature.toUpperCase()}`, 'ON.'));
      return true;
    }
    await reply(card(`ℹ️ ${feature.toUpperCase()}`, `${F.desc}\nUse: ${prefix}${feature} on / off / status`));
    return true;
  }

  // ---- antiword list management ----
  if (['addword', 'delword', 'listword'].includes(cmd)) {
    if (!(await checkPerm('antiword'))) { await reply('⚠️ Not allowed. Admin/owner only.'); return true; }
    const c = getChat(chat);
    if (cmd === 'addword') {
      const w = args.join(' ').toLowerCase();
      if (!w) { await reply('⚠️ Usage: .addword <word>'); return true; }
      if (!c.words.includes(w)) c.words.push(w);
      saveDB();
      await reply(card('✅ ADDWORD', `"${w}" added.`));
      return true;
    }
    if (cmd === 'delword') {
      const w = args.join(' ').toLowerCase();
      c.words = c.words.filter((x) => x !== w);
      saveDB();
      await reply(card('✅ DELWORD', `"${w}" removed.`));
      return true;
    }
    if (cmd === 'listword') {
      await reply(card('📋 WORD LIST', c.words.length ? c.words.join(', ') : 'Empty.'));
      return true;
    }
  }

  // ---- ban / unban / banlist (owner only) ----
  if (['ban', 'unban', 'banlist'].includes(cmd)) {
    if (!isOwnerMsg(sender, m)) { await reply('⚠️ Owner only.'); return true; }

    const quoted = m.message?.extendedTextMessage?.contextInfo?.participant;
    const mentioned = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    const fromTag = quoted || mentioned;
    const target = jidNum(fromTag || args[0] || '');
    // if the number came from a reply/mention, args[0] is the action word instead
    const opt = (fromTag ? args[0] : args[1] || '').toLowerCase();

    if (cmd === 'ban') {
      if (!target) { await reply('⚠️ Reply, mention or give a number to ban.\nUsage: .ban <number> delete|warn|kick'); return true; }
      if (isOwnerNum(target)) { await reply('⚠️ Cannot ban an owner/developer.'); return true; }
      const action = ['delete', 'warn', 'kick'].includes(opt) ? opt : 'delete';
      const existing = findBan(target);
      if (existing) { existing.action = action; existing.warns = 0; }
      else db.banned.push({ num: target, action, warns: 0 });
      saveDB();
      const how = action === 'delete' ? 'messages deleted' : action === 'warn' ? `warned, ${CONFIG.maxWarns} warns = kicked` : 'kicked on next message';
      await reply(card('🚫 BANNED', `${target} banned. Mode: ${action} (${how}).`));
      return true;
    }
    if (cmd === 'unban') {
      if (!target) { await reply('⚠️ Give a number to unban.'); return true; }
      db.banned = db.banned.filter((b) => b.num !== target);
      saveDB();
      await reply(card('✅ UNBANNED', `${target} is unbanned.`));
      return true;
    }
    if (cmd === 'banlist') {
      const list = db.banned.map((b) => `• ${b.num} (${b.action})`).join('\n');
      await reply(card('📋 BAN LIST', list || 'Empty.'));
      return true;
    }
  }

  return false;
}

module.exports = {
  CONFIG,
  FEATURES,
  handleMessage,
  handleCommand,
  handleGroupUpdate,
  handleCall,
};