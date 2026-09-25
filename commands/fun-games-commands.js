'use strict';

/*
|--------------------------------------------------------------------------
| MEHFOOZ MD - FUN & GAMES COMMANDS (REAL LOGIC)
|--------------------------------------------------------------------------
| Ye file general.js se load hoti hai (tools-commands.js / search-info-
| commands.js ki tarah). .gamemenu ke andar list hui saari 50 commands
| ka asli, working code yahan hai — sab kuch WhatsApp ke andar hi
| chalta hai, koi external app/website nahi chahiye.
|
| NOTE: Economy (balance/xp), marriage aur tictactoe/hangman/guess
| session data is process ki memory mein rehta hai (in-memory Maps).
| Matlab bot restart hone par ye data reset ho jayega — agar aap
| permanent database (JSON file / mongodb) chahte hain to bata dein,
| wo alag se wire kiya ja sakta hai.
|--------------------------------------------------------------------------
*/

// ------------------------------------------------------------------
// IN-MEMORY STORES
// ------------------------------------------------------------------
const economy = new Map();      // jid -> { balance, xp, lastDaily, lastWork, lastRob, inventory: [] }
const marriages = new Map();    // jid -> partnerJid
const tttGames = new Map();     // chatId -> { board: Array(9), starter: jid }
const hangmanGames = new Map(); // chatId -> { word, guessed: Set, wrong, max }
const guessGames = new Map();   // chatId -> { secret, attempts, max }

function getEco(jid) {
    if (!economy.has(jid)) {
        economy.set(jid, { balance: 500, xp: 0, lastDaily: 0, lastWork: 0, lastRob: 0, inventory: [] });
    }
    return economy.get(jid);
}

function levelFromXP(xp) {
    return Math.floor(xp / 100) + 1;
}

function addXP(jid, amount) {
    const eco = getEco(jid);
    eco.xp += amount;
    return eco;
}

function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function shortNum(n) {
    return String(n).split('@')[0];
}

function getTarget(m, args) {
    const ctxInfo = m.message?.extendedTextMessage?.contextInfo;
    if (ctxInfo?.participant) return ctxInfo.participant;
    if (ctxInfo?.mentionedJid && ctxInfo.mentionedJid[0]) return ctxInfo.mentionedJid[0];
    if (args[0] && args[0].startsWith('@')) return args[0].slice(1).replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    return null;
}

function nameOf(jid, m) {
    if (!jid) return 'someone';
    const senderId = m.key.participant || m.key.remoteJid;
    if (jid === senderId) return m.pushName || shortNum(jid);
    return shortNum(jid);
}

// simple deterministic "compatibility" percentage so .ship gives same
// result for the same pair every time (feels more like a real meter)
function compatibility(a, b) {
    const s = String(a) + String(b);
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) % 101;
    return hash;
}

function progressBar(percent, size = 10) {
    const filled = Math.round((percent / 100) * size);
    return '▓'.repeat(filled) + '░'.repeat(size - filled);
}

// ------------------------------------------------------------------
// STATIC CONTENT POOLS
// ------------------------------------------------------------------
const TRUTHS = [
    'Aap ki sabse embarrassing yaad kya hai?',
    'Aap ne kisi se pyar mein sabse jhooti baat kya boli hai?',
    'Agar ek din ke liye invisible ho jayein to kya karenge?',
    'Aap ki sabse badi darr kya hai?',
    'Kya kabhi kisi ka phone chupke se check kiya hai?',
    'Aap ka sabse ajeeb khwaab kya tha?'
];

const DARES = [
    'Agla message sirf emojis mein bhejein.',
    'Apna last search history yaad karke batayein (without reading it out loud lol).',
    'Group mein ek compliment bhejein kisi random member ko.',
    '30 second tak koi bhi punctuation use kiye bina type karein.',
    'Apni sabse purani DP wapas laga dein 1 din ke liye.',
    'Ek joke sunayein, chahe kitna bhi bura ho.'
];

const RIDDLES = [
    { q: 'Main aata hoon lekin kabhi nahi jaata, main hoon...?', a: 'Kal (yesterday)' },
    { q: 'Jitna nikaalo utna hi barhta hai, wo kya hai?', a: 'Gaddha (hole)' },
    { q: 'Bina pankh ke udta hai, bina aankh ke rota hai — kya hai?', a: 'Baadal (cloud)' },
    { q: 'Uske paas shehar hai lekin ghar nahi, nadi hai lekin paani nahi, jungle hai lekin darakht nahi — kya hai?', a: 'Naksha (map)' },
    { q: 'Jitni tootay utni hi mazbooti se kaam aaye — kya hai?', a: 'Anda (egg) — nahi, sahi jawab: record/promise! Best guess: waada (promise)' }
];

