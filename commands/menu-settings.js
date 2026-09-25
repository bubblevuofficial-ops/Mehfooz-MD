'use strict';

/*
|--------------------------------------------------------------------------
| MEHFOOZ MD - MENU SETTINGS  (commands/menu-settings.js)
|--------------------------------------------------------------------------
| .settheme / .setcolor / .setfont / .setlang / .setregion / .settime ...
| in sab ke options aur helper yahan hain. handler.js (menu banane ke liye)
| aur system-commands.js (settings badalne ke liye) dono isay use karte hain.
|--------------------------------------------------------------------------
*/

let TEXT_FONTS = {};
try { TEXT_FONTS = require('./text-commands').FONTS || {}; } catch {}

const THEMES = ['default', 'classic', 'simple', 'stars', 'minimal'];

// .setcolor -> bullet (◆) ka rang
const COLORS = {
    red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', blue: '🔵',
    purple: '🟣', black: '⚫', white: '⚪', brown: '🟤', cyan: '🔷', gold: '🔶'
};

const FONT_KEYS = ['bolditalic', 'bold', 'italic', 'script', 'fraktur', 'mono', 'sans', 'sansbold', 'double', 'smallcaps', 'plain'];
const fontFn = (name) => TEXT_FONTS[name] || TEXT_FONTS.bolditalic || ((x) => x);

const LIST_STYLES = ['dot', 'number', 'dash', 'inline'];
const MENU_MODES = ['full', 'category'];
const DATE_FORMATS = ['dmy', 'mdy', 'ymd', 'long', 'day'];

const LABELS = {
    en:       { owner: 'Owner', mode: 'Mode', prefix: 'Prefix', version: 'Version', runtime: 'Runtime', total: 'Total Commands', date: 'Date', time: 'Time' },
    hinglish: { owner: 'Malik', mode: 'Mode', prefix: 'Prefix', version: 'Version', runtime: 'Chalne Ka Waqt', total: 'Kul Commands', date: 'Tareekh', time: 'Waqt' },
    hi:       { owner: 'मालिक', mode: 'मोड', prefix: 'प्रीफ़िक्स', version: 'वर्ज़न', runtime: 'रनटाइम', total: 'कुल कमांड', date: 'तारीख़', time: 'समय' },
    ur:       { owner: 'مالک', mode: 'موڈ', prefix: 'پریفکس', version: 'ورژن', runtime: 'رن ٹائم', total: 'کل کمانڈز', date: 'تاریخ', time: 'وقت' }
};

const REGIONS = {
    pk: 'Asia/Karachi', in: 'Asia/Kolkata', bd: 'Asia/Dhaka', af: 'Asia/Kabul', lk: 'Asia/Colombo', np: 'Asia/Kathmandu',
    ae: 'Asia/Dubai', sa: 'Asia/Riyadh', qa: 'Asia/Qatar', kw: 'Asia/Kuwait', om: 'Asia/Muscat', ir: 'Asia/Tehran',
    tr: 'Europe/Istanbul', eg: 'Africa/Cairo', ng: 'Africa/Lagos', za: 'Africa/Johannesburg',
    uk: 'Europe/London', de: 'Europe/Berlin', fr: 'Europe/Paris', ru: 'Europe/Moscow',
    us: 'America/New_York', ca: 'America/Toronto', br: 'America/Sao_Paulo',
    au: 'Australia/Sydney', id: 'Asia/Jakarta', my: 'Asia/Kuala_Lumpur', cn: 'Asia/Shanghai', jp: 'Asia/Tokyo'
};

// "Asia/Karachi" | "pk" | "+5" | "-3" | "utc+5"  ->  valid IANA timezone ya null
function resolveTimezone(input) {
    if (!input) return null;
    const raw = String(input).trim();
    const low = raw.toLowerCase();
    if (REGIONS[low]) return REGIONS[low];
    const off = low.match(/^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})$/);
    if (off) {
        const h = parseInt(off[2], 10);
        if (h > 14) return null;
        if (h === 0) return 'UTC';
        return `Etc/GMT${off[1] === '+' ? '-' : '+'}${h}`;   // Etc/GMT ka sign ulta hota hai
    }
    try { new Intl.DateTimeFormat('en-US', { timeZone: raw }); return raw; } catch { return null; }
}

function formatDate(tz, fmt) {
    const opt = tz ? { timeZone: tz } : {};
    const d = new Date();
    if (fmt === 'long') return new Intl.DateTimeFormat('en-GB', { ...opt, day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    if (fmt === 'day') return new Intl.DateTimeFormat('en-GB', { ...opt, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { ...opt, day: '2-digit', month: '2-digit', year: 'numeric' })
        .formatToParts(d).map(p => [p.type, p.value]));
    if (fmt === 'mdy') return `${parts.month}/${parts.day}/${parts.year}`;
    if (fmt === 'ymd') return `${parts.year}-${parts.month}-${parts.day}`;
    return `${parts.day}/${parts.month}/${parts.year}`;
}
function formatTime(tz) {
    const opt = tz ? { timeZone: tz } : {};
    return new Intl.DateTimeFormat('en-US', { ...opt, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date());
}

module.exports = { THEMES, COLORS, FONT_KEYS, fontFn, LIST_STYLES, MENU_MODES, DATE_FORMATS, LABELS, REGIONS, resolveTimezone, formatDate, formatTime };