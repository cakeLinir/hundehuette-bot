const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const { createEmbed, createErrorEmbed } = require('../../utils/embedBuilder');
const { isModuleEnabled } = require('../../utils/moduleManager');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Löscht eine bestimmte Anzahl an Nachrichten')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addIntegerOption(opt => opt
            .setName('anzahl')
            .setDescription('Anzahl der Nachrichten die gelöscht werden sollen (1-100)')
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(true)
        )
        .addUserOption(opt => opt
            .setName('mitglied')
            .setDescription('Nur Nachrichten dieses Mitglieds löschen (optional)')
            .setRequired(false)
        ),

    async execute(interaction) {
        if (!isModuleEnabled(interaction.guild.id, 'moderation')) {
            return interaction.reply({
                embeds: [createErrorEmbed('Das Moderations-Modul ist auf diesem Server deaktiviert!')],
                ephemeral: true,
            });
        }
        const anzahl = interaction.options.getInteger('anzahl');
        const mitglied = interaction.options.getUser('mitglied');

        await interaction.deferReply({ ephemeral: true });

        try {
            // Nachrichten holen
            let nachrichten = await interaction.channel.messages.fetch({ limit: 100 });

            // Nach Mitglied filtern falls angegeben
            if (mitglied) {
                nachrichten = nachrichten.filter(m => m.author.id === mitglied.id);
            }

            // Auf gewünschte Anzahl begrenzen
            nachrichten = nachrichten.first(anzahl);

            if (nachrichten.length === 0) {
                return interaction.editReply({
                    embeds: [createErrorEmbed('Keine Nachrichten zum Löschen gefunden!')],
                });
            }

            await interaction.channel.bulkDelete(nachrichten, true);

            logger.modAction('CLEAR', interaction.channel.name, interaction.user.tag, `${nachrichten.length} Nachrichten`);

            await interaction.editReply({
                embeds: [createEmbed(
                    'success',
                    '🗑️ Nachrichten gelöscht!',
                    `**${nachrichten.length}** Nachricht(en) wurden gelöscht.\n` +
                    (mitglied ? `**Filter:** Nachrichten von ${mitglied.tag}` : '')
                )],
            });

        } catch (error) {
            logger.error('Fehler beim Clear', error);
            await interaction.editReply({
                embeds: [createErrorEmbed(
                    'Fehler beim Löschen!\n' +
                    '> Nachrichten die älter als **14 Tage** sind können nicht gelöscht werden.'
                )],
            });
        }
    }
};
