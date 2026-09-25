'use strict';

/*
|--------------------------------------------------------------------------
| MEHFOOZ MD - TEXT & FANCY STYLES  (commands/text-commands.js)
|--------------------------------------------------------------------------
| Menu ki saari 40 text commands yahan REAL logic ke saath hain.
| Koi internet / npm package nahi chahiye — sab pure JavaScript hai.
|
| Use:  .boldtext Hello      ya kisi text ko reply karke  .boldtext
|
| Format: array of { name, execute({ sock, m, args, reply, db, prefix }) }
| (bilkul general.js jaisa) — handler.js isay khud load karta hai.
|--------------------------------------------------------------------------
*/

// ---------------------------------------------------------------
// Unicode font builders
// ---------------------------------------------------------------
const make = (upper, lower, digit, holes = {}) => (s) => [...String(s)].map(ch => {
    if (holes[ch]) return holes[ch];
    const c = ch.codePointAt(0);
    if (upper && c >= 65 && c <= 90) return String.fromCodePoint(upper + c - 65);
    if (lower && c >= 97 && c <= 122) return String.fromCodePoint(lower + c - 97);
    if (digit && c >= 48 && c <= 57) return String.fromCodePoint(digit + c - 48);
    return ch;
}).join('');

const sansBold     = make(0x1D5D4, 0x1D5EE, 0x1D7EC);
const sansItalic   = make(0x1D608, 0x1D622, null);
const sansPlain    = make(0x1D5A0, 0x1D5BA, 0x1D7E2);
const mono         = make(0x1D670, 0x1D68A, 0x1D7F6);
const scriptBold   = make(0x1D4D0, 0x1D4EA, 0x1D7CE);
const scriptLight  = make(0x1D49C, 0x1D4B6, null, { B:'ℬ',E:'ℰ',F:'ℱ',H:'ℋ',I:'ℐ',L:'ℒ',M:'ℳ',R:'ℛ',e:'ℯ',g:'ℊ',o:'ℴ' });
const frakturBold  = make(0x1D56C, 0x1D586, null);
const fraktur      = make(0x1D504, 0x1D51E, null, { C:'ℭ',H:'ℌ',I:'ℑ',R:'ℜ',Z:'ℨ' });
const doubleStruck = make(0x1D538, 0x1D552, 0x1D7D8, { C:'ℂ',H:'ℍ',N:'ℕ',P:'ℙ',Q:'ℚ',R:'ℝ',Z:'ℤ' });
const serifBold    = make(0x1D400, 0x1D41A, 0x1D7CE);
const serifBI      = make(0x1D468, 0x1D482, 0x1D7CE);

const fullwidth = (s) => [...String(s)].map(ch => {
    const c = ch.codePointAt(0);
    if (ch === ' ') return '\u3000';
    return (c >= 0x21 && c <= 0x7E) ? String.fromCodePoint(c + 0xFEE0) : ch;
}).join('');

const circled = (s) => [...String(s)].map(ch => {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x24B6 + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x24D0 + c - 97);
    if (c === 48) return '\u24EA';
    if (c >= 49 && c <= 57) return String.fromCodePoint(0x2460 + c - 49);
    return ch;
}).join('');

const negCircled = (s) => [...String(s)].map(ch => {
    const c = ch.toUpperCase().codePointAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1F150 + c - 65);
    if (c === 48) return '\u24FF';
    if (c >= 49 && c <= 57) return String.fromCodePoint(0x2776 + c - 49);
    return ch;
}).join('');

const negSquared = (s) => [...String(s)].map(ch => {
    const c = ch.toUpperCase().codePointAt(0);
    return (c >= 65 && c <= 90) ? String.fromCodePoint(0x1F170 + c - 65) : ch;
}).join('');

const mapObj = (obj, lowerFirst = true) => (s) => [...String(s)].map(ch => {
    const k = lowerFirst ? ch.toLowerCase() : ch;
    return obj[k] !== undefined ? obj[k] : ch;
}).join('');

