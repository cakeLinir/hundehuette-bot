const { getGuildSettings } = require('../utils/settingsManager');
const { createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/i18n');
const { isModuleEnabled } = require('../utils/moduleManager');
const logger = require('../utils/logger');

module.exports = {
    name: 'messageCreate',
    once: false,

    async execute(message, client) {
        // Bots & DMs ignorieren
        if (message.author.bot) return;
        if (!message.guild) return;
        if (!isModuleEnabled(message.guild.id, 'automod')) return;

        const settings = getGuildSettings(message.guild.id);
        const automod = settings.automod;

        // Auto Mod nicht aktiv
        if (!automod || !automod.enabled) return;

        // Admins & Mods ignorieren
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
                    embeds: [createEmbed(
                        'warning',
                        t(message.guild.id, 'automod.removed_title'),
                        t(message.guild.id, 'automod.word_removed', { user: message.author })
                    )],
                });
                logger.automod('Verbotenes Wort', message.author.tag, `#${message.channel.name}`);

                // Warnung nach 5 Sekunden löschen
                setTimeout(() => warnung.delete().catch(() => { }), 5000);

                // Log
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
                    embeds: [createEmbed(
                        'warning',
                        t(message.guild.id, 'automod.link_title'),
                        t(message.guild.id, 'automod.link_removed', { user: message.author })
                    )],
                });;
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

        // ── Filter 3: Spam-Filter (gleiche Nachricht) ───────────
        if (automod.spamFilter) {
            const recent = await message.channel.messages
                .fetch({ limit: 5 })
                .catch(() => null);

            if (recent) {
                const userMessages = recent.filter(m =>
                    m.author.id === message.author.id &&
                    m.content.toLowerCase() === content &&
                    m.id !== message.id
                );

                if (userMessages.size >= 2) {
                    // Alle duplizierten Nachrichten löschen
                    await message.channel.bulkDelete(
                        [message, ...userMessages.values()], true
                    ).catch(() => { });

                    const warnung = await message.channel.send({
                        embeds: [createEmbed(
                            'warning',
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
        }
    }
};
