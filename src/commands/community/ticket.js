const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { createEmbed, createErrorEmbed, createSuccessEmbed } = require('../../utils/embedBuilder');
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');
const { t } = require('../../utils/i18n');
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
            .setName('transcript-kanal')
            .setDescription('Setzt den Kanal in dem Transcripts gespeichert werden')
            .addChannelOption(opt => opt
                .setName('kanal')
                .setDescription('Kanal für Ticket-Transcripts')
                .setRequired(true)
            )
        )

        .addSubcommand(sub => sub
            .setName('close')
            .setDescription('Schließt das aktuelle Ticket')
        )

        .addSubcommand(sub => sub
            .setName('user-add')
            .setDescription('Fügt einen Nutzer zum aktuellen Ticket hinzu')
            .addUserOption(opt => opt
                .setName('nutzer')
                .setDescription('Der Nutzer der Zugriff erhalten soll')
                .setRequired(true)
            )
        )

        .addSubcommand(sub => sub
            .setName('user-remove')
            .setDescription('Entfernt einen Nutzer aus dem aktuellen Ticket')
            .addUserOption(opt => opt
                .setName('nutzer')
                .setDescription('Der Nutzer dessen Zugriff entfernt werden soll')
                .setRequired(true)
            )
        ),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const settings = getGuildSettings(guildId);
        const sub = interaction.options.getSubcommand();

        if (!isModuleEnabled(guildId, 'tickets')) {
            return interaction.reply({
                embeds: [createErrorEmbed('Das Ticket-Modul ist auf diesem Server deaktiviert!')],
                ephemeral: true,
            });
        }

        // ── Setup ────────────────────────────────────────────────
        if (sub === 'setup') {
            const kanal = interaction.options.getChannel('kanal');

            const embed = createEmbed(
                'info',
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

            setGuildSettings(guildId, { ticketCategoryId: kategorieId });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Ticket-Kategorie wurde auf **${kategorie.name}** gesetzt!`
                )],
                ephemeral: true,
            });
        }

        // ── Transcript Kanal ─────────────────────────────────────
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

        // ── Close ────────────────────────────────────────────────
        if (sub === 'close') {
            const tickets = settings.tickets ?? {};

            if (!tickets[interaction.channel.id]) {
                return interaction.reply({
                    embeds: [createErrorEmbed(t(guildId, 'ticket.not_a_ticket'))],
                    ephemeral: true,
                });
            }

            await interaction.reply({
                embeds: [createEmbed(
                    'warning',
                    t(guildId, 'ticket.closing_title'),
                    t(guildId, 'ticket.closing')
                )],
            });

            delete tickets[interaction.channel.id];
            setGuildSettings(guildId, { tickets });

            setTimeout(async () => {
                await interaction.channel.delete().catch(() => { });
            }, 5000);
            return;
        }

        // ── User Add ─────────────────────────────────────────────
        if (sub === 'user-add') {
            const tickets = settings.tickets ?? {};

            if (!tickets[interaction.channel.id]) {
                return interaction.reply({
                    embeds: [createErrorEmbed('Dieser Kanal ist kein Ticket!')],
                    ephemeral: true,
                });
            }

            const nutzer = interaction.options.getUser('nutzer');

            await interaction.channel.permissionOverwrites.create(nutzer.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
            });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `${nutzer} wurde zum Ticket hinzugefügt und kann nun mitlesen & schreiben.`
                )],
            });
        }

        // ── User Remove ──────────────────────────────────────────
        if (sub === 'user-remove') {
            const tickets = settings.tickets ?? {};

            if (!tickets[interaction.channel.id]) {
                return interaction.reply({
                    embeds: [createErrorEmbed('Dieser Kanal ist kein Ticket!')],
                    ephemeral: true,
                });
            }

            const nutzer = interaction.options.getUser('nutzer');

            if (tickets[interaction.channel.id].userId === nutzer.id) {
                return interaction.reply({
                    embeds: [createErrorEmbed(
                        'Der Ersteller des Tickets kann nicht entfernt werden!'
                    )],
                    ephemeral: true,
                });
            }

            await interaction.channel.permissionOverwrites.delete(nutzer.id);

            return interaction.reply({
                embeds: [createEmbed(
                    'warning',
                    '🚫 Zugriff entfernt',
                    `${nutzer} hat keinen Zugriff mehr auf dieses Ticket.`
                )],
            });
        }
    }
};