const SMALL_CAPS = { a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'ꜱ',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ' };
const smallCaps = mapObj(SMALL_CAPS);

const SUPER = { a:'ᵃ',b:'ᵇ',c:'ᶜ',d:'ᵈ',e:'ᵉ',f:'ᶠ',g:'ᵍ',h:'ʰ',i:'ⁱ',j:'ʲ',k:'ᵏ',l:'ˡ',m:'ᵐ',n:'ⁿ',o:'ᵒ',p:'ᵖ',q:'ᑫ',r:'ʳ',s:'ˢ',t:'ᵗ',u:'ᵘ',v:'ᵛ',w:'ʷ',x:'ˣ',y:'ʸ',z:'ᶻ','0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };
const superscript = mapObj(SUPER);

const FLIP = { a:'ɐ',b:'q',c:'ɔ',d:'p',e:'ǝ',f:'ɟ',g:'ƃ',h:'ɥ',i:'ᴉ',j:'ɾ',k:'ʞ',l:'ן',m:'ɯ',n:'u',o:'o',p:'d',q:'b',r:'ɹ',s:'s',t:'ʇ',u:'n',v:'ʌ',w:'ʍ',x:'x',y:'ʎ',z:'z','1':'Ɩ','2':'ᄅ','3':'Ɛ','4':'ㄣ','5':'ϛ','6':'9','7':'ㄥ','8':'8','9':'6','0':'0','.':'˙',',':"'",'?':'¿','!':'¡','(':')',')':'(','[':']',']':'[','{':'}','}':'{','<':'>','>':'<','_':'‾',"'":',' };
const MIRROR = { a:'ɒ',b:'d',c:'ɔ',d:'b',e:'ɘ',f:'ꟻ',g:'ǫ',h:'ʜ',j:'ᒐ',k:'ʞ',l:'|',n:'ᴎ',p:'q',q:'p',r:'ɿ',s:'ƨ',t:'ƚ',y:'ʏ',z:'ƹ','2':'ς','3':'Ɛ','5':'ट','7':'Ɛ','(':')',')':'(','[':']',']':'[','{':'}','}':'{','<':'>','>':'<','?':'⸮' };

const rev = (s) => [...String(s)].reverse().join('');

// helpers
const words = (s) => String(s).split(/\s+/).filter(Boolean);
const interleave = (s, sep) => words(s).map(w => [...w].join(sep)).join('  ');
const combine = (s, mark) => [...String(s)].map(ch => /\s/.test(ch) ? ch : ch + mark).join('');
const cycle = (arr, i) => arr[i % arr.length];
const mono3 = (t) => '```' + t + '```';

const wrap = (text, width) => {
    const out = []; let line = '';
    for (const w of words(text)) {
        if ((line + ' ' + w).trim().length > width) { if (line) out.push(line); line = w; }
        else line = (line + ' ' + w).trim();
    }
    if (line) out.push(line);
    return out.length ? out : [''];
};

// ---------------------------------------------------------------
// 5x5 block font (ascii / figlet / banner / 3dtext)
// ---------------------------------------------------------------
const FONT = {
    A:' ### |#   #|#####|#   #|#   #', B:'#### |#   #|#### |#   #|#### ', C:' ####|#    |#    |#    | ####',
    D:'#### |#   #|#   #|#   #|#### ', E:'#####|#    |#### |#    |#####', F:'#####|#    |#### |#    |#    ',
    G:' ####|#    |#  ##|#   #| ####', H:'#   #|#   #|#####|#   #|#   #', I:'#####|  #  |  #  |  #  |#####',
    J:'  ###|    #|    #|#   #| ### ', K:'#   #|#  # |###  |#  # |#   #', L:'#    |#    |#    |#    |#####',
    M:'#   #|## ##|# # #|#   #|#   #', N:'#   #|##  #|# # #|#  ##|#   #', O:' ### |#   #|#   #|#   #| ### ',
    P:'#### |#   #|#### |#    |#    ', Q:' ### |#   #|# # #|#  # | ## #', R:'#### |#   #|#### |#  # |#   #',
    S:' ####|#    | ### |    #|#### ', T:'#####|  #  |  #  |  #  |  #  ', U:'#   #|#   #|#   #|#   #| ### ',
    V:'#   #|#   #|#   #| # # |  #  ', W:'#   #|#   #|# # #|## ##|#   #', X:'#   # | # # |  #  | # # |#   #',
    Y:'#   #| # # |  #  |  #  |  #  ', Z:'#####|   # |  #  | #   |#####',
    '0':' ### |#  ##|# # #|##  #| ### ', '1':'  #  | ##  |  #  |  #  |#####', '2':' ### |#   #|  ## | #   |#####',
    '3':'#### |    #| ### |    #|#### ', '4':'#  # |#  # |#####|   # |   # ', '5':'#####|#    |#### |    #|#### ',
    '6':' ### |#    |#### |#   #| ### ', '7':'#####|    #|   # |  #  |  #  ', '8':' ### |#   #| ### |#   #| ### ',
    '9':' ### |#   #| ####|    #| ### ',
    '!':'  #  |  #  |  #  |     |  #  ', '?':' ### |#   #|  ## |     |  #  ', '.':'     |     |     |     |  #  ',
    '-':'     |     |#####|     |     ', ' ':'   |   |   |   |   '
};
const GLYPH = {};
for (const k of Object.keys(FONT)) GLYPH[k] = FONT[k].split('|');

// returns array of "blocks"; each block = 5 row-strings of '#'/' ' (max 5 chars per block)
function bigGrid(text, perLine = 5, maxChars = 20) {
    // har word alag rows mein; lamba word perLine characters ke tukdon mein
    let budget = maxChars;
    const blocks = [];
    for (const w of String(text).toUpperCase().split(/\s+/)) {
        const chars = [...w].filter(ch => GLYPH[ch] && ch !== ' ').slice(0, budget);
        budget -= chars.length;
        for (let i = 0; i < chars.length; i += perLine) {
            const part = chars.slice(i, i + perLine);
            blocks.push([0, 1, 2, 3, 4].map(r => part.map(ch => GLYPH[ch][r]).join(' ')));
        }
        if (budget <= 0) break;
    }
    return blocks;
}

const bigFilled = (text, fill) => {
    const blocks = bigGrid(text);
    if (!blocks.length) return null;
    return blocks.map(rows => rows.map(r => r.replace(/#/g, fill).replace(/\s+$/, '')).join('\n')).join('\n\n');
};

const big3D = (text) => {
    const blocks = bigGrid(text, 5);
    if (!blocks.length) return null;
    return blocks.map(rows => {
        const H = rows.length, W = rows[0].length;
        const on = (r, c) => r >= 0 && c >= 0 && r < H && c < W && rows[r][c] === '#';
        const out = [];
        for (let r = 0; r <= H; r++) {
            let line = '';
            for (let c = 0; c <= W; c++) line += on(r, c) ? '█' : (on(r - 1, c - 1) ? '░' : ' ');
            out.push(line.replace(/\s+$/, ''));
        }
        return out.join('\n');
    }).join('\n\n');
};

const bigSlant = (text) => {
    const blocks = bigGrid(text);
    if (!blocks.length) return null;
    return blocks.map(rows => rows.map((r, i) => ' '.repeat(4 - i) + r.replace(/#/g, '█').replace(/\s+$/, '')).join('\n')).join('\n\n');
};

const bigBanner = (text) => {
    const blocks = bigGrid(text);
    if (!blocks.length) return null;
    return blocks.map(rows => {
        const inner = rows.map(r => r.replace(/#/g, '█'));
        const w = Math.max(...inner.map(r => r.length));
        const line = (r) => '║ ' + r.padEnd(w, ' ') + ' ║';
        return ['╔' + '═'.repeat(w + 2) + '╗', line(' '.repeat(w)), ...inner.map(line), line(' '.repeat(w)), '╚' + '═'.repeat(w + 2) + '╝'].join('\n');
    }).join('\n\n');
};

// ---------------------------------------------------------------
// The 40 styles.   each: (text) => string   (or null => bad input)
// ---------------------------------------------------------------
const zalgo = (s) => {
    const marks = []; for (let i = 0x0300; i <= 0x036F; i++) marks.push(String.fromCharCode(i));
    return [...String(s)].map(ch => {
        if (/\s/.test(ch)) return ch;
        let out = ch; const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) out += marks[Math.floor(Math.random() * marks.length)];
        return out;
    }).join('');
};

const alternating = (s) => { let i = 0; return [...String(s)].map(ch => /[a-z]/i.test(ch) ? (i++ % 2 ? ch.toLowerCase() : ch.toUpperCase()) : ch).join(''); };

const RAINBOW = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣'];
const EMO_SEP = ['😎', '🔥', '✨', '💫', '😍', '🌟'];

const keycap = (d) => d + '\uFE0F\u20E3';
const emojiLetters = (s) => {
    let wi = 0;
    return words(s).map(w => {
        const body = [...w].map(ch => {
            const c = ch.toUpperCase().codePointAt(0);
            if (c >= 65 && c <= 90) return String.fromCodePoint(0x1F1E6 + c - 65) + '\u200B';
            if (/[0-9]/.test(ch)) return keycap(ch);
            return ch;
        }).join('');
        return body + ' ' + cycle(EMO_SEP, wi++);
    }).join(' ');
};

const STYLES = {
    boldtext:    (t) => sansBold(t),
    italictext:  (t) => sansItalic(t),
    monotext:    (t) => mono(t),
    striketext:  (t) => combine(t, '\u0336'),
    fancytext:   (t) => scriptBold(t),
    bubbletext:  (t) => circled(t),
    squaretext:  (t) => negSquared(t),
    fliptext:    (t) => rev(mapObj(FLIP)(t)),
    mirrortext:  (t) => rev(mapObj(MIRROR)(t)),
    wavytext:    (t) => `≋ ${alternating(t)} ≋`,
    smalltext:   (t) => superscript(t),
    bigtext:     (t) => fullwidth(t),
    rainbowtext: (t) => { let i = 0; return '🌈 ' + [...sansBold(t)].map(ch => /\s/.test(ch) ? ch : cycle(RAINBOW, i++) + ch).join(''); },
    neontext:    (t) => `⚡✨ ${[...sansBold(t.toUpperCase())].map(c => c).join(' ').replace(/ {2,}/g, '   ')} ✨⚡`,
    firetext:    (t) => `🔥🔥🔥🔥🔥\n🔥 ${scriptBold(t)} 🔥\n🔥🔥🔥🔥🔥`,
    watertext:   (t) => `🌊💧 ${doubleStruck(t)} 💧🌊\n〰️〰️〰️〰️〰️〰️`,
    ghosttext:   (t) => `👻 ${fraktur(t)} 👻`,
    shadowtext:  (t) => { const n = Math.min([...t].length, 24); return `${sansBold(t)}\n${'▒'.repeat(n)}\n${'░'.repeat(n)}`; },
    '3dtext':    (t) => { const r = big3D(t); return r && mono3(r); },
    glitchtext:  (t) => zalgo(t),
    ascii:       (t) => { const r = bigFilled(t, '#'); return r && mono3(r); },
    figlet:      (t) => { const r = bigSlant(t); return r && mono3(r); },
    banner:      (t) => { const r = bigBanner(t); return r && mono3(r); },
    arttext:     (t) => `⋆｡°✩ ${scriptLight(t)} ✩°｡⋆`,
    emojitext:   (t) => `✨ ${emojiLetters(t)} ✨`,
    dottext:     (t) => combine(sansBold(t), '\u0307'),
    linetext:    (t) => { const n = Math.min([...t].length + 2, 26); return `${'━'.repeat(n)}\n${combine(t, '\u0332')}\n${'━'.repeat(n)}`; },
    boxtext:     (t) => {
        const lines = wrap(t, 22), w = Math.max(...lines.map(l => [...l].length));
        return mono3(['╔' + '═'.repeat(w + 2) + '╗', ...lines.map(l => '║ ' + l + ' '.repeat(w - [...l].length) + ' ║'), '╚' + '═'.repeat(w + 2) + '╝'].join('\n'));
    },
    circletext:  (t) => negCircled(t),
    startext:    (t) => `⋆★⋆ ${interleave(t, '★')} ⋆★⋆`,
    hearttext:   (t) => `💖 ${interleave(t, '♥')} 💖`,
    flowertext:  (t) => `🌸 ${interleave(t, '✿')} 🌸`,
    musictext:   (t) => `🎵 ${interleave(t, '♫')} 🎶`,
    gametext:    (t) => `🎮 「${mono(t.toUpperCase())}」 🕹️`,
    cooltext:    (t) => `꧁༒☬ ${frakturBold(t)} ☬༒꧂`,
    stylishtext: (t) => [
        `1. ${sansBold(t)}`, `2. ${sansItalic(t)}`, `3. ${scriptBold(t)}`, `4. ${frakturBold(t)}`,
        `5. ${doubleStruck(t)}`, `6. ${mono(t)}`, `7. ${circled(t)}`, `8. ${smallCaps(t)}`,
        `9. ${fullwidth(t)}`, `10. ${superscript(t)}`, `11. ${serifBI(t)}`, `12. ${rev(mapObj(FLIP)(t))}`
    ].join('\n\n'),
    moderntext:  (t) => `▌ ${sansPlain(t)} ▐`,
    classictext: (t) => `『 ${serifBold(t)} 』`,
    retrotext:   (t) => `▓▒░ ${fullwidth(t.toUpperCase())} ░▒▓`,
    futuretext:  (t) => `◤ ${smallCaps(t)} ◢`
};

// ---------------------------------------------------------------
// text input: args ya reply kiya hua message
// ---------------------------------------------------------------
function getInputText(m, args) {
    const direct = (args || []).join(' ').trim();
    if (direct) return direct;
    const q = m?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!q) return '';
    return (q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || q.videoMessage?.caption || '').trim();
}

const BIG_NAMES = new Set(['3dtext', 'ascii', 'figlet', 'banner']);

module.exports = Object.keys(STYLES).map(name => ({
    name,
    async execute({ m, args, reply, prefix = '.' }) {
        let text = getInputText(m, args);
        if (!text) {
            return reply(`⚠️ Text likhein ya kisi text ko reply karein.\nExample: ${prefix}${name} Mehfooz`);
        }
        if (text.length > 300) text = text.slice(0, 300);

        let out = null;
        try { out = STYLES[name](text); } catch (e) { out = null; }

        if (!out || !String(out).trim()) {
            return reply(BIG_NAMES.has(name)
                ? '⚠️ Is command mein sirf English letters (A-Z), numbers (0-9) aur ! ? . - chalte hain. Max 20 characters.'
                : '⚠️ Yeh text convert nahi ho saka.');
        }
        return reply(out);
    }
}));

module.exports.STYLES = STYLES; // testing ke liye