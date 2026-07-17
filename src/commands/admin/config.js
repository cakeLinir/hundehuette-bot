const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');
const { createEmbed, createErrorEmbed, createSuccessEmbed } = require('../../utils/embedBuilder');
const { t, getLang } = require('../../utils/i18n');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Konfiguriere die Hundehütte für diesen Server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        // ── Unterbefehl: Willkommens-Kanal setzen ──
        .addSubcommand(sub => sub
            .setName('welcome')
            .setDescription('Setzt den Willkommens-Kanal')
            .addChannelOption(opt => opt
                .setName('kanal')
                .setDescription('Der Kanal für Willkommensnachrichten')
                .setRequired(true)
            )
        )

        // ── Unterbefehl: Rollen-Button hinzufügen ──
        .addSubcommand(sub => sub
            .setName('rollen-add')
            .setDescription('Fügt einen Rollen-Button hinzu')
            .addRoleOption(opt => opt
                .setName('rolle')
                .setDescription('Die Rolle die vergeben werden soll')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('label')
                .setDescription('Text auf dem Button (z.B. "7 Days to Die")')
                .setRequired(true)
            )
            .addStringOption(opt => opt
                .setName('emoji')
                .setDescription('Emoji auf dem Button (z.B. 🧟)')
                .setRequired(false)
            )
        )

        // ── Unterbefehl: Rollen-Button entfernen ──
        .addSubcommand(sub => sub
            .setName('rollen-remove')
            .setDescription('Entfernt einen Rollen-Button')
            .addRoleOption(opt => opt
                .setName('rolle')
                .setDescription('Die Rolle deren Button entfernt werden soll')
                .setRequired(true)
            )
        )

        // ── Unterbefehl: Feedback-Kanal setzen ──
        .addSubcommand(sub => sub
            .setName('feedback-kanal')
            .setDescription('Setzt den Kanal für eingehende Feedbacks')
            .addChannelOption(opt => opt
                .setName('kanal')
                .setDescription('Der Kanal für Feedback-Nachrichten')
                .setRequired(true)
            )
        )

        // ── Unterbefehl: Aktuelle Config anzeigen ──
        .addSubcommand(sub => sub
            .setName('anzeigen')
            .setDescription('Zeigt die aktuelle Konfiguration dieses Servers')
        )

        // ── Unterbefehl: Auto Mod an/aus ──
        .addSubcommand(sub => sub
            .setName('automod')
            .setDescription('Aktiviert oder deaktiviert den Auto Mod')
            .addBooleanOption(opt => opt
                .setName('aktiv')
                .setDescription('Auto Mod aktivieren oder deaktivieren')
                .setRequired(true)
            )
        )

        // ── Unterbefehl: Auto Mod Log-Kanal ──
        .addSubcommand(sub => sub
            .setName('automod-log')
            .setDescription('Setzt den Log-Kanal für Auto Mod Aktionen')
            .addChannelOption(opt => opt
                .setName('kanal')
                .setDescription('Der Kanal für Auto Mod Logs')
                .setRequired(true)
            )
        )

        // ── Unterbefehl: Verbotenes Wort hinzufügen ──
        .addSubcommand(sub => sub
            .setName('automod-wort-add')
            .setDescription('Fügt ein verbotenes Wort hinzu')
            .addStringOption(opt => opt
                .setName('wort')
                .setDescription('Das verbotene Wort')
                .setRequired(true)
            )
        )

        // ── Unterbefehl: Verbotenes Wort entfernen ──
        .addSubcommand(sub => sub
            .setName('automod-wort-remove')
            .setDescription('Entfernt ein verbotenes Wort')
            .addStringOption(opt => opt
                .setName('wort')
                .setDescription('Das Wort das entfernt werden soll')
                .setRequired(true)
            )
        )

        // ── Unterbefehl: Link Filter ──
        .addSubcommand(sub => sub
            .setName('automod-links')
            .setDescription('Aktiviert oder deaktiviert den Link-Filter')
            .addBooleanOption(opt => opt
                .setName('aktiv')
                .setDescription('Link-Filter aktivieren oder deaktivieren')
                .setRequired(true)
            )
        )

        // ── Unterbefehl: Spam Filter ──
        .addSubcommand(sub => sub
            .setName('automod-spam')
            .setDescription('Aktiviert oder deaktiviert den Spam-Filter')
            .addBooleanOption(opt => opt
                .setName('aktiv')
                .setDescription('Spam-Filter aktivieren oder deaktivieren')
                .setRequired(true)
            )
        )

        // ── Unterbefehl: Sprache setzen ──
        .addSubcommand(sub => sub
            .setName('sprache')
            .setDescription('Setzt die Sprache des Bots')
            .addStringOption(opt => opt
                .setName('sprache')
                .setDescription('Wähle eine Sprache')
                .setRequired(true)
                .addChoices(
                    { name: '🇩🇪 Deutsch', value: 'de' },
                    { name: '🇬🇧 English', value: 'en' }
                )
            )
        ),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const settings = getGuildSettings(guildId);

        // ── Welcome ──────────────────────────────────────────────
        if (sub === 'welcome') {
            const kanal = interaction.options.getChannel('kanal');

            setGuildSettings(guildId, { welcomeChannelId: kanal.id });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Willkommens-Kanal wurde auf <#${kanal.id}> gesetzt!`
                )],
                ephemeral: true,
            });
        }

        // ── Feedback Kanal ───────────────────────────────────────
        if (sub === 'feedback-kanal') {
            const kanal = interaction.options.getChannel('kanal');

            setGuildSettings(guildId, { feedbackChannelId: kanal.id });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Feedback-Kanal wurde auf <#${kanal.id}> gesetzt!`
                )],
                ephemeral: true,
            });
        }

        // ── Rollen Add ───────────────────────────────────────────
        if (sub === 'rollen-add') {
            const rolle = interaction.options.getRole('rolle');
            const label = interaction.options.getString('label');
            const emoji = interaction.options.getString('emoji') ?? null;

            // Prüfen ob Rolle bereits existiert
            const existiert = settings.rollenButtons.find(b => b.roleId === rolle.id);
            if (existiert) {
                return interaction.reply({
                    embeds: [createErrorEmbed(
                        `Die Rolle **${rolle.name}** hat bereits einen Button!`
                    )],
                    ephemeral: true,
                });
            }

            // Max. 5 Buttons pro Reihe (Discord Limit)
            if (settings.rollenButtons.length >= 5) {
                return interaction.reply({
                    embeds: [createErrorEmbed(
                        'Maximal **5 Rollen-Buttons** sind möglich.\n' +
                        'Entferne zuerst einen Button mit `/config rollen-remove`.'
                    )],
                    ephemeral: true,
                });
            }

            settings.rollenButtons.push({ roleId: rolle.id, label, emoji });
            setGuildSettings(guildId, { rollenButtons: settings.rollenButtons });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Button für **${rolle.name}** wurde hinzugefügt!\n` +
                    `Führe \`/rollen-setup\` aus um die Nachricht zu aktualisieren.`
                )],
                ephemeral: true,
            });
        }

        // ── Rollen Remove ────────────────────────────────────────
        if (sub === 'rollen-remove') {
            const rolle = interaction.options.getRole('rolle');
            const vorher = settings.rollenButtons.length;

            settings.rollenButtons = settings.rollenButtons.filter(
                b => b.roleId !== rolle.id
            );

            if (settings.rollenButtons.length === vorher) {
                return interaction.reply({
                    embeds: [createErrorEmbed(
                        `Für die Rolle **${rolle.name}** existiert kein Button.`
                    )],
                    ephemeral: true,
                });
            }

            setGuildSettings(guildId, { rollenButtons: settings.rollenButtons });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Button für **${rolle.name}** wurde entfernt!\n` +
                    `Führe \`/rollen-setup\` aus um die Nachricht zu aktualisieren.`
                )],
                ephemeral: true,
            });
        }

        // ── Anzeigen ─────────────────────────────────────────────
        if (sub === 'anzeigen') {

            const welcomeKanal = settings.welcomeChannelId
                ? `<#${settings.welcomeChannelId}>`
                : t(guildId, 'config.not_set');

            const feedbackKanal = settings.feedbackChannelId
                ? `<#${settings.feedbackChannelId}>`
                : t(guildId, 'config.not_set');

            const ticketKategorie = settings.ticketCategoryId
                ? `\`${settings.ticketCategoryId}\``
                : t(guildId, 'config.not_set');

            const sprache = getLang(guildId) === 'de'
                ? '🇩🇪 Deutsch'
                : '🇬🇧 English';

            const rollenListe = settings.rollenButtons?.length > 0
                ? settings.rollenButtons
                    .map(b => `${b.emoji ?? '▫️'} **${b.label}** → <@&${b.roleId}>`)
                    .join('\n')
                : t(guildId, 'config.no_buttons');

            const automod = settings.automod;
            const automodStatus = automod?.enabled
                ? [
                    `✅ **Aktiv**`,
                    `📋 Log-Kanal: ${automod.logChannelId ? `<#${automod.logChannelId}>` : t(guildId, 'config.not_set')}`,
                    `🔗 Link-Filter: ${automod.linkFilter ? '✅' : '❌'}`,
                    `📨 Spam-Filter: ${automod.spamFilter ? '✅' : '❌'}`,
                    `🚫 Verbotene Wörter: \`${automod.bannedWords?.length ?? 0}\` Einträge`,
                ].join('\n')
                : '❌ **Deaktiviert**';

            return interaction.reply({
                embeds: [createEmbed('info', t(guildId, 'config.overview_title'), [
                    `**🌐 Sprache:** ${sprache}`,
                    `**👋 Willkommens-Kanal:** ${welcomeKanal}`,
                    `**💬 Feedback-Kanal:** ${feedbackKanal}`,
                    `**🎫 Ticket-Kategorie:** ${ticketKategorie}`,
                    `\n**🛡️ Auto Mod:**\n${automodStatus}`,
                    `\n**🎮 Rollen-Buttons:**\n${rollenListe}`,
                ].join('\n'))],
                ephemeral: true,
            });
        }


        // ── Auto Mod an/aus ──────────────────────────────────────
        if (sub === 'automod') {
            const aktiv = interaction.options.getBoolean('aktiv');

            const automod = settings.automod ?? {
                enabled: false,
                logChannelId: null,
                bannedWords: [],
                linkFilter: false,
                spamFilter: false,
            };

            automod.enabled = aktiv;
            setGuildSettings(guildId, { automod });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Auto Mod wurde **${aktiv ? 'aktiviert ✅' : 'deaktiviert ❌'}**!`
                )],
                ephemeral: true,
            });
        }

        // ── Auto Mod Log Kanal ───────────────────────────────────
        if (sub === 'automod-log') {
            const kanal = interaction.options.getChannel('kanal');
            const automod = settings.automod ?? {};

            automod.logChannelId = kanal.id;
            setGuildSettings(guildId, { automod });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Auto Mod Log-Kanal wurde auf <#${kanal.id}> gesetzt!`
                )],
                ephemeral: true,
            });
        }

        // ── Verbotenes Wort Add ──────────────────────────────────
        if (sub === 'automod-wort-add') {
            const wort = interaction.options.getString('wort').toLowerCase();
            const automod = settings.automod ?? { bannedWords: [] };

            if (!automod.bannedWords) automod.bannedWords = [];

            if (automod.bannedWords.includes(wort)) {
                return interaction.reply({
                    embeds: [createErrorEmbed(`Das Wort \`${wort}\` ist bereits auf der Liste!`)],
                    ephemeral: true,
                });
            }

            automod.bannedWords.push(wort);
            setGuildSettings(guildId, { automod });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Das Wort \`${wort}\` wurde zur Wortliste hinzugefügt!`
                )],
                ephemeral: true,
            });
        }

        // ── Verbotenes Wort Remove ───────────────────────────────
        if (sub === 'automod-wort-remove') {
            const wort = interaction.options.getString('wort').toLowerCase();
            const automod = settings.automod ?? { bannedWords: [] };

            if (!automod.bannedWords?.includes(wort)) {
                return interaction.reply({
                    embeds: [createErrorEmbed(`Das Wort \`${wort}\` ist nicht auf der Liste!`)],
                    ephemeral: true,
                });
            }

            automod.bannedWords = automod.bannedWords.filter(w => w !== wort);
            setGuildSettings(guildId, { automod });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Das Wort \`${wort}\` wurde von der Wortliste entfernt!`
                )],
                ephemeral: true,
            });
        }

        // ── Link Filter ──────────────────────────────────────────
        if (sub === 'automod-links') {
            const aktiv = interaction.options.getBoolean('aktiv');
            const automod = settings.automod ?? {};

            automod.linkFilter = aktiv;
            setGuildSettings(guildId, { automod });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Link-Filter wurde **${aktiv ? 'aktiviert ✅' : 'deaktiviert ❌'}**!`
                )],
                ephemeral: true,
            });
        }

        // ── Spam Filter ──────────────────────────────────────────
        if (sub === 'automod-spam') {
            const aktiv = interaction.options.getBoolean('aktiv');
            const automod = settings.automod ?? {};

            automod.spamFilter = aktiv;
            setGuildSettings(guildId, { automod });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    `Spam-Filter wurde **${aktiv ? 'aktiviert ✅' : 'deaktiviert ❌'}**!`
                )],
                ephemeral: true,
            });
        }
    }
};
