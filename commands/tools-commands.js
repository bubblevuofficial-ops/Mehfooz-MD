'use strict';

/*
|--------------------------------------------------------------------------
| MEHFOOZ MD - TOOLS & UTILITY COMMANDS (REAL LOGIC)
|--------------------------------------------------------------------------
| File location : ./commands/tools-commands.js
| Loaded by     : ./commands/general.js  (general.js in commands ko yahan se
|                 merge karta hai, isliye handler.js ko kuch change nahi karna)
|
| Requirements  : Node 18+  (fetch / FormData / Blob built-in)
|                 ffmpeg    (sticker, toimg, tovideo, tomp3, tovn ke liye)
|
| Optional npm  : sharp, tesseract.js, qrcode, ffmpeg-static
|                 (install na hon to bhi baaqi commands chalti rahengi)
|--------------------------------------------------------------------------
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

let FFMPEG = 'ffmpeg';
try { const p = require('ffmpeg-static'); if (p) FFMPEG = p; } catch (_) { /* system ffmpeg use hoga */ }

let sharp = null;
try { sharp = require('sharp'); } catch (_) { /* optional */ }

const TZ_DEFAULT = 'Asia/Karachi'; // Lahore / Pakistan Standard Time
const FOOT = '\n\n👑 *MEHFOOZ MD*';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ======================================================================
 *  GENERIC HELPERS
 * ==================================================================== */

function cmd(name, fn) {
    return {
        name,
        async execute(ctx) {
            try {
                await fn(ctx);
            } catch (e) {
                console.error(`[MEHFOOZ MD][tools] .${name}:`, e);
                if (e && e.message === 'FFMPEG_MISSING') {
                    return ctx.reply('❌ Is command ke liye server par *ffmpeg* install hona zaroori hai.');
                }
                if (e && /does not contain any stream|Stream map|matches no streams/i.test(e.message || '')) {
                    return ctx.reply('❌ Is file mein audio nahi hai.');
                }
                return ctx.reply(`❌ *.${name}* mein error aaya:\n${String((e && e.message) || e).slice(0, 200)}`);
            }
        }
    };
}

function senderOf(m) { return m.key.participant || m.key.remoteJid; }
function numberOf(jid = '') { return String(jid).split('@')[0].split(':')[0]; }

function unwrap(msg) {
    let x = msg || {};
    for (let i = 0; i < 6; i++) {
        if (x.ephemeralMessage) x = x.ephemeralMessage.message || {};
        else if (x.viewOnceMessage) x = x.viewOnceMessage.message || {};
        else if (x.viewOnceMessageV2) x = x.viewOnceMessageV2.message || {};
        else if (x.viewOnceMessageV2Extension) x = x.viewOnceMessageV2Extension.message || {};
        else if (x.documentWithCaptionMessage) x = x.documentWithCaptionMessage.message || {};
        else break;
    }
    return x || {};
}

function getContextInfo(content) {
    for (const k of Object.keys(content || {})) {
        const ci = content[k] && content[k].contextInfo;
        if (ci) return ci;
    }
    return null;
}

function getQuoted(m) {
    const ci = getContextInfo(unwrap(m.message));
    if (ci && ci.quotedMessage) {
        return { message: unwrap(ci.quotedMessage), sender: ci.participant, id: ci.stanzaId };
    }
    return null;
}

function textOf(content = {}) {
    return content.conversation
        || (content.extendedTextMessage && content.extendedTextMessage.text)
        || (content.imageMessage && content.imageMessage.caption)
        || (content.videoMessage && content.videoMessage.caption)
        || (content.documentMessage && content.documentMessage.caption)
        || '';
}

// args ka text, warna reply kiye gaye message ka text
function inputText(m, args) {
    const t = (args || []).join(' ').trim();
    if (t) return t;
    const q = getQuoted(m);
    return q ? textOf(q.message).trim() : '';
}

// apne message ya reply kiye gaye message mein media dhoondo
function findMedia(m, allowed) {
    const own = unwrap(m.message);
    const q = getQuoted(m);
    for (const src of [own, q && q.message]) {
        if (!src) continue;
        for (const k of allowed) {
            if (src[k]) return { type: k, node: src[k] };
        }
    }
    return null;
}

async function downloadMedia(sock, m, media) {
    const { downloadMediaMessage } = require('@whiskeysockets/baileys');
    return downloadMediaMessage(
        { key: m.key, message: { [media.type]: media.node } },
        'buffer',
        {},
        { reuploadRequest: sock.updateMediaMessage }
    );
}

async function http(url, opts = {}, timeout = 25000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
        const res = await fetch(url, {
            ...opts,
            signal: ctrl.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (MEHFOOZ-MD)', ...(opts.headers || {}) }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
    } finally {
        clearTimeout(t);
    }
}
const httpJson = async (url, opts, timeout) => (await http(url, opts, timeout)).json();
const httpBuffer = async (url, opts, timeout) => Buffer.from(await (await http(url, opts, timeout)).arrayBuffer());

/* ---------------- ffmpeg helpers ---------------- */

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const p = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
        let err = '';
        p.stderr.on('data', (d) => { err += d; });
        p.on('error', (e) => reject(e.code === 'ENOENT' ? new Error('FFMPEG_MISSING') : e));
        p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-300) || 'ffmpeg failed'))));
    });
}

async function convert(buffer, inExt, outExt, buildArgs) {
    const id = crypto.randomBytes(6).toString('hex');
    const inp = path.join(os.tmpdir(), `mm_${id}.${inExt}`);
    const out = path.join(os.tmpdir(), `mm_${id}_out.${outExt}`);
    fs.writeFileSync(inp, buffer);
    try {
        await runFfmpeg(buildArgs(inp, out));
        return fs.readFileSync(out);
    } finally {
        for (const f of [inp, out]) { try { fs.unlinkSync(f); } catch (_) { /* ignore */ } }
    }
}

/* ======================================================================
 *  1) STICKER / TOIMG / TOVIDEO / TOMP3 / TOVN
 * ==================================================================== */

async function makeSticker(buffer, isVideo) {
    const attempts = isVideo
        ? [{ q: 50, s: 512 }, { q: 35, s: 400 }, { q: 25, s: 320 }]
        : [{ q: 80, s: 512 }];
    let last;
    for (const a of attempts) {
        const vf = `scale=${a.s}:${a.s}:force_original_aspect_ratio=decrease${isVideo ? ',fps=15' : ''},`
            + 'format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0,format=yuva420p';
        last = await convert(buffer, 'bin', 'webp', (i, o) => [
            '-i', i, '-vf', vf,
            '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(a.q),
            '-compression_level', '6', '-loop', '0', '-an',
            ...(isVideo ? ['-t', '8'] : ['-frames:v', '1']),
            o
        ]);
        if (!isVideo || last.length <= 1000 * 1024) return last; // WhatsApp limit ~1MB (animated)
    }
    return last;
}

