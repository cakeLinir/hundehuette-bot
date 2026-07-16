const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const { createEmbed, createErrorEmbed, createSuccessEmbed } = require('../../utils/embedBuilder');
const { isModuleEnabled } = require('../../utils/moduleManager');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kickt ein Mitglied vom Server')
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
        .addUserOption(opt => opt
            .setName('mitglied')
            .setDescription('Das Mitglied das gekickt werden soll')
            .setRequired(true)
        )
        .addStringOption(opt => opt
            .setName('grund')
            .setDescription('Grund für den Kick')
            .setRequired(false)
        ),

    async execute(interaction) {
        if (!isModuleEnabled(interaction.guild.id, 'moderation')) {
            return interaction.reply({
                embeds: [createErrorEmbed('Das Moderations-Modul ist auf diesem Server deaktiviert!')],
                ephemeral: true,
            });
        }
        const ziel = interaction.options.getMember('mitglied');
        const grund = interaction.options.getString('grund') ?? 'Kein Grund angegeben';

        // Prüfungen
        if (!ziel) {
            return interaction.reply({
                embeds: [createErrorEmbed('Dieses Mitglied wurde nicht gefunden!')],
                ephemeral: true,
            });
        }

        if (!ziel.kickable) {
            return interaction.reply({
                embeds: [createErrorEmbed(
                    'Ich kann dieses Mitglied nicht kicken!\n' +
                    'Meine Rolle ist möglicherweise niedriger als die des Mitglieds.'
                )],
                ephemeral: true,
            });
        }

        if (ziel.id === interaction.user.id) {
            return interaction.reply({
                embeds: [createErrorEmbed('Du kannst dich nicht selbst kicken!')],
                ephemeral: true,
            });
        }

        try {
            // DM an das Mitglied vor dem Kick
            await ziel.send({
                embeds: [createEmbed(
                    'warning',
                    '👢 Du wurdest gekickt!',
                    `Du wurdest von **${interaction.guild.name}** gekickt.\n` +
                    `**Grund:** ${grund}`
                )],
            }).catch(() => { }); // Fehler ignorieren falls DMs deaktiviert

            await ziel.kick(grund);

            logger.modAction('KICK', ziel.user.tag, interaction.user.tag, grund);

            await interaction.reply({
                embeds: [createEmbed(
                    'success',
                    '👢 Mitglied gekickt!',
                    `**Mitglied:** ${ziel.user.tag}\n` +
                    `**Grund:** ${grund}\n` +
                    `**Moderator:** ${interaction.user.tag}`
                )],
            });

        } catch (error) {
            logger.error('Fehler beim Kick', error);
            await interaction.reply({
                embeds: [createErrorEmbed('Beim Kick ist ein Fehler aufgetreten!')],
                ephemeral: true,
            });
        }
    }
};
