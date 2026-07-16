const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const { getModules, setModule, DEFAULT_MODULES } = require('../../utils/moduleManager');
const { createEmbed, createErrorEmbed, createSuccessEmbed } = require('../../utils/embedBuilder');
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');
const { t } = require('../../utils/i18n');

// Lesbare Namen & Beschreibungen für die Module
const MODULE_INFO = {
    welcome:       { name: '👋 Willkommen',       desc: 'Begrüßt neue Mitglieder automatisch'     },
    roles:         { name: '🎮 Rollen',            desc: 'Rollen-Vergabe via Buttons'              },
    tickets:       { name: '🎫 Tickets',           desc: 'Support Ticket System'                   },
    feedback:      { name: '📬 Feedback',          desc: 'Feedback System für Mitglieder'          },
    automod:       { name: '🛡️ Auto Mod',          desc: 'Automatische Nachrichten-Moderation'     },
    announcements: { name: '📢 Ankündigungen',     desc: 'Community Ankündigungen posten'          },
    moderation:    { name: '🔨 Moderation',        desc: 'Kick, Ban & Clear Befehle'               },
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('module')
        .setDescription('Aktiviere oder deaktiviere Bot-Module')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        // ── Modul aktivieren ──
        .addSubcommand(sub => sub
            .setName('enable')
            .setDescription('Aktiviert ein Modul')
            .addStringOption(opt => opt
                .setName('modul')
                .setDescription('Das Modul das aktiviert werden soll')
                .setRequired(true)
                .addChoices(
                    { name: '👋 Willkommen',   value: 'welcome'       },
                    { name: '🎮 Rollen',        value: 'roles'         },
                    { name: '🎫 Tickets',       value: 'tickets'       },
                    { name: '📬 Feedback',      value: 'feedback'      },
                    { name: '🛡️ Auto Mod',      value: 'automod'       },
                    { name: '📢 Ankündigungen', value: 'announcements' },
                    { name: '🔨 Moderation',    value: 'moderation'    },
                )
            )
        )

        // ── Modul deaktivieren ──
        .addSubcommand(sub => sub
            .setName('disable')
            .setDescription('Deaktiviert ein Modul')
            .addStringOption(opt => opt
                .setName('modul')
                .setDescription('Das Modul das deaktiviert werden soll')
                .setRequired(true)
                .addChoices(
                    { name: '👋 Willkommen',   value: 'welcome'       },
                    { name: '🎮 Rollen',        value: 'roles'         },
                    { name: '🎫 Tickets',       value: 'tickets'       },
                    { name: '📬 Feedback',      value: 'feedback'      },
                    { name: '🛡️ Auto Mod',      value: 'automod'       },
                    { name: '📢 Ankündigungen', value: 'announcements' },
                    { name: '🔨 Moderation',    value: 'moderation'    },
                )
            )
        )

        // ── Alle Module anzeigen ──
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('Zeigt alle Module und ihren Status')
        )

        // ── Sprache setzen ──
        .addSubcommand(sub => sub
            .setName('sprache')
            .setDescription('Setzt die Sprache des Bots für diesen Server')
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
        const sub     = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;

        // ── Enable ───────────────────────────────────────────────
        if (sub === 'enable') {
            const modul = interaction.options.getString('modul');
            const info  = MODULE_INFO[modul];

            setModule(guildId, modul, true);

            return interaction.reply({
                embeds: [createEmbed(
                    'success',
                    '✅ Modul aktiviert!',
                    `Das Modul **${info.name}** wurde aktiviert.\n> ${info.desc}`
                )],
                ephemeral: true,
            });
        }

        // ── Disable ──────────────────────────────────────────────
        if (sub === 'disable') {
            const modul = interaction.options.getString('modul');
            const info  = MODULE_INFO[modul];

            setModule(guildId, modul, false);

            return interaction.reply({
                embeds: [createEmbed(
                    'error',
                    '❌ Modul deaktiviert!',
                    `Das Modul **${info.name}** wurde deaktiviert.\n> ${info.desc}`
                )],
                ephemeral: true,
            });
        }

        // ── List ─────────────────────────────────────────────────
        if (sub === 'list') {
            const modules  = getModules(guildId);
            const settings = getGuildSettings(guildId);
            const lang     = settings.language ?? 'de';
            const langName = lang === 'de' ? '🇩🇪 Deutsch' : '🇬🇧 English';

            const moduleListe = Object.entries(MODULE_INFO)
                .map(([key, info]) => {
                    const aktiv = modules[key] ? '🟢' : '🔴';
                    return `${aktiv} **${info.name}** — ${info.desc}`;
                })
                .join('\n');

            return interaction.reply({
                embeds: [createEmbed(
                    'info',
                    '⚙️ Module Übersicht',
                    `**🌐 Sprache:** ${langName}\n\n${moduleListe}`
                )],
                ephemeral: true,
            });
        }

        // ── Sprache ──────────────────────────────────────────────
        if (sub === 'sprache') {
            const sprache  = interaction.options.getString('sprache');
            const langName = sprache === 'de' ? '🇩🇪 Deutsch' : '🇬🇧 English';

            setGuildSettings(guildId, { language: sprache });

            return interaction.reply({
                embeds: [createSuccessEmbed(
                    t(guildId, 'config.lang_set', { lang: langName })
                )],
                ephemeral: true,
            });
        }
    }
};