function isAnimatedWebp(buf) { return buf.subarray(0, 300).includes('ANIM'); }

async function webpToPng(buf) {
    if (sharp) {
        try { return await sharp(buf).png().toBuffer(); } catch (_) { /* ffmpeg try karo */ }
    }
    return convert(buf, 'webp', 'png', (i, o) => ['-i', i, '-frames:v', '1', o]);
}

/* ======================================================================
 *  2) OCR / TRANSLATE / TTS / SHORTLINK
 * ==================================================================== */

async function runOcr(buffer, lang) {
    let Tesseract = null;
    try { Tesseract = require('tesseract.js'); } catch (_) { /* API use hogi */ }
    if (Tesseract) {
        const { data } = await Tesseract.recognize(buffer, lang);
        return data.text || '';
    }
    const fd = new FormData();
    fd.append('apikey', process.env.OCR_API_KEY || 'helloworld');
    fd.append('language', lang);
    fd.append('OCREngine', '2');
    fd.append('file', new Blob([buffer], { type: 'image/jpeg' }), 'image.jpg');
    const j = await httpJson('https://api.ocr.space/parse/image', { method: 'POST', body: fd }, 60000);
    if (j.IsErroredOnProcessing) throw new Error(([].concat(j.ErrorMessage || 'OCR failed'))[0]);
    return (j.ParsedResults || []).map((r) => r.ParsedText).join('\n');
}

const LANGS = {
    english: 'en', urdu: 'ur', hindi: 'hi', arabic: 'ar', punjabi: 'pa', sindhi: 'sd',
    pashto: 'ps', persian: 'fa', farsi: 'fa', french: 'fr', german: 'de', spanish: 'es',
    turkish: 'tr', chinese: 'zh-CN', japanese: 'ja', korean: 'ko', russian: 'ru',
    italian: 'it', bengali: 'bn', indonesian: 'id', portuguese: 'pt'
};

function parseLang(tok, strict) {
    if (!tok) return null;
    const t = tok.toLowerCase();
    if (LANGS[t]) return LANGS[t];
    if (/^[a-z]{2}(-[a-z]{2,4})?$/i.test(t) && (!strict || t.length <= 5)) {
        return t.includes('-') ? t.split('-')[0] + '-' + t.split('-')[1].toUpperCase() : t;
    }
    return null;
}

async function translate(text, to) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl='
        + encodeURIComponent(to) + '&dt=t&q=' + encodeURIComponent(text);
    const j = await httpJson(url);
    return { text: (j[0] || []).map((x) => x[0]).join(''), from: j[2] };
}

function splitChunks(text, max = 190) {
    const words = text.split(/\s+/);
    const chunks = [];
    let cur = '';
    for (const w of words) {
        if ((cur + ' ' + w).trim().length > max) {
            if (cur) chunks.push(cur);
            cur = w.length > max ? w.slice(0, max) : w;
        } else {
            cur = (cur + ' ' + w).trim();
        }
    }
    if (cur) chunks.push(cur);
    return chunks;
}

async function googleTts(text, lang) {
    const bufs = [];
    for (const chunk of splitChunks(text)) {
        const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl='
            + encodeURIComponent(lang) + '&q=' + encodeURIComponent(chunk);
        bufs.push(await httpBuffer(url));
    }
    return Buffer.concat(bufs);
}

function guessLang(text) {
    if (/[\u0600-\u06FF]/.test(text)) return 'ur';
    if (/[\u0900-\u097F]/.test(text)) return 'hi';
    return 'en';
}

/* ======================================================================
 *  3) CALC (safe parser - eval use nahi hota)
 * ==================================================================== */

function calc(expr) {
    const s = String(expr).toLowerCase()
        .replace(/×/g, '*').replace(/÷/g, '/').replace(/\*\*/g, '^').replace(/[,\s]/g, '');
    if (!s || s.length > 200) throw new Error('Expression sahi nahi hai.');
    let i = 0;
    const CONST = { pi: Math.PI, e: Math.E };
    const rad = (x) => (x * Math.PI) / 180;
    const FN = {
        sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
        log: Math.log10, ln: Math.log,
        sin: (x) => Math.sin(rad(x)), cos: (x) => Math.cos(rad(x)), tan: (x) => Math.tan(rad(x))
    };

    function primary() {
        let mt;
        if (s[i] === '(') {
            i++;
            const v = sum();
            if (s[i] !== ')') throw new Error('Bracket band nahi hua.');
            i++;
            return v;
        }
        if ((mt = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i)))) {
            i += mt[0].length;
            return parseFloat(mt[0]);
        }
        if ((mt = /^[a-z]+/.exec(s.slice(i)))) {
            const name = mt[0];
            i += name.length;
            if (name in CONST) return CONST[name];
            if (name in FN && s[i] === '(') {
                i++;
                const v = sum();
                if (s[i] !== ')') throw new Error('Bracket band nahi hua.');
                i++;
                return FN[name](v);
            }
            throw new Error(`"${name}" samajh nahi aaya.`);
        }
        throw new Error('Expression sahi nahi hai.');
    }
    function pow() {
        const b = primary();
        if (s[i] === '^') { i++; return Math.pow(b, unary()); }
        return b;
    }
    function unary() {
        if (s[i] === '-') { i++; return -unary(); }
        if (s[i] === '+') { i++; return unary(); }
        return pow();
    }
    function term() {
        let v = unary();
        while (s[i] === '*' || s[i] === '/' || s[i] === '%') {
            const op = s[i++];
            const r = unary();
            v = op === '*' ? v * r : op === '/' ? v / r : v % r;
        }
        return v;
    }
    function sum() {
        let v = term();
        while (s[i] === '+' || s[i] === '-') {
            const op = s[i++];
            const r = term();
            v = op === '+' ? v + r : v - r;
        }
        return v;
    }

    const result = sum();
    if (i !== s.length) throw new Error('Expression sahi nahi hai.');
    if (!Number.isFinite(result)) throw new Error('Result finite nahi hai (zero se taqseem?).');
    return Number(result.toPrecision(14));
}

/* ======================================================================
 *  4) REMINDER / TIMER / NOTES
 * ==================================================================== */

