const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { createEmbed, createErrorEmbed, createSuccessEmbed } = require('../../utils/embedBuilder');
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');
const { t } = require('../../utils/i18n')
const { isModuleEnabled } = require('../../utils/moduleManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Ticket System Verwaltung')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        .addSubcommand(sub => sub
            .setName('setup')
            .setDescription('Postet die Ticket-Erstell Nachricht')
            .addChannelOption(opt => opt
                .setName('kanal')
                .setDescription('Kanal in dem die Ticket-Nachricht gepostet wird')
                .setRequired(true)
            )
        )

        .addSubcommand(sub => sub
            .setName('category')
            .setDescription('Setzt die Kategorie für Ticket-Kanäle')
            .addStringOption(opt => opt
                .setName('kategorie-id')
                .setDescription('Die ID der Kategorie')
                .setRequired(true)
            )
        )

        .addSubcommand(sub => sub
            .setName('close')
            .setDescription('Schließt das aktuelle Ticket')
        )

        .addSubcommand(sub => sub
            .setName('add')
            .setDescription('Fügt einen Nutzer zum aktuellen Ticket hinzu')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('Der Nutzer der hinzugefügt werden soll')
                .setRequired(true)
            )
        )

        .addSubcommand(sub => sub
            .setName('remove')
            .setDescription('Entfernt einen Nutzer aus dem aktuellen Ticket')
            .addUserOption(opt => opt
                .setName('user')
                .setDescription('Der Nutzer der entfernt werden soll')
                .setRequired(true)
            )
        )

        .addSubcommand(sub => sub
            .setName('transcript-kanal')
            .setDescription('Setzt den Kanal in dem Transcripts gespeichert werden')
            .addChannelOption(opt => opt
                .setName('kanal')
                .setDescription('Kanal für Ticket-Transcripts')
                .setRequired(true)
            )
        ),


    async execute(interaction, client) {
        if (!isModuleEnabled(interaction.guild.id, 'tickets')) {
            return interaction.reply({
                embeds: [createErrorEmbed('Das Ticket-Modul ist auf diesem Server deaktiviert!')],
                ephemeral: true,
            });
        }
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const settings = getGuildSettings(guildId);

        // ── Setup ────────────────────────────────────────────────
        if (sub === 'setup') {
            const kanal = interaction.options.getChannel('kanal');

            const embed = createEmbed(
                'info',
                '🎫 Support Ticket',
                'Hast du ein Problem oder eine Frage?\n\n' +
                'Klicke auf den Button um ein Ticket zu öffnen.\n' +
                'Unser Team wird sich so schnell wie möglich bei dir melden!\n\n' +
                '> ⚠️ Bitte nur ein Ticket pro Anliegen öffnen.',
                t(guildId, 'ticket.panel_title'),
                t(guildId, 'ticket.panel_description')
            );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_erstellen')
                    .setLabel(t(guildId, 'ticket.btn_create'))
                    .setEmoji('🎫')
                    .setStyle(ButtonStyle.Primary)
            );

            await kanal.send({ embeds: [embed], components: [row] });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Ticket-Nachricht wurde in <#${kanal.id}> gepostet!`
                )],
                ephemeral: true,
            });
        }

        // ── Category ─────────────────────────────────────────────
        if (sub === 'category') {
            const kategorieId = interaction.options.getString('kategorie-id');
            const kategorie = interaction.guild.channels.cache.get(kategorieId);

            if (!kategorie || kategorie.type !== 4) {
                return interaction.reply({
                    embeds: [createErrorEmbed(
                        'Ungültige Kategorie-ID!\n' +
                        'Rechtsklick auf eine Kategorie → "ID kopieren"'
                    )],
                    ephemeral: true,
                });
            }

            setGuildSettings(interaction.guild.id, { ticketCategoryId: kategorieId });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Ticket-Kategorie wurde auf **${kategorie.name}** gesetzt!`
                )],
                ephemeral: true,
            });
        }

        // ── Close ────────────────────────────────────────────────
        if (sub === 'close') {
            const tickets = settings.tickets ?? {};

            // Prüfen ob dieser Kanal ein Ticket ist
            if (!tickets[interaction.channel.id]) {
                return interaction.reply({
                    embeds: [createErrorEmbed('Dieser Kanal ist kein Ticket!')],
                    ephemeral: true,
                });
            }

            await interaction.reply({
                embeds: [createEmbed(
                    'warning',
                    '🔒 Ticket wird geschlossen...',
                    'Dieser Kanal wird in **5 Sekunden** gelöscht.'
                )],
            });

            // Ticket aus Settings entfernen
            delete tickets[interaction.channel.id];
            setGuildSettings(interaction.guild.id, { tickets });

            setTimeout(async () => {
                await interaction.channel.delete().catch(() => { });
            }, 5000);
        }
        // ── Add User zum Ticket ───────────────────────────────────
        if (sub === 'add') {
            const tickets = settings.tickets ?? {};

            if (!tickets[interaction.channel.id]) {
                return interaction.reply({
                    embeds: [createErrorEmbed('Dieser Kanal ist kein Ticket!')],
                    ephemeral: true,
                });
            }

            const user = interaction.options.getUser('user');

            await interaction.channel.permissionOverwrites.create(user.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
            });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `${user} wurde zum Ticket hinzugefügt und kann nun den Verlauf sehen sowie schreiben.`
                )],
            });
        }

        // ── Remove User vom Ticket ────────────────────────────────
        if (sub === 'remove') {
            const tickets = settings.tickets ?? {};

            if (!tickets[interaction.channel.id]) {
                return interaction.reply({
                    embeds: [createErrorEmbed('Dieser Kanal ist kein Ticket!')],
                    ephemeral: true,
                });
            }

            const user = interaction.options.getUser('user');

            await interaction.channel.permissionOverwrites.delete(user.id);

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `${user} wurde aus dem Ticket entfernt und hat keinen Zugriff mehr.`
                )],
            });
        }

        // ── Transcript Kanal setzen ────────────────────────────────
        if (sub === 'transcript-kanal') {
            const kanal = interaction.options.getChannel('kanal');

            setGuildSettings(guildId, { transcriptChannelId: kanal.id });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Transcript-Kanal wurde auf <#${kanal.id}> gesetzt!`
                )],
                ephemeral: true,
            });
        }

    }
};
