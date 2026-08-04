const { getGuildSettings } = require('../utils/settingsManager');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/i18n');
const { isModuleEnabled } = require('../utils/moduleManager');
const logger = require('../utils/logger');

// Cache: userId -> [timestamp, timestamp, ...]
const spamCache = new Map();
const SPAM_WINDOW_MS = 5000; // Zeitfenster: 5 Sekunden
const SPAM_THRESHOLD = 3;    // Max. gleiche Nachrichten in diesem Fenster

module.exports = {
    name: 'messageCreate',
    once: false,
    async execute(message, client) {
        if (message.author.bot) return;
        if (!message.guild) return;
        if (!isModuleEnabled(message.guild.id, 'automod')) return;

        const settings = getGuildSettings(message.guild.id);
        const automod = settings.automod;
        if (!automod?.enabled) return;
        if (message.member.permissions.has('ManageMessages')) return;

        const content = message.content.toLowerCase();
        const logKanal = automod.logChannelId
            ? message.guild.channels.cache.get(automod.logChannelId)
            : null;

        // ── Filter 1: Verbotene Wörter ──────────────────────────
        if (automod.bannedWords?.length > 0) {
            const gefunden = automod.bannedWords.find(w => content.includes(w.toLowerCase()));
            if (gefunden) {
                await message.delete().catch(() => { });
                const warnung = await message.channel.send({
                    embeds: [createEmbed('warning',
                        t(message.guild.id, 'automod.removed_title'),
                        t(message.guild.id, 'automod.word_removed', { user: message.author })
                    )],
                });
                logger.automod('Verbotenes Wort', message.author.tag, `#${message.channel.name}`);
                setTimeout(() => warnung.delete().catch(() => { }), 5000);
                await logKanal?.send({
                    embeds: [createEmbed('error', '🚫 Auto Mod — Verbotenes Wort', [
                        `**Nutzer:** ${message.author.tag}`,
                        `**Kanal:** <#${message.channel.id}>`,
                        `**Wort:** \`${gefunden}\``,
                        `**Nachricht:** \`${message.content.substring(0, 200)}\``,
                        `**Zeit:** <t:${Math.floor(Date.now() / 1000)}:F>`,
                    ].join('\n'))],
                }).catch(() => { });
                return;
            }
        }

        // ── Filter 2: Link-Filter ───────────────────────────────
        if (automod.linkFilter) {
            const linkRegex = /(https?:\/\/|www\.)\S+/gi;
            if (linkRegex.test(content)) {
                await message.delete().catch(() => { });
                const warnung = await message.channel.send({
                    embeds: [createEmbed('warning',
                        t(message.guild.id, 'automod.link_title'),
                        t(message.guild.id, 'automod.link_removed', { user: message.author })
                    )],
                });
                logger.automod('Link blockiert', message.author.tag, `#${message.channel.name}`);
                setTimeout(() => warnung.delete().catch(() => { }), 5000);
                await logKanal?.send({
                    embeds: [createEmbed('error', '🔗 Auto Mod — Link blockiert', [
                        `**Nutzer:** ${message.author.tag}`,
                        `**Kanal:** <#${message.channel.id}>`,
                        `**Nachricht:** \`${message.content.substring(0, 200)}\``,
                        `**Zeit:** <t:${Math.floor(Date.now() / 1000)}:F>`,
                    ].join('\n'))],
                }).catch(() => { });
                return;
            }
        }

        // ── Filter 3: Spam-Filter (In-Memory-Cache) ─────────────
        if (automod.spamFilter) {
            const cacheKey = `${message.author.id}:${content}`;
            const now = Date.now();
            const times = (spamCache.get(cacheKey) ?? []).filter(t => now - t < SPAM_WINDOW_MS);
            times.push(now);
            spamCache.set(cacheKey, times);

            // Cache-Eintrag nach Zeitfenster automatisch aufräumen
            setTimeout(() => spamCache.delete(cacheKey), SPAM_WINDOW_MS);

            if (times.length >= SPAM_THRESHOLD) {
                spamCache.delete(cacheKey);
                await message.delete().catch(() => { });
                const warnung = await message.channel.send({
                    embeds: [createEmbed('warning',
                        t(message.guild.id, 'automod.spam_title'),
                        t(message.guild.id, 'automod.spam_detected', { user: message.author })
                    )],
                });
                logger.automod('Spam erkannt', message.author.tag, `#${message.channel.name}`);
                setTimeout(() => warnung.delete().catch(() => { }), 5000);
                await logKanal?.send({
                    embeds: [createEmbed('error', '📨 Auto Mod — Spam erkannt', [
                        `**Nutzer:** ${message.author.tag}`,
                        `**Kanal:** <#${message.channel.id}>`,
                        `**Nachricht:** \`${message.content.substring(0, 200)}\``,
                        `**Zeit:** <t:${Math.floor(Date.now() / 1000)}:F>`,
                    ].join('\n'))],
                }).catch(() => { });
                return;
            }
        }
    },
};
