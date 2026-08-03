const { SlashCommandBuilder } = require('discord.js');
const crypto = require('crypto');
const { createEmbed, createErrorEmbed } = require('../../utils/embedBuilder');
const { getGuildSettings } = require('../../utils/settingsManager');
const { oauthSessions } = require('../../utils/oauthSessions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('twitch-link')
        .setDescription('Verknüpfe deinen Twitch-Account mit Discord'),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const discordUserId = interaction.user.id;

        // Prüfen ob bereits verknüpft
        const settings = getGuildSettings(guildId);
        const linkedUsers = settings.linkedTwitchUsers ?? {};
        const bereitsLinked = linkedUsers[discordUserId];

        if (bereitsLinked) {
            return interaction.reply({
                embeds: [createEmbed(
                    'info',
                    '🔗 Bereits verknüpft',
                    `Dein Account ist bereits mit **${bereitsLinked.twitchName}** verknüpft.\n\n` +
                    `Möchtest du die Verknüpfung aufheben? Nutze \`/twitch-unlink\`.`
                )],
                flags: 64, // Ephemeral + Suppress Embeds
            });
        }

        // State Token generieren (verhindert CSRF)
        const state = crypto.randomBytes(16).toString('hex');

        // Session speichern (10 Minuten gültig)
        oauthSessions.set(state, {
            discordUserId,
            guildId,
            expiresAt: Date.now() + 10 * 60 * 1000,
        });

        // OAuth URL bauen
        const params = new URLSearchParams({
            client_id: process.env.TWITCH_CLIENT_ID,
            redirect_uri: `${process.env.BOT_URL}/auth/twitch/callback`,
            response_type: 'code',
            scope: 'user:read:email',
            state,
        });

        const oauthUrl = `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;

        return interaction.reply({
            embeds: [createEmbed(
                'info',
                '🔗 Twitch Account verknüpfen',
                'Klicke auf den Button um deinen Twitch-Account mit Discord zu verknüpfen.\n\n' +
                '> ⏱️ Der Link ist **10 Minuten** gültig.\n' +
                '> 🔒 Deine Daten werden sicher übertragen.'
            )],
            components: [
                {
                    type: 1,
                    components: [{
                        type: 2,
                        label: 'Mit Twitch verknüpfen',
                        style: 5,
                        url: oauthUrl,
                        emoji: { name: '🔗' },
                    }]
                }
            ],
            flags: 64, // Ephemeral + Suppress Embeds
        });
    }
};