function parseDuration(tok, bareUnitMs) {
    if (!tok) return null;
    const s = tok.toLowerCase();
    if (/^\d+$/.test(s)) return bareUnitMs ? Number(s) * bareUnitMs : null;
    if (!/^(\d+[dhms])+$/.test(s)) return null;
    let ms = 0;
    s.replace(/(\d+)([dhms])/g, (_, n, u) => { ms += Number(n) * { d: 864e5, h: 36e5, m: 6e4, s: 1e3 }[u]; return ''; });
    return ms;
}

function fmtDur(ms) {
    let s = Math.round(ms / 1000);
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const mi = Math.floor(s / 60); s %= 60;
    return [d && `${d}d`, h && `${h}h`, mi && `${mi}m`, (s || (!d && !h && !mi)) && `${s}s`].filter(Boolean).join(' ');
}

const MAX_TIMER_MS = 24 * 864e5; // setTimeout limit ke andar

const NOTES_FILE = path.join(process.cwd(), 'data', 'mehfooz-notes.json');
function loadNotes() {
    try { return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')); } catch (_) { return {}; }
}
function saveNotes(data) {
    fs.mkdirSync(path.dirname(NOTES_FILE), { recursive: true });
    fs.writeFileSync(NOTES_FILE, JSON.stringify(data, null, 2));
}

/* ======================================================================
 *  5) QR / SS
 * ==================================================================== */

async function makeQR(text) {
    try {
        const QR = require('qrcode');
        return await QR.toBuffer(text, { width: 512, margin: 2 });
    } catch (_) {
        return httpBuffer('https://api.qrserver.com/v1/create-qr-code/?size=512x512&margin=10&data=' + encodeURIComponent(text));
    }
}

function normalizeUrl(u) {
    let x = String(u || '').trim();
    if (!x) return null;
    if (!/^https?:\/\//i.test(x)) x = 'https://' + x;
    try { return new URL(x).href; } catch (_) { return null; }
}

/* ======================================================================
 *  6) PDF  (dependency-free writer)
 * ==================================================================== */

function assemblePdf(bodies) {
    const head = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1');
    const parts = [head];
    const offsets = [];
    let pos = head.length;
    bodies.forEach((b, i) => {
        const a = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
        const body = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1');
        const z = Buffer.from('\nendobj\n', 'latin1');
        offsets.push(pos);
        parts.push(a, body, z);
        pos += a.length + body.length + z.length;
    });
    let xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach((o) => { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
    xref += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF`;
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
}

function normalizeLatin(text) {
    return text
        .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/\u2022/g, '*')
        .replace(/\t/g, '    ').replace(/\r/g, '');
}

function textToPdf(text) {
    const clean = normalizeLatin(text);
    const maxChars = 80, linesPerPage = 48;
    const lines = [];
    for (const para of clean.split('\n')) {
        if (!para.trim()) { lines.push(''); continue; }
        let cur = '';
        for (const w of para.split(' ')) {
            if ((cur + ' ' + w).trim().length > maxChars) {
                if (cur) lines.push(cur);
                let word = w;
                while (word.length > maxChars) { lines.push(word.slice(0, maxChars)); word = word.slice(maxChars); }
                cur = word;
            } else {
                cur = (cur + ' ' + w).trim();
            }
        }
        lines.push(cur);
    }
    const pages = [];
    for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage));
    if (!pages.length) pages.push(['']);

    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const bodies = [];
    bodies[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    bodies[1] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`;
    bodies[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    pages.forEach((pl, i) => {
        const stream = 'BT /F1 11 Tf 15 TL 50 792 Td\n'
            + pl.map((l) => `(${esc(l)}) Tj T*`).join('\n') + '\nET';
        bodies[3 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
        bodies[4 + i * 2] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
    });
    return assemblePdf(bodies);
}

function jpegInfo(buf) {
    if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
    let i = 2;
    while (i + 9 < buf.length) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const mk = buf[i + 1];
        if (mk === 0xFF) { i++; continue; }
        if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) {
            return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), comps: buf[i + 9] };
        }
        i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
}

async function ensureJpeg(buf) {
    const info = jpegInfo(buf);
    if (info && info.comps === 3) return buf;
    if (sharp) {
        try { return await sharp(buf).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer(); } catch (_) { /* ffmpeg */ }
    }
    return convert(buf, 'bin', 'jpg', (i, o) => ['-i', i, '-frames:v', '1', '-q:v', '2', '-pix_fmt', 'yuvj420p', o]);
}

function imageToPdf(jpg) {
    const info = jpegInfo(jpg);
    if (!info || info.comps !== 3) throw new Error('Image format support nahi hua.');
    const k = Math.min(842 / Math.max(info.w, info.h), 595 / Math.min(info.w, info.h)); // A4 ke andar fit
    const W = Math.max(50, Math.round(info.w * k));
    const H = Math.max(50, Math.round(info.h * k));
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    const imgHead = Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${info.w} /Height ${info.h} /ColorSpace /DeviceRGB `
        + `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, 'latin1');
    return assemblePdf([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
        Buffer.concat([imgHead, jpg, Buffer.from('\nendstream', 'latin1')]),
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    ]);
}

/* ======================================================================
 *  7) TIME / CALENDAR
 * ==================================================================== */

const TZ_ALIASES = {
    lahore: 'Asia/Karachi', karachi: 'Asia/Karachi', islamabad: 'Asia/Karachi', pakistan: 'Asia/Karachi',
    dubai: 'Asia/Dubai', makkah: 'Asia/Riyadh', mecca: 'Asia/Riyadh', riyadh: 'Asia/Riyadh',
    delhi: 'Asia/Kolkata', india: 'Asia/Kolkata', dhaka: 'Asia/Dhaka', london: 'Europe/London',
    paris: 'Europe/Paris', newyork: 'America/New_York', ny: 'America/New_York',
    la: 'America/Los_Angeles', tokyo: 'Asia/Tokyo', istanbul: 'Europe/Istanbul', sydney: 'Australia/Sydney'
};

function nowIn(tz) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    const o = {};
    parts.forEach((p) => { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second };
}

function hijriNow(tz) {
    try {
        return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
            timeZone: tz, day: 'numeric', month: 'long', year: 'numeric'
        }).format(new Date());
    } catch (_) { return null; }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function buildCalendar(y, mo, today) {
    const first = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; // Monday first
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const title = `${MONTHS[mo - 1].toUpperCase()} ${y}`;
    let out = ' '.repeat(Math.max(0, Math.floor((28 - title.length) / 2))) + title + '\n';
    out += ' Mo  Tu  We  Th  Fr  Sa  Su\n';
    let row = ' '.repeat(first * 4);
    for (let d = 1; d <= days; d++) {
        const isToday = today && today.y === y && today.mo === mo && today.d === d;
        row += isToday ? `[${String(d).padStart(2, ' ')}]` : ` ${String(d).padStart(2, ' ')} `;
        if ((first + d) % 7 === 0) { out += row.trimEnd() + '\n'; row = ''; }
    }
    if (row.trim()) out += row.trimEnd() + '\n';
    return out;
}

/* ======================================================================
 *  8) SYSTEM
 * ==================================================================== */

const fmtBytes = (b) => {
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toFixed(i ? 2 : 0)} ${u[i]}`;
};

function fmtUptime(sec) {
    sec = Math.floor(sec);
    const d = Math.floor(sec / 86400); sec %= 86400;
    const h = Math.floor(sec / 3600); sec %= 3600;
    const mi = Math.floor(sec / 60);
    return `${d}d ${h}h ${mi}m ${sec % 60}s`;
}

function cpuTimes() {
    return os.cpus().reduce((a, c) => {
        const t = c.times;
        return { idle: a.idle + t.idle, total: a.total + t.user + t.nice + t.sys + t.idle + t.irq };
    }, { idle: 0, total: 0 });
}

/* ======================================================================
 *  9) ENCODERS
 * ==================================================================== */

function codecMode(args) {
    const first = (args[0] || '').toLowerCase();
    if (['encode', 'enc', 'e'].includes(first)) return { mode: 'encode', rest: args.slice(1) };
    if (['decode', 'dec', 'd'].includes(first)) return { mode: 'decode', rest: args.slice(1) };
    return { mode: null, rest: args };
}

/* ======================================================================
 *  COMMAND DEFINITIONS
 * ==================================================================== */

const toolCommands = [];
const add = (name, fn) => toolCommands.push(cmd(name, fn));

/* ---------------- .sticker ---------------- */
add('sticker', async ({ sock, m, reply }) => {
    const media = findMedia(m, ['imageMessage', 'videoMessage', 'stickerMessage']);
    if (!media) {
        return reply('⚠️ Kisi *image / video / gif* par reply karke *.sticker* likhein.\n(Ya image ke caption mein .sticker likh kar bhejein.)');
    }
    const isVideo = media.type === 'videoMessage';
    if (isVideo && (media.node.seconds || 0) > 20) return reply('⚠️ Video 20 second se chhoti honi chahiye.');
    await reply('⏳ Sticker ban raha hai...');
    const buf = await downloadMedia(sock, m, media);
    const webp = media.type === 'stickerMessage' ? buf : await makeSticker(buf, isVideo);
    await sock.sendMessage(m.key.remoteJid, { sticker: webp }, { quoted: m });
});

/* ---------------- .toimg ---------------- */
add('toimg', async ({ sock, m, reply }) => {
    const media = findMedia(m, ['stickerMessage']);
    if (!media) return reply('⚠️ Kisi *sticker* par reply karke *.toimg* likhein.');
    const buf = await downloadMedia(sock, m, media);
    const png = await webpToPng(buf);
    await sock.sendMessage(m.key.remoteJid, { image: png, caption: '✅ Sticker → Image' + FOOT }, { quoted: m });
});

/* ---------------- .tovideo ---------------- */
add('tovideo', async ({ sock, m, reply }) => {
    const media = findMedia(m, ['stickerMessage']);
    if (!media) return reply('⚠️ Kisi *sticker* par reply karke *.tovideo* likhein.');
    await reply('⏳ Video ban rahi hai...');
    const buf = await downloadMedia(sock, m, media);
    let mp4;
    if (isAnimatedWebp(buf)) {
        if (!sharp) throw new Error('Animated sticker ko video banane ke liye server par "npm i sharp" chahiye.');
        const gif = await sharp(buf, { animated: true }).gif().toBuffer();
        mp4 = await convert(gif, 'gif', 'mp4', (i, o) => [
            '-i', i, '-movflags', 'faststart', '-pix_fmt', 'yuv420p',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', o
        ]);
    } else {
        const png = await webpToPng(buf);
        mp4 = await convert(png, 'png', 'mp4', (i, o) => [
            '-loop', '1', '-i', i, '-t', '3', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', 'faststart', o
        ]);
    }
    await sock.sendMessage(m.key.remoteJid, { video: mp4, mimetype: 'video/mp4', caption: '✅ Sticker → Video' + FOOT }, { quoted: m });
});

/* ---------------- .tomp3 ---------------- */
add('tomp3', async ({ sock, m, reply }) => {
    const media = findMedia(m, ['videoMessage', 'audioMessage', 'documentMessage']);
    if (!media) return reply('⚠️ Kisi *video ya audio* par reply karke *.tomp3* likhein.');
    await reply('⏳ MP3 ban rahi hai...');
    const buf = await downloadMedia(sock, m, media);
    const mp3 = await convert(buf, 'bin', 'mp3', (i, o) => ['-i', i, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '128k', o]);
    await sock.sendMessage(m.key.remoteJid, { audio: mp3, mimetype: 'audio/mpeg' }, { quoted: m });
});

/* ---------------- .tovn ---------------- */
add('tovn', async ({ sock, m, reply }) => {
    const media = findMedia(m, ['audioMessage', 'videoMessage', 'documentMessage']);
    if (!media) return reply('⚠️ Kisi *audio ya video* par reply karke *.tovn* likhein.');
    await reply('⏳ Voice note ban raha hai...');
    const buf = await downloadMedia(sock, m, media);
    const opus = await convert(buf, 'bin', 'ogg', (i, o) => [
        '-i', i, '-vn', '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '1', '-f', 'ogg', o
    ]);
    await sock.sendMessage(m.key.remoteJid, { audio: opus, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: m });
});

/* ---------------- .ocr ---------------- */
add('ocr', async ({ sock, m, args, reply }) => {
    const media = findMedia(m, ['imageMessage', 'stickerMessage']);
    if (!media) return reply('⚠️ Kisi *image* par reply karke *.ocr* likhein.\nUrdu ke liye: *.ocr urd*  |  Arabic: *.ocr ara*  |  Hindi: *.ocr hin*');
    const lang = (args[0] || 'eng').toLowerCase();
    await reply('🔎 Text padha ja raha hai...');
    const buf = await downloadMedia(sock, m, media);
    const text = (await runOcr(buf, lang)).trim();
    if (!text) return reply('⚠️ Image mein koi text nahi mila.');
    return reply(`🔎 *OCR RESULT*\n\n${text}${FOOT}`);
});

/* ---------------- .tr ---------------- */
add('tr', async ({ m, args, reply }) => {
    let to = parseLang(args[0], true);
    let text;
    if (to) {
        text = inputText(m, args.slice(1));
    } else {
        to = 'ur'; // language na likhi ho to Urdu
        text = inputText(m, args);
    }
    if (!text) {
        return reply('⚠️ Istemal:\n*.tr en Aap kaise hain*\n*.tr ur How are you*\n(ya kisi message par reply karke *.tr ur*)\n\nLanguages: en, ur, hi, ar, pa, fr, de, es, tr, zh, ja ...');
    }
    const r = await translate(text, to);
    return reply(`🌐 *TRANSLATE* (${r.from || 'auto'} → ${to})\n\n${r.text}${FOOT}`);
});

/* ---------------- .tts ---------------- */
add('tts', async ({ sock, m, args, reply }) => {
    let lang = parseLang(args[0], true);
    let text = lang ? inputText(m, args.slice(1)) : inputText(m, args);
    if (!text) return reply('⚠️ Istemal:\n*.tts Assalam o Alaikum*\n*.tts en Hello my friend*\n(ya kisi message par reply karke *.tts*)');
    if (!lang) lang = guessLang(text);
    if (text.length > 600) text = text.slice(0, 600);
    const audio = await googleTts(text, lang);
    await sock.sendMessage(m.key.remoteJid, { audio, mimetype: 'audio/mpeg', ptt: false }, { quoted: m });
});

/* ---------------- .shortlink ---------------- */
add('shortlink', async ({ m, args, reply }) => {
    const url = normalizeUrl(inputText(m, args));
    if (!url) return reply('⚠️ Istemal: *.shortlink https://example.com/long/link*');
    let short;
    try {
        short = (await (await http('https://is.gd/create.php?format=simple&url=' + encodeURIComponent(url))).text()).trim();
        if (!/^https?:\/\//.test(short)) throw new Error('bad');
    } catch (_) {
        short = (await (await http('https://tinyurl.com/api-create.php?url=' + encodeURIComponent(url))).text()).trim();
    }
    return reply(`🔗 *SHORT LINK*\n\n📎 Original: ${url}\n✂️ Short: ${short}${FOOT}`);
});

/* ---------------- .calc ---------------- */
add('calc', async ({ m, args, reply }) => {
    const expr = inputText(m, args);
    if (!expr) return reply('⚠️ Istemal: *.calc 25*4+10/2*\nSupport: + - * / % ^ ( ) sqrt() abs() round() sin() cos() tan() log() ln() pi e');
    let result;
    try { result = calc(expr); } catch (e) { return reply(`❌ ${e.message}`); }
    return reply(`🧮 *CALCULATOR*\n\n📝 ${expr}\n✅ *= ${result}*${FOOT}`);
});

/* ---------------- .weather ---------------- */
add('weather', async ({ m, args, reply }) => {
    const city = inputText(m, args) || 'Lahore';
    const j = await httpJson(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    const c = j.current_condition[0];
    const a = (j.nearest_area && j.nearest_area[0]) || {};
    const place = [a.areaName && a.areaName[0].value, a.country && a.country[0].value].filter(Boolean).join(', ') || city;
    const days = (j.weather || []).slice(0, 3)
        .map((d) => `• ${d.date}: ${d.mintempC}°C ~ ${d.maxtempC}°C`).join('\n');
    return reply(
        `🌤️ *WEATHER - ${place}*\n\n` +
        `🌡️ Temperature: ${c.temp_C}°C (Feels ${c.FeelsLikeC}°C)\n` +
        `☁️ Haal: ${c.weatherDesc[0].value}\n` +
        `💧 Humidity: ${c.humidity}%\n` +
        `💨 Hawa: ${c.windspeedKmph} km/h (${c.winddir16Point})\n` +
        `👁️ Visibility: ${c.visibility} km\n` +
        `🔆 UV Index: ${c.uvIndex}\n` +
        `🧭 Pressure: ${c.pressure} hPa\n\n` +
        `📅 *3 Din:*\n${days}${FOOT}`
    );
});

/* ---------------- .reminder ---------------- */
add('reminder', async ({ sock, m, args, reply }) => {
    const ms = parseDuration(args[0]);
    if (!ms) return reply('⚠️ Istemal: *.reminder 10m Paani peena*\nWaqt: 30s, 10m, 2h, 1d, 1h30m');
    if (ms < 1000 || ms > MAX_TIMER_MS) return reply('⚠️ Waqt 1 second se 24 din ke darmiyan hona chahiye.');
    const text = inputText(m, args.slice(1)) || 'Yaad dahani!';
    const jid = m.key.remoteJid;
    const sender = senderOf(m);
    setTimeout(() => {
        sock.sendMessage(jid, {
            text: `⏰ *REMINDER*\n\n@${numberOf(sender)}\n📝 ${text}${FOOT}`,
            mentions: [sender]
        }).catch(() => {});
    }, ms);
    return reply(`✅ *Reminder set!*\n\n⏳ ${fmtDur(ms)} baad yaad dilaunga.\n📝 ${text}\n\n⚠️ Bot restart hone par reminders khatam ho jate hain.`);
});

/* ---------------- .notes / .listnotes / .delnote ---------------- */
add('notes', async ({ m, args, reply }) => {
    const text = inputText(m, args);
    if (!text) return reply('⚠️ Istemal: *.notes Kal meeting hai 5 baje*\nSaari notes dekhne ke liye: *.listnotes*\nDelete: *.delnote 1*');
    const all = loadNotes();
    const key = numberOf(senderOf(m));
    all[key] = all[key] || [];
    all[key].push({ text, date: new Date().toISOString() });
    saveNotes(all);
    return reply(`📝 *Note save ho gaya!* (#${all[key].length})\n\n${text}${FOOT}`);
});

