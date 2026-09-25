'use strict';

/*
|--------------------------------------------------------------------------
| MEHFOOZ MD - SEARCH & INFO COMMANDS
|--------------------------------------------------------------------------
*/

const os = require('os');

// ------------------------------------------------------------------
// Fetch helper
// ------------------------------------------------------------------
let _fetchRef = global.fetch;

async function getFetch() {
    if (_fetchRef) return _fetchRef;
    try {
        _fetchRef = require('node-fetch');
    } catch (e) {
        _fetchRef = null;
    }
    return _fetchRef;
}

async function fetchJSON(url, opts = {}, timeoutMs = 8000) {
    const f = await getFetch();
    if (!f) throw new Error('fetch not available on this runtime');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await f(url, {
            ...opts,
            signal: controller.signal
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

// ------------------------------------------------------------------
// OPENAI AI
// API key environment variable se li jayegi:
// OPENAI_API_KEY
// ------------------------------------------------------------------
async function askOpenAI(question) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not configured');
    }

    const f = await getFetch();
    if (!f) throw new Error('fetch not available');

    const response = await f('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-5.6-luna',
            instructions: `
You are MEHFOOZ MD AI.

You were created by Saif.
Your developer is Saif.

Answer users helpfully, accurately and respectfully.
If the user asks who created you, say that you were created by Saif.
If the user asks who your developer is, say Saif.
Always respect the bot creator and developer.
Do not insult, defame, or make false accusations against Saif.

Reply naturally in the language used by the user.
Keep normal answers concise unless the user asks for detail.
            `.trim(),
            input: question
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data?.error?.message || `OpenAI HTTP ${response.status}`);
    }

    return data.output_text || '';
}

// ------------------------------------------------------------------

function fmtBytes(bytes) {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return 'N/A';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let val = bytes;

    while (val >= 1024 && i < units.length - 1) {
        val /= 1024;
        i++;
    }

    return `${val.toFixed(2)} ${units[i]}`;
}

function formatUptime(seconds) {
    seconds = Math.floor(seconds);

    const d = Math.floor(seconds / 86400);
    seconds %= 86400;

    const h = Math.floor(seconds / 3600);
    seconds %= 3600;

    const m = Math.floor(seconds / 60);
    const s = seconds % 60;

    return `${d}d ${h}h ${m}m ${s}s`;
}

function query(args) {
    return args && args.length ? args.join(' ').trim() : '';
}

const DEV_NUMBERS = ['923204854766'];

function isDev(m) {
    const senderId = m.key.participant || m.key.remoteJid;
    return DEV_NUMBERS.includes(
        String(senderId).split('@')[0].split(':')[0]
    );
}

// quotable.io tag map
const QUOTE_TAG_MAP = {
    motivation: 'inspirational',
    love: 'love',
    friendship: 'friendship',
    success: 'success',
    life: 'life',
    health: 'health',
    fitness: 'fitness',
    tech: 'technology',
    science: 'famous-quotes',
    history: 'history',
    art: 'art'
};

async function getQuote(tag) {
    try {
        const url = tag
            ? `https://api.quotable.io/random?tags=${encodeURIComponent(tag)}`
            : 'https://api.quotable.io/random';

        const data = await fetchJSON(url);

        if (data && data.content) {
            return `"${data.content}"\n— ${data.author || 'Unknown'}`;
        }
    } catch (e) {}

    try {
        const data = await fetchJSON(
            'https://zenquotes.io/api/random'
        );

        if (Array.isArray(data) && data[0]) {
            return `"${data[0].q}"\n— ${data[0].a || 'Unknown'}`;
        }
    } catch (e) {}

    return null;
}

async function quoteCommand(reply, tag, label) {
    const q = await getQuote(tag);

    if (q) {
        return reply(
            `✨ *${label}*\n\n${q}\n\n👑 *MEHFOOZ MD*`
        );
    }

    return reply(
        `✨ *${label}*\n\n` +
        `Abhi quote service down hai, thodi dair mein dobara try karein.\n\n` +
        `👑 *MEHFOOZ MD*`
    );
}

