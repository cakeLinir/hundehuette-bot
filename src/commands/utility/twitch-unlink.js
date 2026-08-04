const { SlashCommandBuilder } = require('discord.js');
const { createEmbed, createErrorEmbed } = require('../../utils/embedBuilder');
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('twitch-unlink')
        .setDescription('Entfernt die Verknüpfung deines Twitch-Accounts'),

    async execute(interaction) {
        const guildId       = interaction.guild.id;
        const discordUserId = interaction.user.id;

        const settings    = getGuildSettings(guildId);
        const linkedUsers = settings.linkedTwitchUsers ?? {};
        const verknuepfung = linkedUsers[discordUserId];

        if (!verknuepfung) {
            return interaction.reply({
                embeds: [createErrorEmbed(
                    'Dein Discord-Account ist aktuell mit keinem Twitch-Account verknüpft.'
                )],
                flags: 64,
            });
        }

        const twitchName = verknuepfung.twitchName;

        delete linkedUsers[discordUserId];
        setGuildSettings(guildId, { linkedTwitchUsers: linkedUsers });

        return interaction.reply({
            embeds: [createEmbed(
                'success',
                '🔓 Twitch-Verknüpfung entfernt',
                `Die Verknüpfung mit **${twitchName}** wurde erfolgreich entfernt.\n\n` +
                'Du kannst jederzeit `/twitch-link` nutzen, um einen Account erneut zu verknüpfen.'
            )],
            flags: 64,
        });
    }
};
