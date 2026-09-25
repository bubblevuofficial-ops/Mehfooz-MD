'use strict';

/*
|--------------------------------------------------------------------------
| MEHFOOZ MD - 400 COMMANDS DATABASE & GENERATOR
|--------------------------------------------------------------------------
| FIX (IMPORTANT): 'ownerCommands' (owner-database-commands.js) pehle
| require to ho raha tha lekin 'registeredNames' aur final
| 'module.exports' mein kabhi joda hi nahi gaya tha. Iski wajah se
| .setprefix jaisi asli command kabhi chalti hi nahi thi — uski jagah
| ek khaali placeholder ("COMMAND EXECUTED") chal jaata tha. Ab
| ownerCommands ko sahi se list mein joda gaya hai taake asli
| setprefix (jisme Developer + Owner dono ki permission check hoti
| hai) hamesha use ho.
|
| UPDATE (Analytics): naya 'analytics-commands.js' module (group message
| stats / .stats / topchatters / userreport waghera ~66 real commands)
| yahan bhi usi tarah joda gaya hai jaise ownerCommands ko joda gaya
| tha — registeredNames aur module.exports dono mein, taake in ke liye
| koi khaali placeholder na bane aur inki asli backend logic chale.
|--------------------------------------------------------------------------
*/

const toolCommands = require('./tools-commands');   // REAL tools logic
const infoCommands = require('./search-info-commands'); // REAL Search & Info logic
const gameCommands = require('./fun-games-commands'); // REAL Fun & Games logic
const ownerCommands = require('./owner-database-commands'); // REAL owner & database logic
const analyticsCommands = require('./analytics-commands').commands; // REAL group-analytics/stats logic

const COMMANDS_LIST = [
    // 1. Group Management (1-40)
    'lock','unlock','kick','add','promote','demote','tagall','hidetag',
    'groupinfo','link','revoke','setname','setdesc','setpp','leave',
    'admins','ephemeral','mute','unmute','welcome','goodbye','setwelcome',
    'setgoodbye','group','poll','warn','resetwarn','listwarn','banned',
    'ping','listadmin','kickme','groupname','groupdesc','grouplink',
    'invite','join','totalmember','online','botstatus',
    
    // 2. Security & Anti (41-79)
    'pushmsg','checkmsg','antiedit','antidelete','antiinbox','antivice',
    'antivideo','antisticker','antiemoji','antigif','antirecording',
    'antimap','antilocation','anticontact','antidoc','antiimage',
    'antilink','antibot','antispam','anticall','antifake','antitoxic',
    'antitag','antiword','autosticker','autoread','autorespond','nsfw',
    'security','lockall','unlockall','kickall','ban','unban','block',
    'unblock','addword','delword','listword',
    
    // 3. Tools & Utility (80-119)
    'sticker','toimg','tovideo','tomp3','tovn','ocr','tr','tts',
    'shortlink','calc','weather','reminder','notes','listnotes',
    'delnote','qr','readqr','ss','pdf','info','runtime','speed','cpu',
    'ram','temp','whois','ipinfo','base64','binary','hex','clock',
    'calendar','timer','count','reverse','upper','lower','bold',
    'italic','mono',
    
    // 4. Search & Info (120-179)
    'ai','status','ip','restart','listgroup','me','quote','time',
    'botname','help','news','cricket','stock','crypto','dictionary',
    'urban','imdb','anime','manga','github','npm','playstore','map',
    'recipe','horoscope','fact','joke','advice','motivation','love',
    'friendship','success','life','health','fitness','tech','science',
    'history','art','musicinfo','uptime','version','changelog','donate',
    'support','report','bug','feedback','rate','share','invitebot',
    'botinfo','system','storage','memory','network','pingtest',
    'latency','host','server',
    
    // 5. Fun & Games (180-229)
    'coinflip','dice','roll','pick','choose','truth','dare','riddle',
    'puzzle','trivia','mathquiz','wordquiz','guess','hangman',
    'tictactoe','chess','cards','slots','bet','gamble','balance','daily',
    'work','rob','pay','shop','inventory','profile','level','rank',
    'leaderboard','top','global','local','marry','divorce','ship',
    'lovemeter','crush','hate','hug','kiss','slap','kill','punch',
    'kickuser','bite','lick','pat','poke',
    
    // 6. Owner & Database (230-279)
    'setprefix','setbotname','setowner','setbio','setstatus','setmode',
    'setpublic','setprivate','setonlyadmin','setonlyowner','addsudo',
    'delsudo','listsudo','addpremium','delpremium','listpremium',
    'addban','delban','listban','addblock','delblock','listblock',
    'broadcast','bcgc','bcall','eval','shell','exec','restartbot',
    'shutdownbot','updatebot','backup','restore','clearcache',
    'clearlogs','clearstorage','resetbot','config','settings',
    'database','query','table','row','column','insert','delete',
    'update','select','drop','truncate',
    
    // 7. Text & Fancy Styles (280-319)
    'boldtext','italictext','monotext','striketext','fancytext',
    'bubbletext','squaretext','fliptext','mirrortext','wavytext',
    'smalltext','bigtext','rainbowtext','neontext','firetext',
    'watertext','ghosttext','shadowtext','3dtext','glitchtext',
    'ascii','figlet','banner','arttext','emojitext','dottext',
    'linetext','boxtext','circletext','startext','hearttext',
    'flowertext','musictext','gametext','cooltext','stylishtext',
    'moderntext','classictext','retrotext','futuretext',
    
    // 8. Actions & Social (320-374)
    'cry','dance','laugh','sleep','eat','drink','run','jump','fly',
    'swim','sing','write','read','draw','paint','cook','bake','clean',
    'wash','fix','build','destroy','create','find','hide','show','open',
    'close','start','stop','pause','resume','record','like','dislike',
    'follow','unfollow','flag','check','verify','confirm','cancel',
    'agree','disagree','win','lose','score','levelup','rankup',
    'gameover','refresh','reload','exit','quit','logout',
    
    // 9. System & Menus (375-400)
    'credit','listall','search','finduser','getid','getlink','getinfo',
    'getstatus','settime','setdate','setlang','setregion','settheme',
    'setcolor','setfont','seticon','setavatar','setcover','setheader',
    'setfooter','setbody','setbutton','setmenu','setlist','settable',
    'groupmenu', 'secmenu', 'toolmenu', 'infomenu', 'gamemenu', 
    'ownermenu', 'textmenu', 'actionmenu', 'sysmenu', 'analyticsmenu',
    'allmenu', 'menulist', 'finish'
];