add('listnotes', async ({ m, reply }) => {
    const list = loadNotes()[numberOf(senderOf(m))] || [];
    if (!list.length) return reply('📭 Aapki koi note nahi hai.\n*.notes <text>* se note banayein.');
    const body = list.map((n, i) => `*${i + 1}.* ${n.text}`).join('\n\n');
    return reply(`📒 *AAPKI NOTES (${list.length})*\n\n${body}${FOOT}`);
});

add('delnote', async ({ m, args, reply }) => {
    const all = loadNotes();
    const key = numberOf(senderOf(m));
    const list = all[key] || [];
    const a = (args[0] || '').toLowerCase();
    if (!a) return reply('⚠️ Istemal: *.delnote 2*  ya  *.delnote all*');
    if (a === 'all') {
        all[key] = [];
        saveNotes(all);
        return reply('🗑️ Aapki saari notes delete ho gayin.');
    }
    const n = parseInt(a, 10);
    if (!n || n < 1 || n > list.length) return reply('❌ Note number galat hai. *.listnotes* se number dekhein.');
    const [removed] = list.splice(n - 1, 1);
    all[key] = list;
    saveNotes(all);
    return reply(`🗑️ Note #${n} delete ho gaya:\n${removed.text}`);
});

/* ---------------- .qr ---------------- */
add('qr', async ({ sock, m, args, reply }) => {
    const text = inputText(m, args);
    if (!text) return reply('⚠️ Istemal: *.qr https://example.com*  ya  *.qr koi bhi message*');
    const png = await makeQR(text);
    await sock.sendMessage(m.key.remoteJid, { image: png, caption: `✅ *QR Code tayyar*\n\n📝 ${text.slice(0, 200)}${FOOT}` }, { quoted: m });
});

