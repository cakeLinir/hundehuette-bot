const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

        // ── Willkommensnachricht ────────────────────────────
        if (isModuleEnabled(guildId, 'welcome')) {
            const welcomeChannelId = getGuildSettings(guildId).welcomeChannelId;
            const channel = member.guild.channels.cache.get(welcomeChannelId);

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

        // ── Verifizierung ───────────────────────────────────
        const settings = getGuildSettings(guildId);
        if (!settings.verifyEnabled || !settings.verifyRoleId) return;

        // Button — guildId im customId damit der Handler es auch aus DMs kennt
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`verify_btn:${guildId}`)
                .setLabel('Jetzt verifizieren')
                .setEmoji('🔐')
                .setStyle(ButtonStyle.Primary)
        );

        const verifyEmbed = createEmbed(
            'info',
            `🔐 Willkommen auf ${member.guild.name}!`,
            `Um Zugang zum Server zu erhalten, musst du dich einmalig verifizieren.\n\n` +
            `Klicke auf den Button um deine Identität per **Discord OAuth** zu bestätigen.\n` +
            `Dieser Vorgang dauert nur wenige Sekunden und ist vollständig sicher.`
        );

        // Erst per DM versuchen, Fallback: Willkommens-Kanal
        const dmGesendet = await member.send({ embeds: [verifyEmbed], components: [row] })
            .then(() => true)
            .catch(() => false);

        if (!dmGesendet) {
            const fallbackChannel = member.guild.channels.cache.get(settings.welcomeChannelId);
            if (fallbackChannel) {
                await fallbackChannel.send({
                    content: `${member}`,
                    embeds: [verifyEmbed],
                    components: [row],
                }).catch(() => { });
            }
        }
    }
};
