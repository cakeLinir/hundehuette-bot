const { createEmbed, createErrorEmbed, createSuccessEmbed } = require('../utils/embedBuilder');
const { getGuildSettings, setGuildSettings } = require('../utils/settingsManager');
const { t } = require('../utils/i18n');
const logger = require('../utils/logger');
const { setSession, getSession, deleteSession } = require('../utils/sessions');

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
} = require('discord.js');

// ── Ankündigungs-Templates ──────────────────────────────────
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
    name: 'interactionCreate',
    once: false,

    async execute(interaction, client) {

        const guildId = interaction.guild?.id;

        // ── Autocomplete ────────────────────────────────────────
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (!command?.autocomplete) return;

            try {
                await command.autocomplete(interaction);
            } catch (error) {
                logger.error(`Autocomplete Fehler bei "${interaction.commandName}"`, error);
            }
            return;
        }

        // ── Slash Commands ──────────────────────────────────────
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);

            if (!command) {
                return interaction.reply({
                    embeds: [createErrorEmbed('Diesen Befehl kenne ich nicht!')],
                    ephemeral: true,
                }).catch(() => { });
            }

            try {
                await command.execute(interaction, client);
            } catch (error) {
                logger.error(`Fehler bei "${interaction.commandName}" (Sub: ${interaction.options?.getSubcommand(false) ?? 'keiner'
                    })`, error);

                try {
                    const errorMsg = {
                        embeds: [createErrorEmbed('Bei diesem Befehl ist etwas schiefgelaufen.')],
                        ephemeral: true,
                    };
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp(errorMsg);
                    } else {
                        await interaction.reply(errorMsg);
                    }
                } catch (_) { }
            }
            return;
        }

        // ── String Select Menus ─────────────────────────────────
        if (interaction.isStringSelectMenu()) {

            // Feedback — Identität
            if (interaction.customId === 'feedback_identitaet') {
                setSession(interaction.user.id, 'feedback', { identitaet: interaction.values[0] });
                return interaction.deferUpdate();
            }

            // Feedback — Kategorie
            if (interaction.customId === 'feedback_kategorie') {
                setSession(interaction.user.id, 'feedback', { kategorie: interaction.values[0] });
                return interaction.deferUpdate();
            }

            // Ankündigung — Kategorie
            if (interaction.customId === 'ankuendigung_kategorie') {
                setSession(interaction.user.id, 'ankuendigung', { kategorie: interaction.values[0] });
                return interaction.deferUpdate();
            }
        }

        // ── Channel Select Menus ────────────────────────────────
        if (interaction.isChannelSelectMenu()) {

            // Ankündigung — Zielkanal
            if (interaction.customId === 'ankuendigung_kanal') {
                setSession(interaction.user.id, 'ankuendigung', { kanalId: interaction.values[0] });
                return interaction.deferUpdate();
            }
        }

        // ── Role Select Menus ───────────────────────────────────
        if (interaction.isRoleSelectMenu()) {

            // Ankündigung — Rollen (optional, kann leer sein)
            if (interaction.customId === 'ankuendigung_rollen') {
                setSession(interaction.user.id, 'ankuendigung', { rollenIds: interaction.values });
                return interaction.deferUpdate();
            }
        }

        // ── Button Klicks ───────────────────────────────────────
        if (interaction.isButton()) {

            // ── Rollen Buttons ──────────────────────────────────
            if (interaction.customId?.startsWith('rolle_')) {
                try {
                    await interaction.deferReply({ ephemeral: true });

                    const roleId = interaction.customId.replace('rolle_', '');
                    const rolle = interaction.guild.roles.cache.get(roleId);

                    if (!rolle) {
                        return interaction.editReply({
                            embeds: [createErrorEmbed(t(guildId, 'roles.not_found'))],
                        });
                    }

                    const hatRolle = interaction.member.roles.cache.has(rolle.id);

                    if (hatRolle) {
                        await interaction.member.roles.remove(rolle);
                        await interaction.editReply({
                            embeds: [createEmbed(
                                'warning',
                                t(guildId, 'roles.removed_title'),
                                t(guildId, 'roles.removed', { rolle: rolle.name })
                            )],
                        });
                    } else {
                        await interaction.member.roles.add(rolle);
                        await interaction.editReply({
                            embeds: [createEmbed(
                                'success',
                                t(guildId, 'roles.added_title'),
                                t(guildId, 'roles.added', { rolle: rolle.name })
                            )],
                        });
                    }
                } catch (error) {
                    logger.error('Fehler bei Rollen-Button', error);
                }
                return;
            }

            // ── Ticket erstellen ────────────────────────────────
            else if (interaction.customId === 'ticket_erstellen') {
                try {
                    await interaction.deferReply({ ephemeral: true });

                    const settings = getGuildSettings(guildId);
                    const tickets = settings.tickets ?? {};
                    const kategorieId = settings.ticketCategoryId ?? null;

                    const vorhandenes = Object.values(tickets).find(
                        ticket => ticket.userId === interaction.user.id
                    );

                    if (vorhandenes) {
                        return interaction.editReply({
                            embeds: [createErrorEmbed(
                                t(guildId, 'ticket.already_open', { channel: `<#${vorhandenes.channelId}>` })
                            )],
                        });
                    }

                    const ticketKanal = await interaction.guild.channels.create({
                        name: `ticket-${interaction.user.username}`,
                        type: 0,
                        parent: kategorieId,
                        permissionOverwrites: [
                            {
                                id: interaction.guild.id,
                                deny: ['ViewChannel'],
                            },
                            {
                                id: interaction.user.id,
                                allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
                            },
                            {
                                id: client.user.id,
                                allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels'],
                            },
                        ],
                    });

                    const modRolle = interaction.guild.roles.cache.find(
                        r => r.permissions.has(PermissionFlagsBits.ManageMessages)
                    );

                    if (modRolle) {
                        await ticketKanal.permissionOverwrites.create(modRolle, {
                            ViewChannel: true,
                            SendMessages: true,
                            ReadMessageHistory: true,
                        });
                    }

                    tickets[ticketKanal.id] = {
                        channelId: ticketKanal.id,
                        userId: interaction.user.id,
                        createdAt: Date.now(),
                    };
                    setGuildSettings(guildId, { tickets });

                    const closeRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('ticket_close_btn')
                            .setLabel(t(guildId, 'ticket.btn_close'))
                            .setEmoji('🔒')
                            .setStyle(ButtonStyle.Danger)
                    );

                    await ticketKanal.send({
                        content: `${interaction.user}`,
                        embeds: [createEmbed(
                            'info',
                            t(guildId, 'ticket.created_title'),
                            t(guildId, 'ticket.created_desc', {
                                user: interaction.user,
                                time: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                            })
                        )],
                        components: [closeRow],
                    });

                    logger.ticket('Erstellt', interaction.user.tag);

                    await interaction.editReply({
                        embeds: [createSuccessEmbed(
                            t(guildId, 'ticket.success_created', { channel: `<#${ticketKanal.id}>` })
                        )],
                    });

                } catch (error) {
                    logger.error('Fehler beim Ticket erstellen', error);
                    await interaction.editReply({
                        embeds: [createErrorEmbed(t(guildId, 'ticket.error_create'))],
                    }).catch(() => { });
                }
                return;
            }

            // ── Ticket schließen ────────────────────────────────
            else if (interaction.customId === 'ticket_close_btn') {
                const settings = getGuildSettings(guildId);
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

                logger.ticket('Geschlossen', interaction.user.tag);

                setTimeout(async () => {
                    await interaction.channel.delete().catch(() => { });
                }, 5000);
                return;
            }

            // ── Ankündigung — Weiter Button ─────────────────────
            else if (interaction.customId === 'ankuendigung_weiter') {
                const session = getSession(interaction.user.id, 'ankuendigung');
                const { kanalId, kategorie, rollenIds } = session;

                // Validierung — Kanal und Kategorie sind Pflicht
                if (!kanalId && !kategorie) {
                    return interaction.reply({
                        embeds: [createErrorEmbed(
                            'Bitte wähle zuerst einen **Kanal** und eine **Kategorie** aus!'
                        )],
                        ephemeral: true,
                    });
                }
                if (!kanalId) {
                    return interaction.reply({
                        embeds: [createErrorEmbed('Bitte wähle zuerst einen **Kanal** aus!')],
                        ephemeral: true,
                    });
                }
                if (!kategorie) {
                    return interaction.reply({
                        embeds: [createErrorEmbed('Bitte wähle zuerst eine **Kategorie** aus!')],
                        ephemeral: true,
                    });
                }

                // Template für die gewählte Kategorie laden
                const template = TEMPLATES[kategorie] ?? '';

                const modal = new ModalBuilder()
                    .setCustomId('ankuendigung_modal')
                    .setTitle(`📢 Ankündigung — ${kategorie}`);

                const titelInput = new TextInputBuilder()
                    .setCustomId('titel')
                    .setLabel('Titel der Ankündigung')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('z. B. Wichtige Neuigkeit!')
                    .setMaxLength(100)
                    .setRequired(true);

                const inhaltInput = new TextInputBuilder()
                    .setCustomId('inhalt')
                    .setLabel('Inhalt')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Schreibe hier den Inhalt der Ankündigung...')
                    .setValue(template)
                    .setMaxLength(2000)
                    .setRequired(true);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(titelInput),
                    new ActionRowBuilder().addComponents(inhaltInput),
                );

                await interaction.showModal(modal);
                return;
            }

            // ── Feedback — Weiter Button ────────────────────────
            else if (interaction.customId === 'feedback_weiter') {
                const session = getSession(interaction.user.id, 'feedback');
                const { identitaet, kategorie } = session;

                if (!identitaet || !kategorie) {
                    return interaction.reply({
                        embeds: [createErrorEmbed(
                            'Bitte wähle zuerst **Identität** und **Kategorie** aus!'
                        )],
                        ephemeral: true,
                    });
                }

                const modal = new ModalBuilder()
                    .setCustomId(`feedback_modal_${identitaet}_${kategorie}`)
                    .setTitle(`📬 Feedback — ${kategorie}`);

                const nachrichtInput = new TextInputBuilder()
                    .setCustomId('nachricht')
                    .setLabel('Dein Feedback')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Schreibe hier dein Feedback...')
                    .setMaxLength(1000)
                    .setRequired(true);

                const verbesserungInput = new TextInputBuilder()
                    .setCustomId('verbesserung')
                    .setLabel('Verbesserungsvorschlag (optional)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Hast du einen Vorschlag zur Verbesserung?')
                    .setRequired(false);

                const rows = [
                    new ActionRowBuilder().addComponents(nachrichtInput),
                    new ActionRowBuilder().addComponents(verbesserungInput),
                ];

                if (kategorie === 'Sonstiges') {
                    const sonstigesInput = new TextInputBuilder()
                        .setCustomId('sonstiges_thema')
                        .setLabel('Um welches Thema geht es?')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Beschreibe kurz das Thema...')
                        .setMaxLength(100)
                        .setRequired(true);

                    rows.unshift(new ActionRowBuilder().addComponents(sonstigesInput));
                }

                modal.addComponents(...rows);
                await interaction.showModal(modal);
                return;
            }
        }

        // ── Modal Submit ────────────────────────────────────────
        if (interaction.isModalSubmit()) {

            // ── Ankündigung ─────────────────────────────────────
            if (interaction.customId === 'ankuendigung_modal') {
                await interaction.deferReply({ ephemeral: true });

                const session = getSession(interaction.user.id, 'ankuendigung');
                const { kanalId, kategorie, rollenIds } = session;

                const kanal = kanalId
                    ? interaction.guild.channels.cache.get(kanalId)
                    : null;

                if (!kanal) {
                    return interaction.editReply({
                        embeds: [createErrorEmbed(
                            'Der Zielkanal wurde nicht gefunden. Bitte starte den Vorgang erneut.'
                        )],
                    });
                }

                const titel = interaction.fields.getTextInputValue('titel');
                const inhalt = interaction.fields.getTextInputValue('inhalt');

                // Rollen-Pings zusammenbauen (leer = kein Ping)
                const pingContent = (rollenIds?.length)
                    ? rollenIds.map(id => `<@&${id}>`).join(' ')
                    : undefined;

                const embed = createEmbed('info', `📢 ${titel}`, inhalt)
                    .setAuthor({
                        name: interaction.user.username,
                        iconURL: interaction.user.displayAvatarURL({ dynamic: true }),
                    })
                    .setFooter({ text: `Kategorie: ${kategorie ?? 'Keine'}` })
                    .setTimestamp();

                await kanal.send({
                    content: pingContent,
                    embeds: [embed],
                });

                // Session aufräumen
                deleteSession(interaction.user.id, 'ankuendigung');

                logger.info(
                    `Ankündigung [${kategorie}] von ${interaction.user.tag} in #${kanal.name} gepostet`
                );

                return interaction.editReply({
                    embeds: [createEmbed(
                        'success',
                        '✅ Ankündigung gepostet!',
                        `Deine **${kategorie}**-Ankündigung wurde erfolgreich in <#${kanalId}> veröffentlicht.` +
                        (rollenIds?.length
                            ? `\n\n🔔 Gepingt: ${rollenIds.map(id => `<@&${id}>`).join(', ')}`
                            : '')
                    )],
                });
            }

            // ── Feedback Modal ──────────────────────────────────
            if (interaction.customId?.startsWith('feedback_modal_')) {
                await interaction.deferReply({ ephemeral: true });

                // Format: feedback_modal_<identitaet>_<kategorie>
                const ohnePrefix = interaction.customId.replace('feedback_modal_', '');
                const trennIndex = ohnePrefix.indexOf('_');
                const identitaet = ohnePrefix.substring(0, trennIndex);
                const kategorie = ohnePrefix.substring(trennIndex + 1);

                const isAnonym = identitaet === 'anonym';
                const settings = getGuildSettings(guildId);
                const nachricht = interaction.fields.getTextInputValue('nachricht');
                const verbesserung = interaction.fields.getTextInputValue('verbesserung') || null;
                const sonstigesThema = kategorie === 'Sonstiges'
                    ? interaction.fields.getTextInputValue('sonstiges_thema')
                    : null;

                const feedbackKanal = interaction.guild.channels.cache.get(settings.feedbackChannelId);

                if (!feedbackKanal) {
                    return interaction.editReply({
                        embeds: [createErrorEmbed(t(guildId, 'feedback.no_channel'))],
                    });
                }

                const anzeigeKategorie = sonstigesThema
                    ? `Sonstiges — ${sonstigesThema}`
                    : kategorie;

                const embed = createEmbed(
                    'info',
                    `📬 Neues Feedback — ${anzeigeKategorie}`,
                    nachricht
                ).setAuthor({
                    name: isAnonym ? t(guildId, 'feedback.anonym_user') : interaction.user.username,
                    iconURL: isAnonym ? null : interaction.user.displayAvatarURL({ dynamic: true }),
                });

                if (verbesserung) {
                    embed.addFields({
                        name: t(guildId, 'feedback.improvement'),
                        value: verbesserung,
                    });
                }

                await feedbackKanal.send({ embeds: [embed] });

                // Session aufräumen
                deleteSession(interaction.user.id, 'feedback');

                return interaction.editReply({
                    embeds: [createEmbed(
                        'success',
                        t(guildId, 'feedback.sent_title'),
                        t(guildId, 'feedback.sent_desc', {
                            anonym: isAnonym ? t(guildId, 'feedback.anonym_prefix') : '',
                        })
                    )],
                });
            }
        }
    }
};
