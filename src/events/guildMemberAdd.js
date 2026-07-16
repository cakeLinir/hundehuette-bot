const { createWelcomeEmbed } = require('../utils/embedBuilder');
const { t } = require('../utils/i18n');
const { getGuildSettings } = require('../utils/settingsManager');
const { isModuleEnabled } = require('../utils/moduleManager');

module.exports = {
    name: 'guildMemberAdd',
    once: false,

    async execute(member, client) {
        if (!isModuleEnabled(member.guild.id, 'welcome')) return;
        const welcomeChannelId = getGuildSettings(member.guild.id).welcomeChannelId;

        const channel = member.guild.channels.cache.get(welcomeChannelId);
        if (!channel) {
            console.warn(`⚠️  Willkommens-Kanal nicht gefunden! ID: ${welcomeChannelId}`);
            return;
        }

        const embed = createWelcomeEmbed(member)
            .setTitle(t(guildId, 'welcome.title'))
            .setDescription(t(guildId, 'welcome.description', { user: member }))
            .spliceFields(0, 3,
                { name: t(guildId, 'welcome.field_member'), value: member.user.tag, inline: true },
                { name: t(guildId, 'welcome.field_joined'), value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                { name: t(guildId, 'welcome.field_total'), value: t(guildId, 'welcome.field_total_value', { count: member.guild.memberCount }), inline: true }
            );

        await channel.send({ embeds: [embed] });
    }
};