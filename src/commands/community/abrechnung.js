'use strict';

const { SlashCommandBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { createAbrechnungHandlers } = require('../../billing/commands');
const { getBillingContext } = require('../../billing/context');
const { sendInvoice } = require('../../billing/sender');
const { STAFF_KEYS, EXCEPTION_KEYS, roleIds } = require('../../billing/permissions');

const handlers = createAbrechnungHandlers({
    getContext: getBillingContext,

    isModuleEnabled: guildId =>
        require('../../utils/moduleManager').isModuleEnabled(guildId, 'ets'),

    canAct: (interaction, kind) => {
        const ids = roleIds(interaction.guild.id, kind === 'exception' ? EXCEPTION_KEYS : STAFF_KEYS);
        return ids.some(id => interaction.member?.roles?.cache?.has(id));
    },

    findLink: spedvUserId =>
        require('../../utils/spedvApi').getLinkRecordBySpedvUserId(spedvUserId),

    linksOf: discordId =>
        require('../../utils/spedvApi').getVerifiedSpedvLinksByDiscordId(discordId),

    sendInvoice,

    announce: async (guild, text) => {
        const { config } = getBillingContext();
        const channel = config?.reportChannelId
            ? await guild.channels.fetch(config.reportChannelId).catch(() => null)
            : null;

        if (!channel?.isTextBased?.()) {
            logger.warn('Abrechnung: Buchhaltungs-Channel für Hinweis nicht erreichbar');
            return;
        }
        await channel.send({ content: text, allowedMentions: { parse: [] } });
    },
});

module.exports = {
    data: new SlashCommandBuilder()
        .setName('abrechnung')
        .setDescription('Abrechnung der Geschwindigkeits-Strafzahlungen')
        .addSubcommand(sub =>
            sub.setName('meine').setDescription('Zeigt deine eigenen Strafen und Rechnungen')
        )
        .addSubcommand(sub =>
            sub
                .setName('status')
                .setDescription('Laufende Abrechnung eines Monats (Buchhaltung)')
                .addStringOption(option =>
                    option.setName('monat').setDescription('Monat im Format JJJJ-MM, Standard: aktueller Monat')
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('pruefung')
                .setDescription('Generalprüfung eines Monats (Buchhaltung)')
                .addStringOption(option =>
                    option.setName('monat').setDescription('Monat im Format JJJJ-MM, Standard: letzter abgeschlossener Monat')
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('pruefaelle')
                .setDescription('Offene Prüffälle anzeigen (Buchhaltung)')
                .addStringOption(option =>
                    option.setName('monat').setDescription('Nur ein Monat, Format JJJJ-MM (Standard: alle)')
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('klaeren')
                .setDescription('Prüffall klären, Strafe festsetzen oder Ausnahme genehmigen')
                .addStringOption(option =>
                    option.setName('auftrag').setDescription('Auftragsnummer, zum Beispiel #12\'657\'450').setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('art')
                        .setDescription('Was soll passieren?')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Kein Verstoß (Prüffall geklärt)', value: 'kein-verstoss' },
                            { name: 'Strafe festsetzen', value: 'festsetzen' },
                            { name: 'Ausnahme genehmigen (§ 5.3, nur Leitung)', value: 'ausnahme' },
                            { name: 'Entscheidung widerrufen', value: 'widerrufen' }
                        )
                )
                .addStringOption(option =>
                    option.setName('begruendung').setDescription('Begründung (wird protokolliert)').setRequired(true)
                )
                .addNumberOption(option =>
                    option
                        .setName('geschwindigkeit')
                        .setDescription('Nur beim Festsetzen: km/h bei ETS2, mph bei ATS')
                        .setMinValue(0)
                        .setMaxValue(400)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('senden')
                .setDescription('Rechnung(en) per Direktnachricht versenden (Buchhaltung)')
                .addStringOption(option =>
                    option.setName('rechnung').setDescription('Eine einzelne Rechnung, zum Beispiel HKC-2026-11-169742')
                )
                .addStringOption(option =>
                    option.setName('monat').setDescription('Alle versandbereiten Entwürfe eines Monats, Format JJJJ-MM')
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('bezahlt')
                .setDescription('Zahlungseingang einer Rechnung bestätigen (Buchhaltung)')
                .addStringOption(option =>
                    option.setName('rechnung').setDescription('Rechnungsnummer').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('storno')
                .setDescription('Rechnung stornieren (Buchhaltung)')
                .addStringOption(option =>
                    option.setName('rechnung').setDescription('Rechnungsnummer').setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('grund').setDescription('Begründung (wird protokolliert)').setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('lauf').setDescription('Abrechnungslauf sofort ausführen (Buchhaltung)')
        ),

    async execute(interaction) {
        return handlers.execute(interaction);
    },
};
