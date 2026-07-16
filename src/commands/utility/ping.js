const { SlashCommandBuilder } = require('discord.js');
const { createFieldEmbed } = require('../../utils/embedBuilder');
const { t } = require('../../utils/i18n')

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Zeigt die aktuelle Latenz der Hundehütte'),

    async execute(interaction, client) {
        const latency = Date.now() - interaction.createdTimestamp;
        const apiLatency = Math.round(client.ws.ping);
        const guildId = interaction.guild.id;

        const embed = createFieldEmbed('success', t(guildId, 'ping.title'), [
            { name: t(guildId, 'ping.bot_latency'), value: `\`${latency}ms\``, inline: true },
            { name: t(guildId, 'ping.api_latency'), value: `\`${apiLatency}ms\``, inline: true },
        ]);

        await interaction.reply({ embeds: [embed] });
    }
};