const PUZZLES = [
    { q: '2, 6, 12, 20, 30, ? — agla number kya hoga?', a: '42 (difference +4,+6,+8,+10,+12)' },
    { q: 'Agar 5 machines 5 minute mein 5 cheezein banati hain, to 100 machines 100 cheezein banane mein kitna time lengi?', a: '5 minute' },
    { q: 'Ek family mein 6 beti aur 1 beta hai, har beti ka ek hi bhai hai — total kitne bache hain?', a: '7' }
];

const TRIVIA = [
    { q: 'Duniya ka sabse chota mulk kaunsa hai?', a: 'Vatican City' },
    { q: 'Insaan ke jism mein kitni haddiyan hoti hain?', a: '206' },
    { q: 'Sabse tez chalne wala jaanwar kaunsa hai?', a: 'Cheetah' },
    { q: 'WhatsApp kis saal launch hua tha?', a: '2009' },
    { q: 'Duniya ka sabse bada samandar kaunsa hai?', a: 'Pacific Ocean' }
];

const WORDS = ['pakistan', 'developer', 'whatsapp', 'keyboard', 'internet', 'elephant', 'mountain', 'sunshine', 'triangle', 'universe'];

function scramble(word) {
    const arr = word.split('');
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.join('').toUpperCase();
}

const SHOP_ITEMS = [
    { name: 'VIP Badge', price: 2000 },
    { name: 'Lucky Charm', price: 800 },
    { name: 'Golden Sticker Pack', price: 500 },
    { name: 'Double XP Token', price: 1200 },
    { name: 'Mystery Box', price: 300 }
];

const ACTION_PHRASES = {
    hug: ['🤗 {a} ne {b} ko pyar se gale lagaya!'],
    kiss: ['😘 {a} ne {b} ko kiss kar diya!'],
    slap: ['👋 {a} ne {b} ko zor se thappad maara!'],
    kill: ['💀 {a} ne {b} ko (fun mein) khatam kar diya!'],
    punch: ['👊 {a} ne {b} ko ek zabardast punch maara!'],
    kickuser: ['🦵 {a} ne {b} ko laat maar di!'],
    bite: ['😬 {a} ne {b} ko kaat liya!'],
    lick: ['👅 {a} ne {b} ko chaat liya, eww!'],
    pat: ['🖐️ {a} ne {b} ke sar par pyar se thapki di!'],
    poke: ['👉 {a} ne {b} ko poke kiya!']
};

function actionCommand(name) {
    return {
        name,
        async execute({ reply, args, m }) {
            const target = getTarget(m, args);
            const senderId = m.key.participant || m.key.remoteJid;
            const a = nameOf(senderId, m);
            const b = target ? nameOf(target, m) : 'khud ko (kisi ko tag/reply karein)';
            const phrase = pickRandom(ACTION_PHRASES[name]).replace('{a}', a).replace('{b}', b);
            return reply(`${phrase}\n\n👑 *MEHFOOZ MD*`);
        }
    };
}

