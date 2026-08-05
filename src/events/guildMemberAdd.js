const { createWelcomeEmbed, createEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/i18n');
const { getGuildSettings } = require('../utils/settingsManager');
const { isModuleEnabled } = require('../utils/moduleManager');
const logger = require('../utils/logger');

module.exports = {
    name: 'guildMemberAdd',
    once: false,
    async execute(member, client) {
        const guildId = member.guild.id;
        const settings = getGuildSettings(guildId);

        // ── Willkommensnachricht ────────────────────────────
        if (isModuleEnabled(guildId, 'welcome')) {
            const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
            if (channel) {
                const embed = createWelcomeEmbed(member)
                    .setTitle(t(guildId, 'welcome.title'))
                    .setDescription(t(guildId, 'welcome.description', { user: member }))
                    .spliceFields(0, 3,
                        { name: t(guildId, 'welcome.field_member'), value: member.user.tag, inline: true },
                        { name: t(guildId, 'welcome.field_joined'), value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`, inline: true },
                        { name: t(guildId, 'welcome.field_total'), value: t(guildId, 'welcome.field_total_value', { count: member.guild.memberCount }), inline: true }
                    );
                await channel.send({ embeds: [embed] });
            } else {
                logger.warn(`Willkommens-Kanal nicht gefunden für Guild ${guildId}`);
            }
        }

        // ── Verifizierungs-DM (optionaler Hinweis) ──────────
        if (!settings.verifyEnabled || !settings.verifyChannelId) return;

        const dmEmbed = createEmbed(
            'info',
            `🔐 Verifizierung erforderlich`,
            [
                `Willkommen auf **${member.guild.name}**!`,
                ``,
                `Um Zugang zu erhalten, verifiziere dich bitte in <#${settings.verifyChannelId}>.`,
                ``,
                `Falls du den Kanal nicht siehst: Öffne den Server und suche nach dem Verifizierungs-Kanal.`,
            ].join('\n')
        );

        // Nur DM — kein Fallback-Post im Channel wenn DMs deaktiviert
        // Der Verify-Kanal ist immer sichtbar und dient als Hauptweg
        await member.send({ embeds: [dmEmbed] }).catch(() => {
            logger.info(`DM nicht möglich für ${member.user.tag} — Verify-Kanal ist Hauptweg`);
        });
    }
};