/* ---------------- .readqr ---------------- */
add('readqr', async ({ sock, m, reply }) => {
    const media = findMedia(m, ['imageMessage', 'stickerMessage']);
    if (!media) return reply('⚠️ Kisi *QR code ki image* par reply karke *.readqr* likhein.');
    let buf = await downloadMedia(sock, m, media);
    if (media.type === 'stickerMessage') buf = await webpToPng(buf);
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: media.type === 'stickerMessage' ? 'image/png' : 'image/jpeg' }), 'qr.jpg');
    const j = await httpJson('https://api.qrserver.com/v1/read-qr-code/', { method: 'POST', body: fd }, 30000);
    const data = j && j[0] && j[0].symbol && j[0].symbol[0] && j[0].symbol[0].data;
    if (!data) return reply('❌ Is image mein QR code nahi mila (ya saaf nazar nahi aa raha).');
    return reply(`🔍 *QR KA MESSAGE*\n\n${data}${FOOT}`);
});

/* ---------------- .ss ---------------- */
add('ss', async ({ sock, m, args, reply }) => {
    const url = normalizeUrl(inputText(m, args));
    if (!url) return reply('⚠️ Istemal: *.ss https://google.com*');
    await reply('📸 Screenshot le raha hoon...');
    let img;
    try {
        img = await httpBuffer('https://image.thum.io/get/width/1280/crop/800/noanimate/' + url, {}, 45000);
    } catch (_) {
        img = await httpBuffer('https://api.microlink.io/?screenshot=true&meta=false&embed=screenshot.url&url=' + encodeURIComponent(url), {}, 60000);
    }
    await sock.sendMessage(m.key.remoteJid, { image: img, caption: `📸 *SCREENSHOT*\n🌐 ${url}${FOOT}` }, { quoted: m });
});

