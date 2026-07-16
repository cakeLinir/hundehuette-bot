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
    }
};