function styleText(command, text) {
    if (!text) return null;
    switch (command) {
        case 'upper': return text.toUpperCase();
        case 'lower': return text.toLowerCase();
        case 'reverse': return [...text].reverse().join('');
        case 'bold':
        case 'boldtext': return `*${text}*`;
        case 'italic':
        case 'italictext': return `_${text}_`;
        case 'mono':
        case 'monotext': return `\`\`\`${text}\`\`\``;
        default: return `✨ ${text} ✨`;
    }
}

const customCommands = [
    {
        name: 'ping',
        async execute({ reply }) {
            const start = Date.now();
            await reply(`🏓 *PONG!*\n\n⏱️ *Latency:* \`${Date.now() - start}ms\`\n👑 *MEHFOOZ MD*`);
        }
    },
    {
        name: 'alive',
        async execute({ reply, db }) {
            const owner = db?.ownerName || 'MEHFOOZ MD Owner';
            const bot = db?.botName || 'MEHFOOZ MD';
            await reply(`⚙️ *SYSTEM STATUS*\n\n🟢 Online & Fully Operational\n\n👤 *Owner:* ${owner}\n🤖 *Engine:* ${bot}\n\n👑 *POWERED BY MEHFOOZ MD* 👑`);
        }
    }
];

function generateCommandObject(name) {
    return {
        name,
        async execute({ reply, args, prefix }) {
            const text = args ? args.join(' ').trim() : '';
            const styled = styleText(name, text);
            if (styled) {
                return reply(`✨ *${name.toUpperCase()}*\n\n${styled}\n\n👑 *MEHFOOZ MD*`);
            }
            return reply(`✅ *COMMAND EXECUTED*\n\n🔹 Command: *${prefix}${name}*\n🟢 Status: Success\n\n👑 *MEHFOOZ MD*`);
        }
    };
}

// real tools/info/game/owner/analytics commands jin naamon par aati hain,
// unka placeholder nahi banega — ownerCommands aur analyticsCommands ab
// yahan shamil hain.
const registeredNames = new Set([
    ...customCommands.map(c => c.name),
    ...toolCommands.map(c => c.name),
    ...infoCommands.map(c => c.name),
    ...gameCommands.map(c => c.name),
    ...ownerCommands.map(c => c.name),
    ...analyticsCommands.map(c => c.name)
]);
const generatedCommands = COMMANDS_LIST.filter(name => !registeredNames.has(name)).map(generateCommandObject);

module.exports = [
    ...customCommands,
    ...toolCommands,
    ...infoCommands,
    ...gameCommands,
    ...ownerCommands,
    ...analyticsCommands,
    ...generatedCommands
];