/* ---------------- .pdf ---------------- */
add('pdf', async ({ sock, m, args, reply }) => {
    const jid = m.key.remoteJid;
    let media = findMedia(m, ['imageMessage', 'documentMessage']);
    if (media && media.type === 'documentMessage' && !String(media.node.mimetype || '').startsWith('image/')) media = null;

    if (media) {
        await reply('⏳ Image se PDF ban rahi hai...');
        const buf = await downloadMedia(sock, m, media);
        const pdf = imageToPdf(await ensureJpeg(buf));
        return sock.sendMessage(jid, {
            document: pdf, mimetype: 'application/pdf',
            fileName: `MEHFOOZ_MD_${Date.now()}.pdf`, caption: '✅ Image → PDF' + FOOT
        }, { quoted: m });
    }

    const text = inputText(m, args);
    if (!text) return reply('⚠️ Istemal:\n• *.pdf aapka message* likhein\n• ya kisi *message* par reply karke *.pdf*\n• ya kisi *image* par reply karke *.pdf*');
    if (/[\u0600-\u06FF\u0900-\u097F]/.test(text)) {
        return reply('⚠️ Urdu/Arabic/Hindi text ka PDF abhi support nahi (font shaping chahiye). English text ya image ka PDF ban sakta hai.');
    }
    const pdf = textToPdf(text);
    return sock.sendMessage(jid, {
        document: pdf, mimetype: 'application/pdf',
        fileName: `MEHFOOZ_MD_${Date.now()}.pdf`, caption: '✅ Text → PDF' + FOOT
    }, { quoted: m });
});

/* ---------------- .info ---------------- */
add('info', async ({ reply, db, prefix }) => {
    const mem = process.memoryUsage();
    const t = nowIn(TZ_DEFAULT);
    const pad = (n) => String(n).padStart(2, '0');
    return reply(
        `🤖 *${(db && db.botName) || 'MEHFOOZ MD'} - BOT INFO*\n\n` +
        `👤 Owner: ${(db && db.ownerName) || 'MEHFOOZ MD Owner'}\n` +
        `⚡ Prefix: [ ${prefix || '.'} ]\n` +
        `⏱️ Uptime: ${fmtUptime(process.uptime())}\n` +
        `🟢 Node.js: ${process.version}\n` +
        `💻 Platform: ${os.platform()} (${os.arch()})\n` +
        `🧠 RAM (bot): ${fmtBytes(mem.rss)}\n` +
        `🕒 Waqt (Lahore): ${pad(t.h)}:${pad(t.mi)}:${pad(t.s)}  ${pad(t.d)}-${pad(t.mo)}-${t.y}${FOOT}`
    );
});

/* ---------------- .runtime ---------------- */
add('runtime', async ({ reply }) => reply(`⏱️ *BOT RUNTIME*\n\n🟢 Bot ko chalte hue: *${fmtUptime(process.uptime())}*${FOOT}`));

/* ---------------- .speed ---------------- */
add('speed', async ({ sock, m, reply }) => {
    const t0 = process.hrtime.bigint();
    await sock.sendMessage(m.key.remoteJid, { text: '⚡ Speed test...' }, { quoted: m });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const rating = ms < 300 ? '🚀 Bohat tez' : ms < 800 ? '✅ Theek' : '🐢 Slow';
    return reply(`⚡ *SPEED*\n\n📡 Response: *${ms.toFixed(0)} ms*\n${rating}${FOOT}`);
});

/* ---------------- .cpu ---------------- */
add('cpu', async ({ reply }) => {
    const a = cpuTimes();
    await sleep(500);
    const b = cpuTimes();
    const usage = b.total - a.total > 0 ? 100 - (100 * (b.idle - a.idle)) / (b.total - a.total) : 0;
    const cpus = os.cpus();
    const la = os.loadavg().map((x) => x.toFixed(2)).join(' / ');
    return reply(
        `🖥️ *CPU INFO*\n\n` +
        `🔧 Model: ${cpus[0] ? cpus[0].model.trim() : 'unknown'}\n` +
        `🧮 Cores: ${cpus.length}\n` +
        `📊 Usage: ${usage.toFixed(1)}%\n` +
        `📈 Load (1/5/15m): ${la}${FOOT}`
    );
});

