const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');
const { createEmbed, createErrorEmbed, createSuccessEmbed } = require('../../utils/embedBuilder');
const { subscribeToStreamEvents } = require('../../utils/twitchSubscriptions');
const { getUserInfo } = require('../../utils/twitchApi'); // ← fix
const logger = require('../../utils/logger');   // ← fix

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stream')
        .setDescription('Stream-Benachrichtigung konfigurieren')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Richtet die Stream-Benachrichtigung ein')
            .addStringOption(opt => opt
                .setName('twitch-name')
                .setDescription('Twitch-Kanalname (z.B. hundekuchenlive)')
                .setRequired(true)
            )
            .addChannelOption(opt => opt
                .setName('kanal')
                .setDescription('Discord-Kanal für die Benachrichtigung')
                .setRequired(true)
            )
            .addRoleOption(opt => opt
                .setName('erwaehnung')
                .setDescription('Rolle die erwähnt werden soll (optional)')
                .setRequired(false)
            )
        )

        .addSubcommand(sub => sub
            .setName('status')
            .setDescription('Zeigt die aktuelle Stream-Konfiguration')
        )

        .addSubcommand(sub => sub
            .setName('disable')
            .setDescription('Deaktiviert die Stream-Benachrichtigung')
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        if (sub === 'setup') {
            await interaction.deferReply({ flags: 64 });
            const twitchName = interaction.options.getString('twitch-name').toLowerCase();
            const kanal = interaction.options.getChannel('kanal');
            const rolle = interaction.options.getRole('erwaehnung');

            try {
                const userInfo = await getUserInfo({ loginName: twitchName }); // ← fix
                if (!userInfo) {
                    return interaction.editReply({
                        embeds: [createErrorEmbed(`Twitch-Kanal \`${twitchName}\` wurde nicht gefunden!`)],
                    });
                }

                await subscribeToStreamEvents(userInfo.id);

                setGuildSettings(guildId, {
                    streamConfig: {
                        twitchUserId: userInfo.id,
                        twitchLogin: userInfo.login,
                        twitchName: userInfo.display_name,
                        channelId: kanal.id,
                        mentionRoleId: rolle?.id ?? null,
                        liveMessageId: null,
                    }
                });

                return interaction.editReply({
                    embeds: [createEmbed('success', '✅ Stream-Benachrichtigung eingerichtet!', [
                        `**Twitch-Kanal:** [${userInfo.display_name}](https://twitch.tv/${userInfo.login})`,
                        `**Discord-Kanal:** <#${kanal.id}>`,
                        `**Erwähnung:** ${rolle ? `<@&${rolle.id}>` : 'Keine'}`,
                        `\nWenn **${userInfo.display_name}** live geht, wird eine Benachrichtigung in <#${kanal.id}> gepostet!`,
                    ].join('\n'))],
                });
            } catch (error) {
                logger.error('Fehler beim Stream Setup', error);
                return interaction.editReply({
                    embeds: [createErrorEmbed('Fehler beim Einrichten der Benachrichtigung!')],
                });
            }
        }

        if (sub === 'status') {
            const stream = getGuildSettings(guildId).streamConfig;
            if (!stream) {
                return interaction.reply({
                    embeds: [createErrorEmbed('Keine Stream-Benachrichtigung konfiguriert!\nRichte sie ein mit `/stream setup`.')],
                    flags: 64,
                });
            }
            return interaction.reply({
                embeds: [createEmbed('info', '📺 Stream Konfiguration', [
                    `**Twitch-Kanal:** [${stream.twitchName}](https://twitch.tv/${stream.twitchLogin})`,
                    `**Discord-Kanal:** <#${stream.channelId}>`,
                    `**Erwähnung:** ${stream.mentionRoleId ? `<@&${stream.mentionRoleId}>` : 'Keine'}`,
                ].join('\n'))],
                flags: 64,
            });
        }

        if (sub === 'disable') {
            setGuildSettings(guildId, { streamConfig: null });
            return interaction.reply({
                embeds: [createSuccessEmbed('Stream-Benachrichtigung wurde deaktiviert!')],
                flags: 64,
            });
        }
    }
};