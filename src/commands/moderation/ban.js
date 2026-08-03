const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const { createEmbed, createErrorEmbed } = require('../../utils/embedBuilder');
const { isModuleEnabled } = require('../../utils/moduleManager');
const logger = require('../../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bannt ein Mitglied vom Server')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .addUserOption(opt => opt
            .setName('mitglied')
            .setDescription('Das Mitglied das gebannt werden soll')
            .setRequired(true)
        )
        .addStringOption(opt => opt
            .setName('grund')
            .setDescription('Grund für den Ban')
            .setRequired(false)
        )
        .addIntegerOption(opt => opt
            .setName('nachrichten-loeschen')
            .setDescription('Nachrichten der letzten X Tage löschen (0-7)')
            .setMinValue(0)
            .setMaxValue(7)
            .setRequired(false)
        ),

    async execute(interaction) {
        if (!isModuleEnabled(interaction.guild.id, 'moderation')) {
            return interaction.reply({
                embeds: [createErrorEmbed('Das Moderations-Modul ist auf diesem Server deaktiviert!')],
                flags: 64, // Ephemeral + Suppress Embeds
            });
        }
        const ziel = interaction.options.getMember('mitglied');
        const grund = interaction.options.getString('grund') ?? 'Kein Grund angegeben';
        const tage = interaction.options.getInteger('nachrichten-loeschen') ?? 0;

        // Prüfungen
        if (!ziel) {
            return interaction.reply({
                embeds: [createErrorEmbed('Dieses Mitglied wurde nicht gefunden!')],
                flags: 64, // Ephemeral + Suppress Embeds
            });
        }

        if (!ziel.bannable) {
            return interaction.reply({
                embeds: [createErrorEmbed(
                    'Ich kann dieses Mitglied nicht bannen!\n' +
                    'Meine Rolle ist möglicherweise niedriger als die des Mitglieds.'
                )],
                flags: 64, // Ephemeral + Suppress Embeds
            });
        }

        if (ziel.id === interaction.user.id) {
            return interaction.reply({
                embeds: [createErrorEmbed('Du kannst dich nicht selbst bannen!')],
                flags: 64, // Ephemeral + Suppress Embeds
            });
        }

        try {
            // DM vor dem Ban
            await ziel.send({
                embeds: [createEmbed(
                    'error',
                    '🔨 Du wurdest gebannt!',
                    `Du wurdest von **${interaction.guild.name}** gebannt.\n` +
                    `**Grund:** ${grund}`
                )],
            }).catch(() => { });

            await ziel.ban({
                reason: grund,
                deleteMessageDays: tage,
            });

            logger.modAction('BAN', ziel.user.tag, interaction.user.tag, grund);

            await interaction.reply({
                embeds: [createEmbed(
                    'error',
                    '🔨 Mitglied gebannt!',
                    `**Mitglied:** ${ziel.user.tag}\n` +
                    `**Grund:** ${grund}\n` +
                    `**Nachrichten gelöscht:** Letzte ${tage} Tag(e)\n` +
                    `**Moderator:** ${interaction.user.tag}`
                )],
                flags: 64, // Ephemeral + Suppress Embeds
            });

        } catch (error) {
            logger.error('Fehler beim Ban', error);
            await interaction.reply({
                embeds: [createErrorEmbed('Beim Ban ist ein Fehler aufgetreten!')],
                flags: 64, // Ephemeral + Suppress Embeds
            });
        }
    }
};
