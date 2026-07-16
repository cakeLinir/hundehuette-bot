const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
} = require('discord.js');
const { createEmbed, createErrorEmbed } = require('../../utils/embedBuilder');
const { isModuleEnabled } = require('../../utils/moduleManager');

// Templates pro Kategorie
const TEMPLATES = {
    'Server News': [
        '📋 **Was ist neu?**',
        'Beschreibe hier die Neuigkeit...',
        '',
        '📅 **Ab wann?**',
        'Datum / Uhrzeit eintragen...',
        '',
        '📌 **Weitere Infos:**',
        'Zusätzliche Informationen...',
    ].join('\n'),

    'Bot News': [
        '🤖 **Was wurde geändert?**',
        'Beschreibe die Änderung...',
        '',
        '✨ **Neue Features:**',
        '- Feature 1',
        '- Feature 2',
        '',
        '🐛 **Bugfixes:**',
        '- Fix 1',
    ].join('\n'),

    'Twitch News': [
        '🎥 **Kanal Update:**',
        'Was gibt es Neues auf dem Kanal?',
        '',
        '📅 **Ab wann?**',
        'Datum eintragen...',
        '',
        '🔗 **Link:** twitch.tv/hundekuchenlive',
    ].join('\n'),

    'Stream News': [
        '🎮 **Was wird gespielt?**',
        'Spielname eintragen...',
        '',
        '📅 **Wann?**',
        'Datum eintragen...',
        '',
        '⏰ **Uhrzeit:** 00:00 Uhr',
        '',
        '👀 **Schaut vorbei auf:** twitch.tv/hundekuchenlive',
    ].join('\n'),

    'Event': [
        '🎉 **Event Name:**',
        'Name des Events...',
        '',
        '📅 **Datum & Uhrzeit:**',
        'Wann findet das Event statt?',
        '',
        '📍 **Wo?**',
        'Discord / Twitch / etc.',
        '',
        '🏆 **Was gibt es zu gewinnen?**',
        'Preis / Belohnung...',
    ].join('\n'),

    'Community': [
        '👥 **An die Community:**',
        'Deine Nachricht hier...',
        '',
        '💬 **Feedback / Fragen:**',
        'Wie kann die Community reagieren?',
    ].join('\n'),
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ankuendigung')
        .setDescription('Erstelle eine Ankündigung im Community-Stil'),

    async execute(interaction) {
        if (!isModuleEnabled(interaction.guild.id, 'announcements')) {
            return interaction.reply({
                embeds: [createErrorEmbed('Das Ankündigungs-Modul ist auf diesem Server deaktiviert!')],
                ephemeral: true,
            });
        }

        // ── Channel Select ──
        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId('ankuendigung_kanal')
            .setPlaceholder('📢 In welchem Kanal posten?')
            .setChannelTypes(ChannelType.GuildText);

        // ── Role Multiselect ──
        const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId('ankuendigung_rollen')
            .setPlaceholder('🔔 Wer soll gepingt werden? (optional)')
            .setMinValues(0)
            .setMaxValues(10);

        // ── Kategorie Select ──
        const kategorieSelect = new StringSelectMenuBuilder()
            .setCustomId('ankuendigung_kategorie')
            .setPlaceholder('📋 Kategorie auswählen')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Server News')
                    .setDescription('Neuigkeiten rund um den Discord Server')
                    .setValue('Server News')
                    .setEmoji('🌐'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Bot News')
                    .setDescription('Updates und Änderungen am Bot')
                    .setValue('Bot News')
                    .setEmoji('🤖'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Twitch News')
                    .setDescription('Neuigkeiten vom Twitch Kanal')
                    .setValue('Twitch News')
                    .setEmoji('🎥'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Stream News')
                    .setDescription('Infos zu bevorstehenden Streams')
                    .setValue('Stream News')
                    .setEmoji('🎮'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Event')
                    .setDescription('Community Events und Gewinnspiele')
                    .setValue('Event')
                    .setEmoji('🎉'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Community')
                    .setDescription('Allgemeine Nachrichten an die Community')
                    .setValue('Community')
                    .setEmoji('👥'),
            );

        // ── Weiter Button ──
        const weiterButton = new ButtonBuilder()
            .setCustomId('ankuendigung_weiter')
            .setLabel('Weiter →')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📢');

        await interaction.reply({
            embeds: [createEmbed(
                'info',
                '📢 Ankündigung erstellen',
                'Wähle den **Kanal**, die **Rollen** die gepingt werden sollen und die **Kategorie** aus.\n' +
                'Danach klicke auf **Weiter** um den Text zu verfassen.\n\n' +
                '> 💡 **Tipp:** Du kannst Discord Markdown verwenden!\n' +
                '> `**fett**` · `*kursiv*` · `__unterstrichen__` · `> Zitat`'
            )],
            components: [
                new ActionRowBuilder().addComponents(channelSelect),
                new ActionRowBuilder().addComponents(roleSelect),
                new ActionRowBuilder().addComponents(kategorieSelect),
                new ActionRowBuilder().addComponents(weiterButton),
            ],
            ephemeral: true,
        });
    }
};