module.exports = [

    // 1) coinflip
    {
        name: 'coinflip',
        async execute({ reply }) {
            const result = Math.random() < 0.5 ? 'Heads 🪙' : 'Tails 🪙';
            return reply(`🪙 *COIN FLIP*\n\nResult: *${result}*\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 2) dice
    {
        name: 'dice',
        async execute({ reply, args }) {
            const count = Math.min(Math.max(parseInt(args[0]) || 1, 1), 5);
            const rolls = Array.from({ length: count }, () => rand(1, 6));
            return reply(`🎲 *DICE ROLL*\n\nResult: ${rolls.join(', ')}\nTotal: ${rolls.reduce((a, b) => a + b, 0)}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 3) roll (custom sided die, e.g. .roll 20 or .roll d20)
    {
        name: 'roll',
        async execute({ reply, args }) {
            let sides = 100;
            if (args[0]) {
                const parsed = parseInt(String(args[0]).replace(/[^0-9]/g, ''));
                if (parsed > 1) sides = parsed;
            }
            const result = rand(1, sides);
            return reply(`🎯 *ROLL (1-${sides})*\n\nResult: *${result}*\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 4) pick
    {
        name: 'pick',
        async execute({ reply, args, prefix }) {
            const raw = args.join(' ');
            if (!raw.includes(',')) return reply(`🎯 *PICK*\n\nOptions comma se separate karein.\nExample: ${prefix}pick pizza, biryani, burger\n\n👑 *MEHFOOZ MD*`);
            const options = raw.split(',').map(s => s.trim()).filter(Boolean);
            return reply(`🎯 *PICK*\n\nMain ne chuna: *${pickRandom(options)}*\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 5) choose
    {
        name: 'choose',
        async execute({ reply, args, prefix }) {
            let raw = args.join(' ');
            let options;
            if (raw.includes(',')) options = raw.split(',');
            else if (/\bor\b/i.test(raw)) options = raw.split(/\bor\b/i);
            else options = raw.split(' ');
            options = options.map(s => s.trim()).filter(Boolean);
            if (options.length < 2) return reply(`⚖️ *CHOOSE*\n\nExample: ${prefix}choose pizza or burger\n\n👑 *MEHFOOZ MD*`);
            return reply(`⚖️ *CHOOSE*\n\nMain choose karta hoon: *${pickRandom(options)}*\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 6) truth
    {
        name: 'truth',
        async execute({ reply }) {
            return reply(`🧊 *TRUTH*\n\n${pickRandom(TRUTHS)}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 7) dare
    {
        name: 'dare',
        async execute({ reply }) {
            return reply(`🔥 *DARE*\n\n${pickRandom(DARES)}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 8) riddle
    {
        name: 'riddle',
        async execute({ reply }) {
            const r = pickRandom(RIDDLES);
            return reply(`🧩 *RIDDLE*\n\n${r.q}\n\n_Answer: ${r.a}_\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 9) puzzle
    {
        name: 'puzzle',
        async execute({ reply }) {
            const p = pickRandom(PUZZLES);
            return reply(`🧠 *PUZZLE*\n\n${p.q}\n\n_Answer: ${p.a}_\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 10) trivia
    {
        name: 'trivia',
        async execute({ reply }) {
            const t = pickRandom(TRIVIA);
            return reply(`❓ *TRIVIA*\n\n${t.q}\n\n_Answer: ${t.a}_\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 11) mathquiz
    {
        name: 'mathquiz',
        async execute({ reply }) {
            const a = rand(2, 50), b = rand(2, 50);
            const ops = ['+', '-', '*'];
            const op = pickRandom(ops);
            let answer;
            if (op === '+') answer = a + b;
            else if (op === '-') answer = a - b;
            else answer = a * b;
            return reply(`➗ *MATH QUIZ*\n\n${a} ${op} ${b} = ?\n\n_Answer: ${answer}_\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 12) wordquiz
    {
        name: 'wordquiz',
        async execute({ reply }) {
            const word = pickRandom(WORDS);
            return reply(`🔤 *WORD QUIZ*\n\nUnscramble: *${scramble(word)}*\n\n_Answer: ${word}_\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 13) guess (number guessing, persists per chat until solved)
    {
        name: 'guess',
        async execute({ reply, args, m, prefix }) {
            const chatId = m.key.remoteJid;
            let game = guessGames.get(chatId);

            if (!game) {
                game = { secret: rand(1, 100), attempts: 0, max: 7 };
                guessGames.set(chatId, game);
                return reply(`🔢 *GUESS THE NUMBER*\n\nMain ne 1-100 ke beech ek number socha hai.\n${game.max} chances hain.\nExample: ${prefix}guess 50\n\n👑 *MEHFOOZ MD*`);
            }

            const guessNum = parseInt(args[0]);
            if (isNaN(guessNum)) return reply(`🔢 *GUESS*\n\nNumber likhein.\nExample: ${prefix}guess 50\n\n👑 *MEHFOOZ MD*`);

            game.attempts++;
            if (guessNum === game.secret) {
                guessGames.delete(chatId);
                return reply(`🎉 *CORRECT!*\n\nNumber tha: ${game.secret}\nAapne ${game.attempts} attempts mein guess kiya!\n\n👑 *MEHFOOZ MD*`);
            }
            if (game.attempts >= game.max) {
                guessGames.delete(chatId);
                return reply(`❌ *GAME OVER*\n\nChances khatam! Number tha: ${game.secret}\n\n👑 *MEHFOOZ MD*`);
            }
            const hint = guessNum < game.secret ? '⬆️ Higher jaiye' : '⬇️ Lower jaiye';
            return reply(`${hint}\n\nChances bachi: ${game.max - game.attempts}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 14) hangman
    {
        name: 'hangman',
        async execute({ reply, args, m, prefix }) {
            const chatId = m.key.remoteJid;
            let game = hangmanGames.get(chatId);

            if (!game || args[0]?.toLowerCase() === 'new') {
                const word = pickRandom(WORDS);
                game = { word, guessed: new Set(), wrong: 0, max: 6 };
                hangmanGames.set(chatId, game);
                const display = word.split('').map(() => '_').join(' ');
                return reply(`🪢 *HANGMAN (NEW GAME)*\n\nWord: ${display}\nGalat chances: 0/${game.max}\n\nHarf guess karein: ${prefix}hangman a\n\n👑 *MEHFOOZ MD*`);
            }

            const letter = (args[0] || '').toLowerCase();
            if (!letter || letter.length !== 1) return reply(`🪢 *HANGMAN*\n\nEk letter likhein.\nExample: ${prefix}hangman a\n\n👑 *MEHFOOZ MD*`);

            if (game.guessed.has(letter)) {
                return reply(`🪢 *HANGMAN*\n\n"${letter}" pehle hi try kiya hai.\n\n👑 *MEHFOOZ MD*`);
            }
            game.guessed.add(letter);

            if (!game.word.includes(letter)) game.wrong++;

            const display = game.word.split('').map(ch => (game.guessed.has(ch) ? ch : '_')).join(' ');
            const won = !display.includes('_');
            const lost = game.wrong >= game.max;

            if (won) {
                hangmanGames.delete(chatId);
                return reply(`🎉 *YOU WON!*\n\nWord tha: ${game.word}\n\n👑 *MEHFOOZ MD*`);
            }
            if (lost) {
                hangmanGames.delete(chatId);
                return reply(`💀 *GAME OVER*\n\nWord tha: ${game.word}\n\n👑 *MEHFOOZ MD*`);
            }
            return reply(`🪢 *HANGMAN*\n\nWord: ${display}\nGalat chances: ${game.wrong}/${game.max}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 15) tictactoe
    {
        name: 'tictactoe',
        async execute({ reply, args, m, prefix }) {
            const chatId = m.key.remoteJid;
            let game = tttGames.get(chatId);

            function render(board) {
                return board.map((c, i) => c || (i + 1)).join(' | ').match(/.{1,11}/g).join('\n---------\n');
            }
            function winner(board) {
                const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
                for (const [a, b, c] of lines) {
                    if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
                }
                return board.every(c => c) ? 'draw' : null;
            }

            if (!game || args[0]?.toLowerCase() === 'new') {
                game = { board: Array(9).fill(null) };
                tttGames.set(chatId, game);
                return reply(`❌⭕ *TIC TAC TOE (NEW GAME)*\n\nAap: ❌ | Bot: ⭕\nPosition (1-9) bhejein: ${prefix}tictactoe 5\n\n${render(game.board)}\n\n👑 *MEHFOOZ MD*`);
            }

            const pos = parseInt(args[0]) - 1;
            if (isNaN(pos) || pos < 0 || pos > 8) return reply(`❌⭕ *TIC TAC TOE*\n\nPosition 1-9 likhein.\nExample: ${prefix}tictactoe 5\n\n👑 *MEHFOOZ MD*`);
            if (game.board[pos]) return reply(`❌⭕ *TIC TAC TOE*\n\nYe cell already filled hai, dusra try karein.\n\n👑 *MEHFOOZ MD*`);

            game.board[pos] = '❌';
            let w = winner(game.board);
            if (w) {
                tttGames.delete(chatId);
                const msg = w === 'draw' ? '🤝 Match draw ho gaya!' : '🎉 Aap jeet gaye!';
                return reply(`❌⭕ *TIC TAC TOE*\n\n${render(game.board)}\n\n${msg}\n\n👑 *MEHFOOZ MD*`);
            }

            // bot move
            const empty = game.board.map((c, i) => (c ? null : i)).filter(i => i !== null);
            const botMove = pickRandom(empty);
            game.board[botMove] = '⭕';
            w = winner(game.board);
            if (w) {
                tttGames.delete(chatId);
                const msg = w === 'draw' ? '🤝 Match draw ho gaya!' : '🤖 Bot jeet gaya!';
                return reply(`❌⭕ *TIC TAC TOE*\n\n${render(game.board)}\n\n${msg}\n\n👑 *MEHFOOZ MD*`);
            }

            return reply(`❌⭕ *TIC TAC TOE*\n\n${render(game.board)}\n\nAapki baari: ${prefix}tictactoe <1-9>\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 16) chess (simplified — full engine nahi, opening suggestion + play link)
    {
        name: 'chess',
        async execute({ reply }) {
            const openings = [
                'Sicilian Defense (1. e4 c5)',
                "Queen's Gambit (1. d4 d5 2. c4)",
                'Ruy Lopez (1. e4 e5 2. Nf3 Nc6 3. Bb5)',
                'French Defense (1. e4 e6)',
                "King's Indian Defense (1. d4 Nf6 2. c4 g6)"
            ];
            return reply(
                `♟️ *CHESS*\n\n` +
                `Suggested opening: ${pickRandom(openings)}\n\n` +
                `Full chess board yahan WhatsApp text mein practical nahi, is liye live match yahan khelein:\nhttps://lichess.org/\n\n👑 *MEHFOOZ MD*`
            );
        }
    },

    // 17) cards
    {
        name: 'cards',
        async execute({ reply, args }) {
            const suits = ['♠️', '♥️', '♦️', '♣️'];
            const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
            const count = Math.min(Math.max(parseInt(args[0]) || 1, 1), 5);
            const drawn = Array.from({ length: count }, () => `${pickRandom(ranks)}${pickRandom(suits)}`);
            return reply(`🃏 *CARD DRAW*\n\n${drawn.join('  ')}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 18) slots
    {
        name: 'slots',
        async execute({ reply, args, m }) {
            const symbols = ['🍒', '🍋', '🍇', '🔔', '⭐', '7️⃣'];
            const reels = [pickRandom(symbols), pickRandom(symbols), pickRandom(symbols)];
            const win = reels[0] === reels[1] && reels[1] === reels[2];
            const senderId = m.key.participant || m.key.remoteJid;
            const bet = Math.max(parseInt(args[0]) || 0, 0);
            let extra = '';
            if (bet > 0) {
                const eco = getEco(senderId);
                if (bet > eco.balance) {
                    return reply(`🎰 *SLOTS*\n\nAapke paas itna balance nahi hai (Balance: ${eco.balance}).\n\n👑 *MEHFOOZ MD*`);
                }
                if (win) { eco.balance += bet * 3; extra = `\n💰 Jeet gaye! +${bet * 3} coins (Balance: ${eco.balance})`; }
                else { eco.balance -= bet; extra = `\n💸 Haar gaye! -${bet} coins (Balance: ${eco.balance})`; }
            }
            return reply(`🎰 *SLOTS*\n\n[ ${reels.join(' | ')} ]\n\n${win ? '🎉 JACKPOT!' : '😅 Try again!'}${extra}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 19) bet (coinflip gamble using economy balance)
    {
        name: 'bet',
        async execute({ reply, args, m, prefix }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const amount = parseInt(args[0]);
            const choice = (args[1] || '').toLowerCase();
            if (!amount || amount <= 0 || !['heads', 'tails'].includes(choice)) {
                return reply(`🎲 *BET*\n\nExample: ${prefix}bet 100 heads\n\n👑 *MEHFOOZ MD*`);
            }
            const eco = getEco(senderId);
            if (amount > eco.balance) return reply(`🎲 *BET*\n\nAapka balance sirf ${eco.balance} hai.\n\n👑 *MEHFOOZ MD*`);
            const result = Math.random() < 0.5 ? 'heads' : 'tails';
            if (result === choice) {
                eco.balance += amount;
                return reply(`🎲 *BET RESULT: ${result.toUpperCase()}*\n\n🎉 Jeet gaye! +${amount} coins\nBalance: ${eco.balance}\n\n👑 *MEHFOOZ MD*`);
            }
            eco.balance -= amount;
            return reply(`🎲 *BET RESULT: ${result.toUpperCase()}*\n\n😢 Haar gaye! -${amount} coins\nBalance: ${eco.balance}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 20) gamble (dice based, 50/50-ish)
    {
        name: 'gamble',
        async execute({ reply, args, m, prefix }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const amount = parseInt(args[0]);
            if (!amount || amount <= 0) return reply(`🎰 *GAMBLE*\n\nExample: ${prefix}gamble 200\n\n👑 *MEHFOOZ MD*`);
            const eco = getEco(senderId);
            if (amount > eco.balance) return reply(`🎰 *GAMBLE*\n\nAapka balance sirf ${eco.balance} hai.\n\n👑 *MEHFOOZ MD*`);
            const roll = rand(1, 6);
            if (roll >= 4) {
                eco.balance += amount;
                return reply(`🎰 *GAMBLE*\n\n🎲 Dice: ${roll}\n🎉 Jeet gaye! +${amount} coins\nBalance: ${eco.balance}\n\n👑 *MEHFOOZ MD*`);
            }
            eco.balance -= amount;
            return reply(`🎰 *GAMBLE*\n\n🎲 Dice: ${roll}\n😢 Haar gaye! -${amount} coins\nBalance: ${eco.balance}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 21) balance
    {
        name: 'balance',
        async execute({ reply, m }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const eco = getEco(senderId);
            return reply(`💰 *BALANCE*\n\nCoins: ${eco.balance}\nXP: ${eco.xp} (Level ${levelFromXP(eco.xp)})\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 22) daily
    {
        name: 'daily',
        async execute({ reply, m }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const eco = getEco(senderId);
            const now = Date.now();
            const DAY = 24 * 60 * 60 * 1000;
            if (now - eco.lastDaily < DAY) {
                const left = DAY - (now - eco.lastDaily);
                const hrs = Math.ceil(left / (60 * 60 * 1000));
                return reply(`🎁 *DAILY REWARD*\n\nAap already claim kar chuke hain. ${hrs}h baad dobara try karein.\n\n👑 *MEHFOOZ MD*`);
            }
            const reward = rand(100, 300);
            eco.balance += reward;
            eco.lastDaily = now;
            addXP(senderId, 10);
            return reply(`🎁 *DAILY REWARD*\n\n+${reward} coins mile!\nBalance: ${eco.balance}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 23) work
    {
        name: 'work',
        async execute({ reply, m }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const eco = getEco(senderId);
            const now = Date.now();
            const HOUR = 60 * 60 * 1000;
            if (now - eco.lastWork < HOUR) {
                const left = Math.ceil((HOUR - (now - eco.lastWork)) / 60000);
                return reply(`💼 *WORK*\n\nThodi der rest karein. ${left} minute baad dobara try karein.\n\n👑 *MEHFOOZ MD*`);
            }
            const jobs = ['Uber chalaya', 'Coding ki', 'Chai bechi', 'Delivery ki', 'Tuition parhaya'];
            const earned = rand(50, 200);
            eco.balance += earned;
            eco.lastWork = now;
            addXP(senderId, 5);
            return reply(`💼 *WORK*\n\nAapne "${pickRandom(jobs)}" — +${earned} coins mile!\nBalance: ${eco.balance}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 24) rob
    {
        name: 'rob',
        async execute({ reply, args, m, prefix }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const target = getTarget(m, args);
            if (!target) return reply(`🦹 *ROB*\n\nKisi ko tag/reply karke robbery karein.\nExample: ${prefix}rob @user\n\n👑 *MEHFOOZ MD*`);
            if (target === senderId) return reply('🦹 *ROB*\n\nApne aap ko rob nahi kar sakte!\n\n👑 *MEHFOOZ MD*');

            const eco = getEco(senderId);
            const now = Date.now();
            const COOLDOWN = 30 * 60 * 1000;
            if (now - eco.lastRob < COOLDOWN) {
                return reply('🦹 *ROB*\n\nAbhi thodi der rukein, cooldown chal raha hai.\n\n👑 *MEHFOOZ MD*');
            }
            eco.lastRob = now;

            const targetEco = getEco(target);
            if (targetEco.balance < 50) return reply('🦹 *ROB*\n\nIs banda ke paas rob karne layak balance nahi hai.\n\n👑 *MEHFOOZ MD*');

            const success = Math.random() < 0.5;
            if (success) {
                const stolen = Math.floor(targetEco.balance * 0.2);
                targetEco.balance -= stolen;
                eco.balance += stolen;
                return reply(`🦹 *ROB SUCCESS!*\n\n${stolen} coins chura liye!\nBalance: ${eco.balance}\n\n👑 *MEHFOOZ MD*`);
            }
            const fine = rand(50, 150);
            eco.balance = Math.max(0, eco.balance - fine);
            return reply(`🚨 *ROB FAILED!*\n\nPakde gaye! -${fine} coins fine.\nBalance: ${eco.balance}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 25) pay
    {
        name: 'pay',
        async execute({ reply, args, m, prefix }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const target = getTarget(m, args);
            const amount = parseInt(args.find(a => /^\d+$/.test(a)) || '');
            if (!target || !amount) return reply(`💸 *PAY*\n\nExample: ${prefix}pay @user 100\n\n👑 *MEHFOOZ MD*`);
            if (target === senderId) return reply('💸 *PAY*\n\nApne aap ko pay nahi kar sakte!\n\n👑 *MEHFOOZ MD*');

            const eco = getEco(senderId);
            if (amount > eco.balance) return reply(`💸 *PAY*\n\nAapka balance sirf ${eco.balance} hai.\n\n👑 *MEHFOOZ MD*`);

            eco.balance -= amount;
            const targetEco = getEco(target);
            targetEco.balance += amount;
            return reply(`💸 *PAYMENT SENT*\n\n${amount} coins ${shortNum(target)} ko bhej diye.\nAapka balance: ${eco.balance}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 26) shop
    {
        name: 'shop',
        async execute({ reply, prefix }) {
            const list = SHOP_ITEMS.map((it, i) => `${i + 1}. ${it.name} — 💰${it.price}`).join('\n');
            return reply(`🛒 *SHOP*\n────────────────────────\n${list}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 27) inventory
    {
        name: 'inventory',
        async execute({ reply, m }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const eco = getEco(senderId);
            if (!eco.inventory.length) return reply('🎒 *INVENTORY*\n\nAapki inventory khaali hai. Shop se items dekh ke apne aap add ho jayenge future updates mein.\n\n👑 *MEHFOOZ MD*');
            return reply(`🎒 *INVENTORY*\n\n${eco.inventory.map(i => `• ${i}`).join('\n')}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 28) profile
    {
        name: 'profile',
        async execute({ reply, m }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const eco = getEco(senderId);
            const partner = marriages.get(senderId);
            return reply(
                `🪪 *PROFILE*\n\n` +
                `👤 Name: ${m.pushName || 'Unknown'}\n` +
                `💰 Balance: ${eco.balance}\n` +
                `⭐ XP: ${eco.xp} (Level ${levelFromXP(eco.xp)})\n` +
                `💍 Married to: ${partner ? shortNum(partner) : 'Single'}\n\n👑 *MEHFOOZ MD*`
            );
        }
    },

    // 29) level
    {
        name: 'level',
        async execute({ reply, m }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const eco = getEco(senderId);
            const lvl = levelFromXP(eco.xp);
            const need = lvl * 100 - eco.xp;
            return reply(`⭐ *LEVEL*\n\nLevel: ${lvl}\nXP: ${eco.xp}\nNext level mein: ${need} XP baaki\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 30) rank
    {
        name: 'rank',
        async execute({ reply, m }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const sorted = [...economy.entries()].sort((a, b) => b[1].balance - a[1].balance);
            const idx = sorted.findIndex(([jid]) => jid === senderId);
            const position = idx === -1 ? sorted.length + 1 : idx + 1;
            return reply(`🏆 *RANK*\n\nAapki position: #${position} / ${Math.max(sorted.length, position)}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 31) leaderboard
    {
        name: 'leaderboard',
        async execute({ reply }) {
            const sorted = [...economy.entries()].sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
            if (!sorted.length) return reply('🏆 *LEADERBOARD*\n\nAbhi koi data nahi hai, .daily ya .work use karke shuru karein!\n\n👑 *MEHFOOZ MD*');
            const list = sorted.map(([jid, eco], i) => `${i + 1}. ${shortNum(jid)} — 💰${eco.balance}`).join('\n');
            return reply(`🏆 *LEADERBOARD*\n────────────────────────\n${list}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 32) top
    {
        name: 'top',
        async execute({ reply }) {
            const sorted = [...economy.entries()].sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
            if (!sorted.length) return reply('🏆 *TOP USERS*\n\nAbhi koi data nahi hai.\n\n👑 *MEHFOOZ MD*');
            const list = sorted.map(([jid, eco], i) => `${i + 1}. ${shortNum(jid)} — 💰${eco.balance}`).join('\n');
            return reply(`🏆 *TOP USERS*\n────────────────────────\n${list}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 33) global
    {
        name: 'global',
        async execute({ reply }) {
            const sorted = [...economy.entries()].sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
            if (!sorted.length) return reply('🌐 *GLOBAL LEADERBOARD*\n\nAbhi koi data nahi hai.\n\n👑 *MEHFOOZ MD*');
            const list = sorted.map(([jid, eco], i) => `${i + 1}. ${shortNum(jid)} — 💰${eco.balance}`).join('\n');
            return reply(`🌐 *GLOBAL LEADERBOARD*\n────────────────────────\n${list}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 34) local
    {
        name: 'local',
        async execute({ reply }) {
            const sorted = [...economy.entries()].sort((a, b) => b[1].balance - a[1].balance).slice(0, 10);
            if (!sorted.length) return reply('📍 *LOCAL LEADERBOARD*\n\nIs chat mein abhi koi data nahi hai.\n\n👑 *MEHFOOZ MD*');
            const list = sorted.map(([jid, eco], i) => `${i + 1}. ${shortNum(jid)} — 💰${eco.balance}`).join('\n');
            return reply(`📍 *LOCAL LEADERBOARD*\n────────────────────────\n${list}\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 35) marry
    {
        name: 'marry',
        async execute({ reply, args, m, prefix }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const target = getTarget(m, args);
            if (!target) return reply(`💍 *MARRY*\n\nKisi ko tag/reply karein.\nExample: ${prefix}marry @user\n\n👑 *MEHFOOZ MD*`);
            if (target === senderId) return reply('💍 *MARRY*\n\nApne aap se shaadi nahi ho sakti!\n\n👑 *MEHFOOZ MD*');
            if (marriages.has(senderId)) return reply(`💍 *MARRY*\n\nAap already ${shortNum(marriages.get(senderId))} se married hain.\n\n👑 *MEHFOOZ MD*`);
            if (marriages.has(target)) return reply('💍 *MARRY*\n\nYe user already kisi aur se married hai.\n\n👑 *MEHFOOZ MD*');
            marriages.set(senderId, target);
            marriages.set(target, senderId);
            return reply(`💍 *CONGRATULATIONS!*\n\n${shortNum(senderId)} aur ${shortNum(target)} ab officially married hain! 🎉\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 36) divorce
    {
        name: 'divorce',
        async execute({ reply, m }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const partner = marriages.get(senderId);
            if (!partner) return reply('💔 *DIVORCE*\n\nAap kisi se married hi nahi hain.\n\n👑 *MEHFOOZ MD*');
            marriages.delete(senderId);
            marriages.delete(partner);
            return reply(`💔 *DIVORCED*\n\n${shortNum(senderId)} aur ${shortNum(partner)} ab alag ho gaye.\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 37) ship
    {
        name: 'ship',
        async execute({ reply, args, m, prefix }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const target = getTarget(m, args);
            if (!target) return reply(`💘 *SHIP*\n\nKisi ko tag/reply karein.\nExample: ${prefix}ship @user\n\n👑 *MEHFOOZ MD*`);
            const percent = compatibility(senderId, target);
            return reply(`💘 *SHIP RESULT*\n\n${shortNum(senderId)} ❤️ ${shortNum(target)}\n\n${progressBar(percent)} ${percent}%\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 38) lovemeter
    {
        name: 'lovemeter',
        async execute({ reply, args, m, prefix }) {
            const senderId = m.key.participant || m.key.remoteJid;
            const target = getTarget(m, args);
            if (!target) return reply(`💗 *LOVE METER*\n\nKisi ko tag/reply karein.\nExample: ${prefix}lovemeter @user\n\n👑 *MEHFOOZ MD*`);
            const percent = compatibility(senderId, target);
            return reply(`💗 *LOVE METER*\n\n${progressBar(percent)} ${percent}%\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 39) crush
    {
        name: 'crush',
        async execute({ reply, args, m, prefix }) {
            const target = getTarget(m, args);
            if (!target) return reply(`😳 *CRUSH*\n\nKisi ko tag/reply karein.\nExample: ${prefix}crush @user\n\n👑 *MEHFOOZ MD*`);
            const percent = rand(50, 100);
            return reply(`😳 *CRUSH ALERT*\n\nKisi ka crush hai ${shortNum(target)} par... ${percent}% chances! 👀\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 40) hate
    {
        name: 'hate',
        async execute({ reply, args, m, prefix }) {
            const target = getTarget(m, args);
            if (!target) return reply(`😤 *HATE METER*\n\nKisi ko tag/reply karein.\nExample: ${prefix}hate @user\n\n👑 *MEHFOOZ MD*`);
            const percent = rand(0, 100);
            return reply(`😤 *HATE METER*\n\n${shortNum(target)} ke liye hate level: ${percent}%\n\n👑 *MEHFOOZ MD*`);
        }
    },

    // 41-50) action commands
    actionCommand('hug'),
    actionCommand('kiss'),
    actionCommand('slap'),
    actionCommand('kill'),
    actionCommand('punch'),
    actionCommand('kickuser'),
    actionCommand('bite'),
    actionCommand('lick'),
    actionCommand('pat'),
    actionCommand('poke')
];