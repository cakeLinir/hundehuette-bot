const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { createEmbed, createErrorEmbed } = require('../../utils/embedBuilder');
const { getGuildSettings } = require('../../utils/settingsManager');
const { isModuleEnabled } = require('../../utils/moduleManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('feedback')
        .setDescription('Sende Feedback an das Team'),

    async execute(interaction) {
        if (!isModuleEnabled(interaction.guild.id, 'feedback')) {
            return interaction.reply({
                embeds: [createErrorEmbed('Das Feedback-Modul ist auf diesem Server deaktiviert!')],
                ephemeral: true,
            });
        }

        const settings = getGuildSettings(interaction.guild.id);
        if (!settings.feedbackChannelId) {
            return interaction.reply({
                embeds: [createErrorEmbed(
                    'Kein Feedback-Kanal konfiguriert!\n' +
                    'Bitte einen Admin `/config feedback-kanal` auszuführen.'
                )],
                ephemeral: true,
            });
        }

        // ── Dropdown 1: Identität ──
        const identitaetMenu = new StringSelectMenuBuilder()
            .setCustomId('feedback_identitaet')
            .setPlaceholder('👤 Wie möchtest du Feedback senden?')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(interaction.user.username)
                    .setDescription('Feedback mit deinem Namen senden')
                    .setValue('name')
                    .setEmoji('👤'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Anonym')
                    .setDescription('Feedback anonym senden')
                    .setValue('anonym')
                    .setEmoji('🕵️'),
            );

        // ── Dropdown 2: Kategorie ──
        const kategorieMenu = new StringSelectMenuBuilder()
            .setCustomId('feedback_kategorie')
            .setPlaceholder('📋 Kategorie auswählen')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Bot')
                    .setDescription('Feedback zum Discord Bot')
                    .setValue('Bot')
                    .setEmoji('🤖'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Server')
                    .setDescription('Feedback zum Discord Server')
                    .setValue('Server')
                    .setEmoji('🌐'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Stream')
                    .setDescription('Feedback zum Stream')
                    .setValue('Stream')
                    .setEmoji('🎥'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Allgemein')
                    .setDescription('Allgemeines Feedback')
                    .setValue('Allgemein')
                    .setEmoji('💬'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Sonstiges')
                    .setDescription('Anderes Thema — du kannst es im Formular beschreiben')
                    .setValue('Sonstiges')
                    .setEmoji('📝'),
            );

        // ── Button: Weiter ──
        const weiterButton = new ButtonBuilder()
            .setCustomId('feedback_weiter')
            .setLabel('Weiter →')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📬');

        await interaction.reply({
            embeds: [createEmbed(
                'info',
                '📬 Feedback senden',
                'Wähle zuerst deine **Identität** und die **Kategorie** aus.\n' +
                'Danach klicke auf **Weiter** um das Formular auszufüllen.\n\n' +
                '> 💡 **Tipp:** Du kannst in deinem Feedback Discord Markdown verwenden!\n' +
                '> `**fett**` → **fett**\n' +
                '> `__unterstrichen__` → __unterstrichen__\n' +
                '> `*kursiv*` → *kursiv*\n' +
                '> \\`code\\` → `code`\n' +
                '> `> zitat` → Zitat-Block'
            )],
            components: [
                new ActionRowBuilder().addComponents(identitaetMenu),
                new ActionRowBuilder().addComponents(kategorieMenu),
                new ActionRowBuilder().addComponents(weiterButton),
            ],
            ephemeral: true,
        });

    }
};