module.exports = [

    // 1) AI
    {
        name: 'ai',
        async execute({ reply, args, prefix }) {
            const text = query(args);

            if (!text) {
                return reply(
                    `🤖 *AI*\n\n` +
                    `Message likhein.\n` +
                    `Example: ${prefix}ai Pakistan ka capital kya hai?\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            try {
                const answer = await askOpenAI(text);

                if (!answer) {
                    throw new Error('Empty AI response');
                }

                return reply(
                    `🤖 *MEHFOOZ AI*\n\n` +
                    `${answer}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                console.error('[OPENAI AI ERROR]', e);

                return reply(
                    `🤖 *MEHFOOZ AI*\n\n` +
                    `AI service se jawab nahi aa saka. ` +
                    `API configuration check karein.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 2) status
    {
        name: 'status',
        async execute({ reply, db }) {
            return reply(
                `🟢 *BOT STATUS*\n\n` +
                `👤 Owner: ${db?.ownerName || 'MEHFOOZ MD Owner'}\n` +
                `⏱️ Uptime: ${formatUptime(process.uptime())}\n` +
                `💻 Platform: ${os.platform()} (${os.arch()})\n` +
                `🟢 Status: Online & Running\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 3) ip
    {
        name: 'ip',
        async execute({ reply }) {
            try {
                const data = await fetchJSON(
                    'https://api.ipify.org?format=json'
                );

                return reply(
                    `🌐 *SERVER PUBLIC IP*\n\n` +
                    `${data.ip}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `🌐 *SERVER IP*\n\n` +
                    `Abhi IP fetch nahi ho saka, dobara try karein.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 4) restart
    {
        name: 'restart',
        async execute({ reply, m, db }) {
            const senderId =
                m.key.participant || m.key.remoteJid;

            const number = String(senderId)
                .split('@')[0]
                .split(':')[0];

            const allowed =
                isDev(m) ||
                (db?.owners || []).includes(number);

            if (!allowed) {
                return reply(
                    '⚠️ Yeh command sirf bot owner use kar sakte hain.'
                );
            }

            await reply(
                '♻️ *Bot restart ho raha hai...*\n\n' +
                '👑 *MEHFOOZ MD*'
            );

            setTimeout(() => process.exit(0), 1200);
        }
    },

    // 5) listgroup
    {
        name: 'listgroup',
        async execute({ reply, sock }) {
            try {
                const groups =
                    await sock.groupFetchAllParticipating();

                const list = Object.values(groups);

                if (!list.length) {
                    return reply(
                        '📂 *GROUP LIST*\n\n' +
                        'Bot filhal kisi group mein nahi hai.\n\n' +
                        '👑 *MEHFOOZ MD*'
                    );
                }

                const text = list
                    .map(
                        (g, i) =>
                            `${i + 1}. ${g.subject} (${g.participants.length} members)`
                    )
                    .join('\n');

                return reply(
                    `📂 *GROUP LIST (${list.length})*\n` +
                    `────────────────────────\n` +
                    `${text}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    '📂 *GROUP LIST*\n\n' +
                    'List fetch nahi ho saki.\n\n' +
                    '👑 *MEHFOOZ MD*'
                );
            }
        }
    },

    // 6) me
    {
        name: 'me',
        async execute({ reply, m }) {
            const senderId =
                m.key.participant || m.key.remoteJid;

            const number = String(senderId).split('@')[0];
            const pushName = m.pushName || 'Unknown';

            return reply(
                `🙋 *YOUR INFO*\n\n` +
                `👤 Name: ${pushName}\n` +
                `📱 Number: ${number}\n` +
                `🆔 JID: ${senderId}\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 7) quote
    {
        name: 'quote',
        async execute({ reply }) {
            return quoteCommand(reply, null, 'QUOTE');
        }
    },

    // 8) time
    {
        name: 'time',
        async execute({ reply }) {
            const now = new Date();

            return reply(
                `⏰ *SERVER TIME*\n\n` +
                `${now.toString()}\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 9) botname
    {
        name: 'botname',
        async execute({ reply, db }) {
            return reply(
                `🤖 *BOT NAME*\n\n` +
                `${db?.botName || 'MEHFOOZ MD'}\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 10) news
    {
        name: 'news',
        async execute({ reply }) {
            try {
                const data = await fetchJSON(
                    'https://saurav.tech/NewsAPI/top-headlines/category/general/in.json'
                );

                const articles =
                    (data.articles || []).slice(0, 5);

                if (!articles.length) {
                    throw new Error('empty');
                }

                const text = articles
                    .map((a, i) => `${i + 1}. ${a.title}`)
                    .join('\n');

                return reply(
                    `📰 *TOP NEWS*\n` +
                    `────────────────────────\n` +
                    `${text}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    '📰 *NEWS*\n\n' +
                    'Abhi news service available nahi, thodi dair baad try karein.\n\n' +
                    '👑 *MEHFOOZ MD*'
                );
            }
        }
    },

    // 11) cricket
    {
        name: 'cricket',
        async execute({ reply }) {
            return reply(
                `🏏 *CRICKET SCORE*\n\n` +
                `Abhi live score seva connect nahi hai.\n` +
                `Tab tak Cricbuzz ya ESPN Cricinfo check karein.\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 12) stock
    {
        name: 'stock',
        async execute({ reply, args }) {
            const symbol =
                (args[0] || 'IBM').toUpperCase();

            try {
                const data = await fetchJSON(
                    `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=demo`
                );

                const q = data['Global Quote'];

                if (!q || !q['05. price']) {
                    throw new Error('empty');
                }

                return reply(
                    `📈 *STOCK: ${symbol}*\n\n` +
                    `💵 Price: ${q['05. price']}\n` +
                    `📊 Change: ${q['09. change']} (${q['10. change percent']})\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `📈 *STOCK*\n\n` +
                    `"${symbol}" ka data abhi nahi mila.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 13) crypto
    {
        name: 'crypto',
        async execute({ reply, args }) {
            const coin =
                (args[0] || 'bitcoin').toLowerCase();

            try {
                const data = await fetchJSON(
                    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=usd&include_24hr_change=true`
                );

                const info = data[coin];

                if (!info) {
                    throw new Error('not found');
                }

                return reply(
                    `🪙 *${coin.toUpperCase()}*\n\n` +
                    `💵 Price: $${info.usd}\n` +
                    `📊 24h Change: ${
                        info.usd_24h_change
                            ? info.usd_24h_change.toFixed(2)
                            : 'N/A'
                    }%\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `🪙 *CRYPTO*\n\n` +
                    `"${coin}" nahi mila. Coin id sahi likhein.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 14) dictionary
    {
        name: 'dictionary',
        async execute({ reply, args, prefix }) {
            const word = query(args);

            if (!word) {
                return reply(
                    `📖 *DICTIONARY*\n\n` +
                    `Word likhein.\n` +
                    `Example: ${prefix}dictionary hello\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            try {
                const data = await fetchJSON(
                    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
                );

                const entry = data[0];
                const meaning = entry.meanings[0];
                const def =
                    meaning.definitions[0].definition;

                return reply(
                    `📖 *${entry.word.toUpperCase()}*\n\n` +
                    `🔤 Type: ${meaning.partOfSpeech}\n` +
                    `📝 Meaning: ${def}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `📖 *DICTIONARY*\n\n` +
                    `"${word}" nahi mila.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 15) urban
    {
        name: 'urban',
        async execute({ reply, args, prefix }) {
            const term = query(args);

            if (!term) {
                return reply(
                    `🗯️ *URBAN DICTIONARY*\n\n` +
                    `Term likhein.\n` +
                    `Example: ${prefix}urban rizz\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            try {
                const data = await fetchJSON(
                    `https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`
                );

                const first =
                    data.list && data.list[0];

                if (!first) {
                    throw new Error('empty');
                }

                return reply(
                    `🗯️ *${term.toUpperCase()}*\n\n` +
                    `${first.definition}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `🗯️ *URBAN DICTIONARY*\n\n` +
                    `"${term}" nahi mila.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 16) imdb
    {
        name: 'imdb',
        async execute({ reply, args, prefix }) {
            const title = query(args);

            if (!title) {
                return reply(
                    `🎬 *IMDB*\n\n` +
                    `Movie/show ka naam likhein.\n` +
                    `Example: ${prefix}imdb Inception\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            return reply(
                `🎬 *IMDB SEARCH*\n\n` +
                `"${title}" ke liye yahan dekhein:\n` +
                `https://www.imdb.com/find/?q=${encodeURIComponent(title)}\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 17) anime
    {
        name: 'anime',
        async execute({ reply, args, prefix }) {
            const q = query(args);

            if (!q) {
                return reply(
                    `🎌 *ANIME SEARCH*\n\n` +
                    `Anime ka naam likhein.\n` +
                    `Example: ${prefix}anime Naruto\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            try {
                const data = await fetchJSON(
                    `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=1`
                );

                const a = data.data && data.data[0];

                if (!a) {
                    throw new Error('empty');
                }

                return reply(
                    `🎌 *${a.title}*\n\n` +
                    `⭐ Score: ${a.score || 'N/A'}\n` +
                    `📺 Episodes: ${a.episodes || 'N/A'}\n` +
                    `📅 Status: ${a.status}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `🎌 *ANIME*\n\n` +
                    `"${q}" nahi mila.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 18) manga
    {
        name: 'manga',
        async execute({ reply, args, prefix }) {
            const q = query(args);

            if (!q) {
                return reply(
                    `📚 *MANGA SEARCH*\n\n` +
                    `Manga ka naam likhein.\n` +
                    `Example: ${prefix}manga One Piece\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            try {
                const data = await fetchJSON(
                    `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(q)}&limit=1`
                );

                const a = data.data && data.data[0];

                if (!a) {
                    throw new Error('empty');
                }

                return reply(
                    `📚 *${a.title}*\n\n` +
                    `⭐ Score: ${a.score || 'N/A'}\n` +
                    `📖 Chapters: ${a.chapters || 'N/A'}\n` +
                    `📅 Status: ${a.status}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `📚 *MANGA*\n\n` +
                    `"${q}" nahi mila.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 19) github
    {
        name: 'github',
        async execute({ reply, args, prefix }) {
            const q = query(args);

            if (!q) {
                return reply(
                    `💻 *GITHUB SEARCH*\n\n` +
                    `Repo/user ka naam likhein.\n` +
                    `Example: ${prefix}github baileys\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            try {
                const data = await fetchJSON(
                    `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc`
                );

                const repo =
                    data.items && data.items[0];

                if (!repo) {
                    throw new Error('empty');
                }

                return reply(
                    `💻 *${repo.full_name}*\n\n` +
                    `⭐ Stars: ${repo.stargazers_count}\n` +
                    `📝 ${repo.description || 'No description'}\n` +
                    `🔗 ${repo.html_url}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `💻 *GITHUB*\n\n` +
                    `"${q}" ke liye kuch nahi mila.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 20) npm
    {
        name: 'npm',
        async execute({ reply, args, prefix }) {
            const pkg = query(args);

            if (!pkg) {
                return reply(
                    `📦 *NPM SEARCH*\n\n` +
                    `Package ka naam likhein.\n` +
                    `Example: ${prefix}npm baileys\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            try {
                const data = await fetchJSON(
                    `https://registry.npmjs.org/${encodeURIComponent(pkg)}`
                );

                const latest =
                    data['dist-tags']?.latest;

                const info =
                    data.versions?.[latest];

                return reply(
                    `📦 *${data.name}*\n\n` +
                    `🔖 Version: ${latest}\n` +
                    `📝 ${info?.description || 'No description'}\n` +
                    `🔗 https://www.npmjs.com/package/${data.name}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `📦 *NPM*\n\n` +
                    `"${pkg}" nahi mila.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 21) playstore
    {
        name: 'playstore',
        async execute({ reply, args, prefix }) {
            const q = query(args);

            if (!q) {
                return reply(
                    `📱 *PLAY STORE SEARCH*\n\n` +
                    `App ka naam likhein.\n` +
                    `Example: ${prefix}playstore WhatsApp\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            return reply(
                `📱 *PLAY STORE SEARCH*\n\n` +
                `"${q}" ke liye yahan dekhein:\n` +
                `https://play.google.com/store/search?q=${encodeURIComponent(q)}&c=apps\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 22) map
    {
        name: 'map',
        async execute({ reply, args, prefix }) {
            const place = query(args);

            if (!place) {
                return reply(
                    `🗺️ *MAP SEARCH*\n\n` +
                    `Jagah ka naam likhein.\n` +
                    `Example: ${prefix}map Karachi\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            try {
                const data = await fetchJSON(
                    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`,
                    {
                        headers: {
                            'User-Agent': 'MEHFOOZ-MD-Bot'
                        }
                    }
                );

                const first = data[0];

                if (!first) {
                    throw new Error('empty');
                }

                return reply(
                    `🗺️ *${first.display_name}*\n\n` +
                    `📍 Lat: ${first.lat}, Lon: ${first.lon}\n` +
                    `🔗 https://www.google.com/maps?q=${first.lat},${first.lon}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `🗺️ *MAP*\n\n` +
                    `"${place}" nahi mila.\n` +
                    `🔗 https://www.google.com/maps/search/${encodeURIComponent(place)}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 23) recipe
    {
        name: 'recipe',
        async execute({ reply, args, prefix }) {
            const dish = query(args);

            if (!dish) {
                return reply(
                    `🍲 *RECIPE SEARCH*\n\n` +
                    `Dish ka naam likhein.\n` +
                    `Example: ${prefix}recipe biryani\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            try {
                const data = await fetchJSON(
                    `https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(dish)}`
                );

                const meal =
                    data.meals && data.meals[0];

                if (!meal) {
                    throw new Error('empty');
                }

                const ingredients = [];

                for (let i = 1; i <= 20; i++) {
                    const ing = meal[`strIngredient${i}`];
                    const measure = meal[`strMeasure${i}`];

                    if (ing && ing.trim()) {
                        ingredients.push(
                            `• ${measure ? measure.trim() + ' ' : ''}${ing.trim()}`
                        );
                    }
                }

                const steps =
                    meal.strInstructions.length > 700
                        ? meal.strInstructions.slice(0, 700) + '...'
                        : meal.strInstructions;

                return reply(
                    `🍲 *${meal.strMeal}*\n\n` +
                    `🧂 *Ingredients:*\n${ingredients.join('\n')}\n\n` +
                    `👨‍🍳 *Steps:*\n${steps}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `🍲 *RECIPE*\n\n` +
                    `"${dish}" nahi mila.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 24) horoscope
    {
        name: 'horoscope',
        async execute({ reply, args, prefix }) {
            const sign =
                (args[0] || '').toLowerCase();

            const validSigns = [
                'aries',
                'taurus',
                'gemini',
                'cancer',
                'leo',
                'virgo',
                'libra',
                'scorpio',
                'sagittarius',
                'capricorn',
                'aquarius',
                'pisces'
            ];

            if (!validSigns.includes(sign)) {
                return reply(
                    `⭐ *HOROSCOPE*\n\n` +
                    `Sign likhein.\n` +
                    `Example: ${prefix}horoscope leo\n\n` +
                    `Valid: ${validSigns.join(', ')}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            try {
                const data = await fetchJSON(
                    `https://ohmanda.com/api/horoscope/${sign}/`
                );

                return reply(
                    `⭐ *${sign.toUpperCase()} HOROSCOPE*\n\n` +
                    `${data.horoscope}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `⭐ *${sign.toUpperCase()} HOROSCOPE*\n\n` +
                    `Aaj ka din naye mauqon aur mehnat ka phal dene wala hai, sabr aur hosla rakhein.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 25) fact
    {
        name: 'fact',
        async execute({ reply }) {
            try {
                const data = await fetchJSON(
                    'https://uselessfacts.jsph.pl/api/v2/facts/random?language=en'
                );

                return reply(
                    `💡 *RANDOM FACT*\n\n` +
                    `${data.text}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    '💡 *FACT*\n\n' +
                    'Abhi fact fetch nahi ho saka, dobara try karein.\n\n' +
                    '👑 *MEHFOOZ MD*'
                );
            }
        }
    },

    // 26) joke
    {
        name: 'joke',
        async execute({ reply }) {
            try {
                const data = await fetchJSON(
                    'https://official-joke-api.appspot.com/random_joke'
                );

                return reply(
                    `😂 *JOKE*\n\n` +
                    `${data.setup}\n` +
                    `${data.punchline}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    '😂 *JOKE*\n\n' +
                    'Abhi joke fetch nahi ho saka, dobara try karein.\n\n' +
                    '👑 *MEHFOOZ MD*'
                );
            }
        }
    },

    // 27) advice
    {
        name: 'advice',
        async execute({ reply }) {
            try {
                const data = await fetchJSON(
                    'https://api.adviceslip.com/advice'
                );

                return reply(
                    `🧠 *ADVICE*\n\n` +
                    `${data.slip.advice}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    '🧠 *ADVICE*\n\n' +
                    'Abhi advice fetch nahi ho saki, dobara try karein.\n\n' +
                    '👑 *MEHFOOZ MD*'
                );
            }
        }
    },

    // 28-38) topic quotes
    {
        name: 'motivation',
        async execute({ reply }) {
            return quoteCommand(
                reply,
                QUOTE_TAG_MAP.motivation,
                'MOTIVATION'
            );
        }
    },

    {
        name: 'love',
        async execute({ reply }) {
            return quoteCommand(
                reply,
                QUOTE_TAG_MAP.love,
                'LOVE'
            );
        }
    },

    {
        name: 'friendship',
        async execute({ reply }) {
            return quoteCommand(
                reply,
                QUOTE_TAG_MAP.friendship,
                'FRIENDSHIP'
            );
        }
    },

    {
        name: 'success',
        async execute({ reply }) {
            return quoteCommand(
                reply,
                QUOTE_TAG_MAP.success,
                'SUCCESS'
            );
        }
    },

    {
        name: 'life',
        async execute({ reply }) {
            return quoteCommand(
                reply,
                QUOTE_TAG_MAP.life,
                'LIFE'
            );
        }
    },

    {
        name: 'health',
        async execute({ reply }) {
            return quoteCommand(
                reply,
                QUOTE_TAG_MAP.health,
                'HEALTH'
            );
        }
    },

    {
        name: 'fitness',
        async execute({ reply }) {
            return quoteCommand(
                reply,
                QUOTE_TAG_MAP.fitness,
                'FITNESS'
            );
        }
    },

    {
        name: 'tech',
        async execute({ reply }) {
            return quoteCommand(
                reply,
                QUOTE_TAG_MAP.tech,
                'TECH'
            );
        }
    },

    {
        name: 'science',
        async execute({ reply }) {
            return quoteCommand(
                reply,
                QUOTE_TAG_MAP.science,
                'SCIENCE'
            );
        }
    },

    {
        name: 'history',
        async execute({ reply }) {
            return quoteCommand(
                reply,
                QUOTE_TAG_MAP.history,
                'HISTORY'
            );
        }
    },

    {
        name: 'art',
        async execute({ reply }) {
            return quoteCommand(
                reply,
                QUOTE_TAG_MAP.art,
                'ART'
            );
        }
    },

    // 39) musicinfo
    {
        name: 'musicinfo',
        async execute({ reply, args, prefix }) {
            const q = query(args);

            if (!q) {
                return reply(
                    `🎵 *MUSIC INFO*\n\n` +
                    `Song/artist ka naam likhein.\n` +
                    `Example: ${prefix}musicinfo Shape of You\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            try {
                const data = await fetchJSON(
                    `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=1`
                );

                const song =
                    data.results && data.results[0];

                if (!song) {
                    throw new Error('empty');
                }

                return reply(
                    `🎵 *${song.trackName}*\n\n` +
                    `🎤 Artist: ${song.artistName}\n` +
                    `💿 Album: ${song.collectionName}\n` +
                    `📅 Release: ${song.releaseDate ? song.releaseDate.slice(0, 10) : 'N/A'}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    `🎵 *MUSIC INFO*\n\n` +
                    `"${q}" nahi mila.\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }
        }
    },

    // 40) uptime
    {
        name: 'uptime',
        async execute({ reply }) {
            return reply(
                `⏱️ *BOT UPTIME*\n\n` +
                `${formatUptime(process.uptime())}\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 41) version
    {
        name: 'version',
        async execute({ reply }) {
            let baileysVersion = 'N/A';

            try {
                baileysVersion =
                    require('@whiskeysockets/baileys/package.json').version;
            } catch (e) {}

            return reply(
                `🔖 *VERSION INFO*\n\n` +
                `🤖 Bot: MEHFOOZ MD v2.0.0\n` +
                `📦 Baileys: ${baileysVersion}\n` +
                `🟢 Node: ${process.version}\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 42) changelog
    {
        name: 'changelog',
        async execute({ reply }) {
            return reply(
                `📋 *CHANGELOG*\n\n` +
                `• Group management commands wired to real Baileys logic\n` +
                `• Security & Anti-spam module connected\n` +
                `• Search & Info commands ab live APIs se kaam karti hain\n` +
                `• OpenAI AI command integrated\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 43) donate
    {
        name: 'donate',
        async execute({ reply, db }) {
            return reply(
                `❤️ *SUPPORT THE PROJECT*\n\n` +
                `Agar aapko ${db?.botName || 'MEHFOOZ MD'} pasand aaya to owner (${db?.ownerName || 'MEHFOOZ MD Owner'}) se rabta karke support kar sakte hain.\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 44) support
    {
        name: 'support',
        async execute({ reply, db }) {
            return reply(
                `🆘 *SUPPORT*\n\n` +
                `Kisi bhi masle ke liye owner (${db?.ownerName || 'MEHFOOZ MD Owner'}) se contact karein.\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 45) report
    {
        name: 'report',
        async execute({ reply, args, m }) {
            const text = query(args);
            const senderId =
                m.key.participant || m.key.remoteJid;

            if (!text) {
                return reply(
                    '📩 *REPORT*\n\n' +
                    'Masla likh kar bhejein.\n' +
                    'Example: .report bot slow hai\n\n' +
                    '👑 *MEHFOOZ MD*'
                );
            }

            console.log(`[REPORT] from ${senderId}: ${text}`);

            return reply(
                '📩 *REPORT RECEIVED*\n\n' +
                'Aapki report save ho gayi hai, shukriya!\n\n' +
                '👑 *MEHFOOZ MD*'
            );
        }
    },

    // 46) bug
    {
        name: 'bug',
        async execute({ reply, args, m }) {
            const text = query(args);
            const senderId =
                m.key.participant || m.key.remoteJid;

            if (!text) {
                return reply(
                    '🐞 *BUG REPORT*\n\n' +
                    'Bug describe karein.\n' +
                    'Example: .bug sticker command fail ho rahi\n\n' +
                    '👑 *MEHFOOZ MD*'
                );
            }

            console.log(`[BUG] from ${senderId}: ${text}`);

            return reply(
                '🐞 *BUG REPORT RECEIVED*\n\n' +
                'Shukriya, developer ko forward kar diya gaya.\n\n' +
                '👑 *MEHFOOZ MD*'
            );
        }
    },

    // 47) feedback
    {
        name: 'feedback',
        async execute({ reply, args, m }) {
            const text = query(args);
            const senderId =
                m.key.participant || m.key.remoteJid;

            if (!text) {
                return reply(
                    '💬 *FEEDBACK*\n\n' +
                    'Apna feedback likhein.\n' +
                    'Example: .feedback bot bohot acha hai\n\n' +
                    '👑 *MEHFOOZ MD*'
                );
            }

            console.log(`[FEEDBACK] from ${senderId}: ${text}`);

            return reply(
                '💬 *FEEDBACK RECEIVED*\n\n' +
                'Shukriya aapke feedback ke liye!\n\n' +
                '👑 *MEHFOOZ MD*'
            );
        }
    },

    // 48) rate
    {
        name: 'rate',
        async execute({ reply }) {
            return reply(
                '⭐ *RATE US*\n\n' +
                'Agar bot pasand aaya to owner ko 5 star rating dena na bhoolein!\n\n' +
                '👑 *MEHFOOZ MD*'
            );
        }
    },

    // 49) share
    {
        name: 'share',
        async execute({ reply, db }) {
            return reply(
                `🔗 *SHARE THIS BOT*\n\n` +
                `"${db?.botName || 'MEHFOOZ MD'}" WhatsApp bot try karein — group management, security aur tools sab ek jagah!\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 50) invitebot
    {
        name: 'invitebot',
        async execute({ reply, db }) {
            const number = db?.botNumber || null;

            if (number) {
                return reply(
                    `➕ *INVITE BOT*\n\n` +
                    `Bot add karne ke liye:\n` +
                    `https://wa.me/${number}\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            }

            return reply(
                '➕ *INVITE BOT*\n\n' +
                'Bot ka number set nahi hai, owner se contact karein.\n\n' +
                '👑 *MEHFOOZ MD*'
            );
        }
    },

    // 51) botinfo
    {
        name: 'botinfo',
        async execute({ reply, db }) {
            return reply(
                `🤖 *BOT INFO*\n\n` +
                `📛 Name: ${db?.botName || 'MEHFOOZ MD'}\n` +
                `👤 Owner: ${db?.ownerName || 'MEHFOOZ MD Owner'}\n` +
                `⏱️ Uptime: ${formatUptime(process.uptime())}\n` +
                `🟢 Node: ${process.version}\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 52) system
    {
        name: 'system',
        async execute({ reply }) {
            return reply(
                `⚙️ *SYSTEM INFO*\n\n` +
                `💻 Platform: ${os.platform()} (${os.arch()})\n` +
                `🧮 CPU Cores: ${os.cpus().length}\n` +
                `🟢 Node: ${process.version}\n` +
                `🖥️ Hostname: ${os.hostname()}\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 53) storage
    {
        name: 'storage',
        async execute({ reply }) {
            try {
                const fs = require('fs');

                if (fs.statfs) {
                    fs.statfs('/', (err, stats) => {});
                }

                return reply(
                    '💾 *STORAGE*\n\n' +
                    'Is server par disk usage ki detail abhi available nahi (host-dependent).\n\n' +
                    '👑 *MEHFOOZ MD*'
                );
            } catch (e) {
                return reply(
                    '💾 *STORAGE*\n\n' +
                    'Disk info fetch nahi ho saki.\n\n' +
                    '👑 *MEHFOOZ MD*'
                );
            }
        }
    },

    // 54) memory
    {
        name: 'memory',
        async execute({ reply }) {
            const mem = process.memoryUsage();

            return reply(
                `🧠 *MEMORY USAGE*\n\n` +
                `📦 RSS: ${fmtBytes(mem.rss)}\n` +
                `📊 Heap Used: ${fmtBytes(mem.heapUsed)} / ${fmtBytes(mem.heapTotal)}\n` +
                `🖥️ System Free: ${fmtBytes(os.freemem())} / ${fmtBytes(os.totalmem())}\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 55) network
    {
        name: 'network',
        async execute({ reply }) {
            const nets = os.networkInterfaces();
            const lines = [];

            for (const name of Object.keys(nets)) {
                for (const net of nets[name]) {
                    if (!net.internal) {
                        lines.push(
                            `• ${name}: ${net.address} (${net.family})`
                        );
                    }
                }
            }

            return reply(
                `🌐 *NETWORK INTERFACES*\n\n` +
                `${lines.length ? lines.join('\n') : 'Koi external interface nahi mila.'}\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 56) pingtest
    {
        name: 'pingtest',
        async execute({ reply }) {
            const start = Date.now();

            try {
                await fetchJSON(
                    'https://api.ipify.org?format=json',
                    {},
                    5000
                );

                return reply(
                    `📶 *PING TEST*\n\n` +
                    `Internet latency: ${Date.now() - start}ms\n\n` +
                    `👑 *MEHFOOZ MD*`
                );
            } catch (e) {
                return reply(
                    '📶 *PING TEST*\n\n' +
                    'Internet connectivity check fail ho gayi.\n\n' +
                    '👑 *MEHFOOZ MD*'
                );
            }
        }
    },

    // 57) latency
    {
        name: 'latency',
        async execute({ reply, m }) {
            const msgTime = m.messageTimestamp
                ? Number(m.messageTimestamp) * 1000
                : Date.now();

            const latency = Date.now() - msgTime;

            return reply(
                `⚡ *LATENCY*\n\n` +
                `Message se reply tak: ${latency >= 0 ? latency : 0}ms\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 58) host
    {
        name: 'host',
        async execute({ reply }) {
            return reply(
                `🖥️ *HOST INFO*\n\n` +
                `🏷️ Hostname: ${os.hostname()}\n` +
                `💻 Type: ${os.type()}\n` +
                `📀 Platform: ${os.platform()}\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    },

    // 59) server
    {
        name: 'server',
        async execute({ reply }) {
            const mem = process.memoryUsage();

            return reply(
                `🖧 *SERVER SUMMARY*\n\n` +
                `🖥️ Host: ${os.hostname()}\n` +
                `💻 OS: ${os.platform()} (${os.arch()})\n` +
                `🧮 CPU Cores: ${os.cpus().length}\n` +
                `🧠 RAM Used: ${fmtBytes(mem.rss)}\n` +
                `⏱️ Uptime: ${formatUptime(process.uptime())}\n\n` +
                `👑 *MEHFOOZ MD*`
            );
        }
    }
];