/* ---------------- .ram ---------------- */
add('ram', async ({ reply }) => {
    const total = os.totalmem(), free = os.freemem(), used = total - free;
    const mem = process.memoryUsage();
    return reply(
        `🧠 *RAM INFO*\n\n` +
        `💾 Total: ${fmtBytes(total)}\n` +
        `🔴 Used: ${fmtBytes(used)} (${((used / total) * 100).toFixed(1)}%)\n` +
        `🟢 Free: ${fmtBytes(free)}\n\n` +
        `🤖 *Bot process:*\n• RSS: ${fmtBytes(mem.rss)}\n• Heap: ${fmtBytes(mem.heapUsed)} / ${fmtBytes(mem.heapTotal)}${FOOT}`
    );
});

/* ---------------- .temp ---------------- */
add('temp', async ({ reply }) => {
    const temps = [];
    try {
        const base = '/sys/class/thermal';
        for (const z of fs.readdirSync(base).filter((x) => x.startsWith('thermal_zone'))) {
            try {
                const v = parseInt(fs.readFileSync(path.join(base, z, 'temp'), 'utf8'), 10);
                let type = z;
                try { type = fs.readFileSync(path.join(base, z, 'type'), 'utf8').trim(); } catch (_) { /* ignore */ }
                if (Number.isFinite(v)) temps.push(`• ${type}: ${(v / 1000).toFixed(1)}°C`);
            } catch (_) { /* skip zone */ }
        }
    } catch (_) { /* no sensors */ }
    if (!temps.length) return reply('🌡️ Is server/host par temperature sensor available nahi hai.');
    return reply(`🌡️ *TEMPERATURE*\n\n${temps.join('\n')}${FOOT}`);
});

/* ---------------- .whois ---------------- */
add('whois', async ({ sock, m, args, reply }) => {
    const jid = m.key.remoteJid;
    const ci = getContextInfo(unwrap(m.message)) || {};
    const mentioned = (ci.mentionedJid || [])[0];
    const quotedSender = ci.quotedMessage ? ci.participant : null;

    // domain whois
    const dom = (args[0] || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (!mentioned && !quotedSender && /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(dom)) {
        const j = await httpJson('https://rdap.org/domain/' + dom, {}, 30000);
        const ev = (a) => ((j.events || []).find((e) => e.eventAction === a) || {}).eventDate;
        const reg = (j.entities || []).find((e) => (e.roles || []).includes('registrar'));
        let regName = null;
        try { regName = reg.vcardArray[1].find((x) => x[0] === 'fn')[3]; } catch (_) { /* ignore */ }
        const ns = (j.nameservers || []).map((n) => n.ldhName).join(', ');
        return reply(
            `🌐 *WHOIS - ${dom}*\n\n` +
            `📌 Status: ${(j.status || []).join(', ') || 'N/A'}\n` +
            `🏢 Registrar: ${regName || 'N/A'}\n` +
            `📅 Registered: ${ev('registration') || 'N/A'}\n` +
            `⌛ Expires: ${ev('expiration') || 'N/A'}\n` +
            `🔄 Updated: ${ev('last changed') || 'N/A'}\n` +
            `🖧 Nameservers: ${ns || 'N/A'}${FOOT}`
        );
    }

    // WhatsApp user whois
    const target = mentioned || quotedSender || senderOf(m);
    const num = numberOf(target);
    let about = 'N/A', role = null, ppUrl = null;
    try {
        const st = await sock.fetchStatus(target);
        const s = Array.isArray(st) ? (st[0] && (st[0].status && st[0].status.status || st[0].status)) : (st && (st.status && st.status.status || st.status));
        if (typeof s === 'string' && s) about = s;
    } catch (_) { /* privacy */ }
    try { ppUrl = await sock.profilePictureUrl(target, 'image'); } catch (_) { /* no pp */ }
    if (jid.endsWith('@g.us')) {
        try {
            const meta = await sock.groupMetadata(jid);
            const p = meta.participants.find((x) => numberOf(x.id) === num);
            role = p ? (p.admin === 'superadmin' ? 'Group Owner' : p.admin === 'admin' ? 'Admin' : 'Member') : 'Group mein nahi';
        } catch (_) { /* ignore */ }
    }
    const isSelf = target === senderOf(m);
    const caption =
        `👤 *WHOIS*\n\n` +
        (isSelf && m.pushName ? `📛 Naam: ${m.pushName}\n` : '') +
        `📞 Number: +${num}\n` +
        `🆔 JID: ${target}\n` +
        `💬 About: ${about}\n` +
        (role ? `🎖️ Group role: ${role}\n` : '') +
        `🖼️ Profile pic: ${ppUrl ? 'Available' : 'Nahi / private'}${FOOT}`;
    if (ppUrl) {
        return sock.sendMessage(jid, { image: { url: ppUrl }, caption, mentions: [target] }, { quoted: m });
    }
    return sock.sendMessage(jid, { text: caption, mentions: [target] }, { quoted: m });
});

/* ---------------- .ipinfo ---------------- */
add('ipinfo', async ({ m, args, reply }) => {
    const ip = (inputText(m, args) || '').trim();
    const j = await httpJson('https://ipwho.is/' + encodeURIComponent(ip));
    if (!j.success) return reply(`❌ IP ki maloomat nahi mili${j.message ? ': ' + j.message : ''}.`);
    return reply(
        `🌍 *IP INFO*${ip ? '' : ' (bot server)'}\n\n` +
        `🔢 IP: ${j.ip} (${j.type})\n` +
        `🏳️ Country: ${j.country} ${(j.flag && j.flag.emoji) || ''}\n` +
        `🏙️ Region/City: ${j.region || '-'} / ${j.city || '-'}\n` +
        `📍 Location: ${j.latitude}, ${j.longitude}\n` +
        `🕒 Timezone: ${(j.timezone && j.timezone.id) || '-'} (UTC${(j.timezone && j.timezone.utc) || ''})\n` +
        `📡 ISP: ${(j.connection && j.connection.isp) || '-'}\n` +
        `🏢 Org: ${(j.connection && j.connection.org) || '-'}\n` +
        `🔗 ASN: ${(j.connection && j.connection.asn) || '-'}${FOOT}`
    );
});

/* ---------------- .base64 ---------------- */
add('base64', async ({ m, args, reply }) => {
    const { mode, rest } = codecMode(args);
    const text = inputText(m, rest);
    if (!text) return reply('⚠️ Istemal:\n*.base64 Hello*  (encode)\n*.base64 decode SGVsbG8=*');
    if (mode === 'decode') {
        if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(text.replace(/\s/g, ''))) return reply('❌ Yeh sahi Base64 nahi hai.');
        return reply(`🔓 *BASE64 DECODE*\n\n${Buffer.from(text.replace(/\s/g, ''), 'base64').toString('utf8')}${FOOT}`);
    }
    return reply(`🔐 *BASE64 ENCODE*\n\n${Buffer.from(text, 'utf8').toString('base64')}${FOOT}`);
});

/* ---------------- .binary ---------------- */
add('binary', async ({ m, args, reply }) => {
    let { mode, rest } = codecMode(args);
    const text = inputText(m, rest);
    if (!text) return reply('⚠️ Istemal:\n*.binary Hello*  (text → binary)\n*.binary decode 01001000 01101001*');
    if (!mode) mode = /^[01\s]+$/.test(text) && text.replace(/\s/g, '').length % 8 === 0 ? 'decode' : 'encode';
    if (mode === 'decode') {
        const bits = text.replace(/\s/g, '');
        if (!/^[01]+$/.test(bits) || bits.length % 8) return reply('❌ Yeh sahi binary nahi hai (8-bit groups chahiye).');
        const bytes = bits.match(/.{8}/g).map((b) => parseInt(b, 2));
        return reply(`🔓 *BINARY → TEXT*\n\n${Buffer.from(bytes).toString('utf8')}${FOOT}`);
    }
    const out = [...Buffer.from(text, 'utf8')].map((b) => b.toString(2).padStart(8, '0')).join(' ');
    return reply(`💻 *TEXT → BINARY*\n\n${out}${FOOT}`);
});

/* ---------------- .hex ---------------- */
add('hex', async ({ m, args, reply }) => {
    const { mode, rest } = codecMode(args);
    const text = inputText(m, rest);
    if (!text) return reply('⚠️ Istemal:\n*.hex Hello*  (encode)\n*.hex decode 48656c6c6f*');
    if (mode === 'decode') {
        const h = text.replace(/^0x/i, '').replace(/\s/g, '');
        if (!/^[0-9a-fA-F]+$/.test(h) || h.length % 2) return reply('❌ Yeh sahi hex nahi hai.');
        return reply(`🔓 *HEX → TEXT*\n\n${Buffer.from(h, 'hex').toString('utf8')}${FOOT}`);
    }
    return reply(`🔢 *TEXT → HEX*\n\n${Buffer.from(text, 'utf8').toString('hex')}${FOOT}`);
});

/* ---------------- .clock ---------------- */
add('clock', async ({ args, reply }) => {
    let tz = TZ_DEFAULT, label = 'Lahore (PKT)';
    const arg = (args[0] || '').trim();
    if (arg) {
        const key = arg.toLowerCase().replace(/[\s_-]/g, '');
        const zone = TZ_ALIASES[key] || arg;
        try { new Intl.DateTimeFormat('en', { timeZone: zone }); tz = zone; label = arg; } catch (_) {
            return reply('❌ Yeh sheher/timezone nahi mila. Misal: *.clock dubai*  ya  *.clock America/New_York*');
        }
    }
    const now = new Date();
    const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(now);
    const time24 = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(now);
    const hijri = hijriNow(tz);
    return reply(
        `🕒 *CLOCK - ${label}*\n\n` +
        `⏰ Waqt: *${time}*\n` +
        `🕐 24h: ${time24}\n` +
        `📅 Tareekh: ${date}\n` +
        (hijri ? `🌙 Hijri: ${hijri}\n` : '') +
        `🌐 Timezone: ${tz}${FOOT}`
    );
});

/* ---------------- .calendar ---------------- */
add('calendar', async ({ args, reply }) => {
    const t = nowIn(TZ_DEFAULT);
    let mo = t.mo, y = t.y;
    const nums = args.map((a) => parseInt(a, 10)).filter((n) => Number.isFinite(n));
    if (nums.length >= 1) {
        if (nums[0] >= 1 && nums[0] <= 12) mo = nums[0];
        else return reply('⚠️ Istemal: *.calendar*  ya  *.calendar 12*  ya  *.calendar 12 2026*');
    }
    if (nums.length >= 2) {
        if (nums[1] >= 1900 && nums[1] <= 2200) y = nums[1];
        else return reply('⚠️ Saal 1900 se 2200 ke darmiyan likhein.');
    }
    const cal = buildCalendar(y, mo, t);
    const hijri = hijriNow(TZ_DEFAULT);
    return reply(
        `📅 *CALENDAR (Lahore)*\n\n\`\`\`${cal}\`\`\`\n` +
        `📌 Aaj: ${String(t.d).padStart(2, '0')}-${String(t.mo).padStart(2, '0')}-${t.y}` +
        (hijri ? `\n🌙 Hijri: ${hijri}` : '') + FOOT
    );
});

/* ---------------- .timer ---------------- */
add('timer', async ({ sock, m, args, reply }) => {
    const ms = parseDuration(args[0], 60000); // sirf number likha to minutes
    if (!ms) return reply('⚠️ Istemal: *.timer 5m*  |  *.timer 30s*  |  *.timer 1h30m*\n(Sirf number likhein to minutes samjhe jayenge.)');
    if (ms < 1000 || ms > MAX_TIMER_MS) return reply('⚠️ Timer 1 second se 24 din ke darmiyan hona chahiye.');
    const jid = m.key.remoteJid;
    const sender = senderOf(m);
    const label = inputText(m, args.slice(1));
    setTimeout(() => {
        sock.sendMessage(jid, {
            text: `⏱️ *TIMER KHATAM!*\n\n@${numberOf(sender)}\n${label ? '📝 ' + label + '\n' : ''}⌛ ${fmtDur(ms)} poore ho gaye.${FOOT}`,
            mentions: [sender]
        }).catch(() => {});
    }, ms);
    return reply(`⏱️ *Timer shuru!*\n\n⏳ ${fmtDur(ms)}${label ? '\n📝 ' + label : ''}\nKhatam hone par bata dunga.`);
});

/* ---------------- .count ---------------- */
add('count', async ({ m, args, reply }) => {
    const text = inputText(m, args);
    if (!text) return reply('⚠️ Istemal: *.count aapka text*  ya kisi message par reply karke *.count*');
    const words = text.split(/\s+/).filter(Boolean).length;
    const lines = text.split(/\r?\n/).length;
    return reply(
        `🔢 *COUNT*\n\n` +
        `🔤 Characters: *${[...text].length}*\n` +
        `🔡 Bina space ke: *${[...text.replace(/\s/g, '')].length}*\n` +
        `📝 Words: *${words}*\n` +
        `📄 Lines: *${lines}*${FOOT}`
    );
});

module.exports = toolCommands;
module.exports._internals = { calc, textToPdf, imageToPdf, jpegInfo, buildCalendar, parseDuration, fmtDur, parseLang };