
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
    SlashCommandBuilder,
    MessageFlags,
    AttachmentBuilder,
    EmbedBuilder,
} = require('discord.js');

const {
    createEmbed,
    createErrorEmbed,
} = require('../../utils/embedBuilder');

const { isModuleEnabled } = require('../../utils/moduleManager');
const logger = require('../../utils/logger');

const {
    fetchUsers,
    findDriver,
    isRankAllowed,
    fetchAboutMe,
    getLinkOwner,
    getSpedvNamesByDiscordId,
    setLink,
} = require('../../utils/spedvApi');

const {
    getPending,
    createPending,
    clearPending,
    codeInText,
    TTL_MS,
} = require('../../utils/etsVerification');

const { applyRoles } = require('../../utils/spedvRoleSync');

const POSITIONS = require('../../config/positions');
const { getPositionRoleId } = require('../../utils/rankRoles');

const billingConfig = require('../../config/billing');

const {
    listInvoices,
    markInvoicePaid,
    recordInvoiceSendAttempt,
    recordInvoiceDeliveryResult,
    recordFallbackNotificationAttempt,
    recordFallbackNotificationResult,
} = require('../../utils/speedBillingStore');

const COOLDOWN_MS = 15_000;
const lastUse = new Map();

const norm = value =>
    String(value ?? '').trim().toLowerCase();

const fail = (interaction, text) =>
    interaction.editReply({
        embeds: [createErrorEmbed(text)],
    });

const LOGO_PATH = path.resolve(
    __dirname,
    '../../assets/HKC_logo.png'
);

const LOGO_FILENAME = 'HKC_logo.png';

const BILLING_POSITION_KEYS = [
    'geschaeftsfuehrer',
    'stellv_geschaeftsfuehrer',
    'buchhaltungsleiter',
    'buchhaltung',
];

const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_TABLE_DESCRIPTION_LENGTH = 3500;
const BILLING_FALLBACK_CHANNEL_ID = '1560300974185123840';

/**
 * Prüft, ob ein Mitglied eine der vier abrechnungsberechtigten
 * Funktionsstellen besitzt.
 *
 * Fehlende Rollen-IDs oder nicht auflösbare Rollen führen
 * grundsätzlich zur Verweigerung.
 */
function hasBillingPermission(member, guildId) {
    if (!member || !guildId || !member.roles?.cache) {
        return false;
    }

    for (const key of BILLING_POSITION_KEYS) {
        const position = POSITIONS.find(
            item => item.key === key
        );

        if (!position) {
            continue;
        }

        const roleId = getPositionRoleId(
            guildId,
            position
        );

        if (
            !roleId ||
            typeof roleId !== 'string'
        ) {
            continue;
        }

        if (member.roles.cache.has(roleId)) {
            return true;
        }
    }

    return false;
}

/**
 * Ermittelt die Abrechnungsberechtigung anhand der
 * tatsächlichen Discord-Rollen des aufrufenden Mitglieds.
 *
 * Fehlende oder nicht auflösbare Rollen werden nicht akzeptiert.
 */
async function getBillingPermissions(interaction) {
    const member = await interaction.guild.members.fetch(
        interaction.user.id
    );

    const allowedRoleIds = BILLING_POSITION_KEYS
        .map(key =>
            POSITIONS.find(position => position.key === key)
        )
        .filter(Boolean)
        .map(position =>
            getPositionRoleId(
                interaction.guild.id,
                position
            )
        )
        .filter(roleId =>
            typeof roleId === 'string' &&
            /^\d{17,20}$/.test(roleId) &&
            interaction.guild.roles.cache.has(roleId)
        );

    const isBillingStaff = allowedRoleIds.some(roleId =>
        member.roles.cache.has(roleId)
    );

    return {
        member,
        isBillingStaff,
        allowedRoleIds,
    };
}

async function grantRoles(interaction, driver) {
    try {
        const { added, removed } = await applyRoles(
            interaction.member,
            driver,
            'ETS2/ATS: SpedV-Rang geprüft'
        );

        const text = added + removed === 0
            ? `Alles aktuell, **${driver.userName}** (${driver.rank?.name}).`
            : `Deine Rollen sind aktualisiert, **${driver.userName}** (${driver.rank?.name}).`;

        return interaction.editReply({
            embeds: [
                createEmbed(
                    'success',
                    '🚚 Willkommen im Fuhrpark!',
                    text
                ),
            ],
        });
    } catch (err) {
        logger.error(
            'ETS: Rollen konnten nicht vergeben werden',
            err
        );

        return fail(
            interaction,
            'Ich darf die Rollen nicht vergeben. Das Team muss meine Bot-Rolle über die ETS2/ATS- und Rang-Rollen schieben.'
        );
    }
}

async function verifySpedvName(interaction) {
    const guildId = interaction.guild.id;

    if (!isModuleEnabled(guildId, 'ets')) {
        return interaction.reply({
            embeds: [
                createErrorEmbed(
                    'Das ETS2/ATS-Modul ist auf diesem Server deaktiviert!'
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
    });

    const {
        SPEDV_API_KEY,
        ETS_ROLE_ID,
        ETS_ALLOWED_RANKS,
    } = process.env;

    if (
        !SPEDV_API_KEY ||
        !ETS_ROLE_ID ||
        !ETS_ALLOWED_RANKS
    ) {
        logger.warn(
            'ETS: SPEDV_API_KEY, ETS_ROLE_ID oder ETS_ALLOWED_RANKS fehlt in der .env'
        );

        return fail(
            interaction,
            'Das Modul ist noch nicht fertig eingerichtet. Bitte melde dich beim Team.'
        );
    }

    const last = lastUse.get(interaction.user.id);

    if (
        last &&
        Date.now() - last < COOLDOWN_MS
    ) {
        return fail(
            interaction,
            'Bitte warte ein paar Sekunden, bevor du den Befehl erneut nutzt.'
        );
    }

    lastUse.set(
        interaction.user.id,
        Date.now()
    );

    const givenName = interaction.options
        .getString('spedv-name', true)
        .trim();

    if (!givenName) {
        return fail(
            interaction,
            'Bitte gib deinen SpedV-Namen an.'
        );
    }

    let driver;

    try {
        driver = findDriver(
            await fetchUsers(),
            [givenName]
        );
    } catch (err) {
        logger.error(
            'ETS: SpedV-Abfrage fehlgeschlagen',
            err
        );

        return fail(
            interaction,
            'SpedV ist gerade nicht erreichbar. Versuch es später nochmal.'
        );
    }

    if (!driver) {
        return fail(
            interaction,
            'Ich finde diesen Namen nicht in unserer Spedition. Prüfe die Schreibweise deines SpedV-Namens und versuche es erneut.'
        );
    }

    if (!isRankAllowed(driver)) {
        return fail(
            interaction,
            'Dein Rang reicht noch nicht aus. Du brauchst mindestens **Fahrer auf Probe**.'
        );
    }

    const owner = getLinkOwner(driver.userName);

    if (
        owner &&
        owner !== interaction.user.id
    ) {
        return fail(
            interaction,
            'Dieser SpedV-Account ist bereits mit einem anderen Discord-Account verknüpft.'
        );
    }

    if (owner === interaction.user.id) {
        return grantRoles(interaction, driver);
    }

    const pending = getPending(interaction.user.id);

    if (
        !pending ||
        norm(pending.spedvName) !== norm(driver.userName)
    ) {
        const created = createPending(
            interaction.user.id,
            driver.userName
        );

        return interaction.editReply({
            embeds: [
                createEmbed(
                    'info',
                    '🔐 Kurze Bestätigung nötig',
                    `Damit niemand deinen Namen missbraucht, bestätige bitte dein SpedV-Profil:\n\n` +
                    `1. Trage diesen Code in SpedV im Profil unter **Über mich** ein:\n` +
                    `**\`${created.code}\`**\n` +
                    `2. Speichere das Profil.\n` +
                    `3. Führe danach erneut **/ets link** aus und gib denselben SpedV-Namen an.\n\n` +
                    `Der Code ist ${TTL_MS / 60_000} Minuten gültig. Nach der Bestätigung kannst du ihn wieder löschen.`
                ),
            ],
        });
    }

    let aboutMe;

    try {
        aboutMe = await fetchAboutMe(driver.id);
    } catch (err) {
        logger.error(
            'ETS: Profil konnte nicht gelesen werden',
            err
        );

        return fail(
            interaction,
            'SpedV ist gerade nicht erreichbar. Versuch es später nochmal.'
        );
    }

    if (!codeInText(aboutMe, pending.code)) {
        return fail(
            interaction,
            `Ich finde den Code noch nicht in deinem Profil.\n` +
            `Trage **\`${pending.code}\`** unter **Über mich** ein, speichere und führe **/ets link** mit deinem SpedV-Namen erneut aus.`
        );
    }

    clearPending(interaction.user.id);

    setLink(
        driver.userName,
        interaction.user.id
    );

    return grantRoles(interaction, driver);
}

function validateRequestedMonth(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new Error(
            'Bitte verwende das Monatsformat YYYY-MM.'
        );
    }

    if (month < '2026-11') {
        throw new Error(
            'Abrechnungen sind erst ab November 2026 freigegeben.'
        );
    }
}

function formatInvoiceStatus(invoice) {
    const statusLabels = {
        draft: 'Entwurf',
        sent: 'Versendet',
        paid: 'Bezahlt',
    };

    const deliveryLabels = {
        delivered: 'DM zugestellt',
        failed: 'DM fehlgeschlagen',
        pending: 'Versand läuft / Ergebnis offen',
        unknown: 'Zustellung unbekannt',
    };

    return [
        `Rechnung: \`${invoice.id}\``,
        `Monat: **${invoice.month}**`,
        `Betrag: **${invoice.totalEur.toFixed(2)} €**`,
        `Status: **${statusLabels[invoice.status] ?? invoice.status}**`,
        invoice.delivery
            ? `Zustellung: **${deliveryLabels[invoice.delivery] ?? invoice.delivery}**`
            : null,
        invoice.dueAt
            ? `Fällig am: <t:${Math.floor(new Date(invoice.dueAt).getTime() / 1000)}:d>`
            : null,
        invoice.fallbackNotification
            ? `Öffentliche Benachrichtigung: **${
            {
                pending: 'Ergebnis offen – keine Wiederholung erlaubt',
                sent: 'Veröffentlicht',
                unknown: 'Ergebnis unklar – manuelle Prüfung erforderlich',
            }[invoice.fallbackNotification.status] ??
            invoice.fallbackNotification.status
            }**`
            : null,
    ]
        .filter(Boolean)
        .join('\n');
}

/**
 * Formatiert einen Wert für die Rechnungstabelle.
 *
 * Es werden keine Geschwindigkeiten oder Strafbeträge berechnet.
 * Die Funktion stellt ausschließlich gespeicherte Werte dar.
 */
function formatTableValue(value, fieldName) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        throw new Error(
            `Der gespeicherte Rechnungswert "${fieldName}" fehlt. Die Rechnung kann nicht versendet werden.`
        );
    }

    const text = String(value);

    if (/[\r\n]/.test(text)) {
        throw new Error(
            `Der gespeicherte Rechnungswert "${fieldName}" enthält ungültige Zeilenumbrüche.`
        );
    }

    return text;
}

/**
 * Erstellt die Tabellenzeilen ausschließlich aus den gespeicherten
 * Rechnungspositionen.
 *
 * Erwartete Felder:
 * - taskId
 * - maxVelocityKmh
 * - excessKmh
 * - amountEur
 */
function prepareInvoiceTable(invoice) {
    if (
        !Array.isArray(invoice.lineItems) ||
        invoice.lineItems.length === 0
    ) {
        throw new Error(
            'Die Rechnung enthält keine gespeicherten Fahrtpositionen.'
        );
    }

    const rows = invoice.lineItems.map(item => {
        const taskId = formatTableValue(
            item.taskId,
            'taskId'
        );

        const maxVelocityKmh = Number(
            item.maxVelocityKmh
        );

        const excessKmh = Number(
            item.excessKmh
        );

        const amountEur = Number(
            item.amountEur
        );

        if (
            !Number.isFinite(maxVelocityKmh) ||
            !Number.isFinite(excessKmh) ||
            !Number.isFinite(amountEur)
        ) {
            throw new Error(
                `Die gespeicherten Mess- oder Rechnungswerte für Fahrt ${taskId} sind ungültig. Die Rechnung wurde nicht versendet.`
            );
        }

        return {
            taskId,
            maxVelocityKmh: formatTableValue(
                item.maxVelocityKmh,
                'maxVelocityKmh'
            ),
            excessKmh: formatTableValue(
                item.excessKmh,
                'excessKmh'
            ),
            amountEur: new Intl.NumberFormat(
                'de-DE',
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                }
            ).format(amountEur) + ' €',
        };
    });

    const widths = {
        taskId: Math.max(
            'Fahrt ID'.length,
            ...rows.map(row => row.taskId.length)
        ),
        maxVelocityKmh: Math.max(
            'Gefahren'.length,
            ...rows.map(row => row.maxVelocityKmh.length)
        ),
        excessKmh: Math.max(
            'Über Limit'.length,
            ...rows.map(row => row.excessKmh.length)
        ),
        amountEur: Math.max(
            'Strafzahlung'.length,
            ...rows.map(row => row.amountEur.length)
        ),
    };

    const header = [
        'Fahrt ID'.padEnd(widths.taskId),
        'Gefahren'.padStart(widths.maxVelocityKmh),
        'Über Limit'.padStart(widths.excessKmh),
        'Strafzahlung'.padStart(widths.amountEur),
    ].join(' | ');

    const separator = [
        '-'.repeat(widths.taskId),
        '-'.repeat(widths.maxVelocityKmh),
        '-'.repeat(widths.excessKmh),
        '-'.repeat(widths.amountEur),
    ].join('-|-');

    const formattedRows = rows.map(row => [
        row.taskId.padEnd(widths.taskId),
        row.maxVelocityKmh.padStart(widths.maxVelocityKmh),
        row.excessKmh.padStart(widths.excessKmh),
        row.amountEur.padStart(widths.amountEur),
    ].join(' | '));

    return {
        header,
        separator,
        rows: formattedRows,
    };
}

/**
 * Teilt die Tabelle in mehrere Embed-Beschreibungen auf,
 * damit Discords Zeichenbegrenzungen nicht überschritten werden.
 */
function splitInvoiceTable(table) {
    const tableHeader = [
        table.header,
        table.separator,
    ].join('\n');

    const chunks = [];
    let currentRows = [];

    for (const row of table.rows) {
        const candidateRows = [
            ...currentRows,
            row,
        ];

        const candidateDescription = [
            '```text',
            tableHeader,
            ...candidateRows,
            '```',
        ].join('\n');

        if (
            candidateDescription.length >
                MAX_TABLE_DESCRIPTION_LENGTH &&
            currentRows.length > 0
        ) {
            chunks.push(currentRows);

            currentRows = [row];
        } else {
            currentRows = candidateRows;
        }
    }

    if (currentRows.length > 0) {
        chunks.push(currentRows);
    }

    if (chunks.length > MAX_EMBEDS_PER_MESSAGE) {
        throw new Error(
            `Die Rechnung enthält zu viele Tabellenzeilen für eine einzelne Discord-Nachricht (${table.rows.length} Fahrtpositionen). Bitte teile die Rechnung vor dem Versand manuell auf.`
        );
    }

    return chunks.map(rows => [
        '```text',
        tableHeader,
        ...rows,
        '```',
    ].join('\n'));
}

/**
 * Erstellt die formatierten Rechnungs-Embeds.
 *
 * Das Logo wird als Attachment eingebunden.
 * Es wird kein externes Bild und keine Browser-URL benötigt.
 */
function createInvoiceEmbeds(invoice, driverName) {
    if (!fs.existsSync(LOGO_PATH)) {
        throw new Error(
            `Das HKC-Logo wurde nicht gefunden: ${LOGO_PATH}`
        );
    }

    const dueAt = new Date(invoice.dueAt);

    if (Number.isNaN(dueAt.getTime())) {
        throw new Error(
            'Die gespeicherte Zahlungsfrist ist ungültig. Der Versand wurde nicht gestartet.'
        );
    }

    const table = prepareInvoiceTable(invoice);
    const tableDescriptions = splitInvoiceTable(table);

    const totalEur = Number(invoice.totalEur);

    if (!Number.isFinite(totalEur)) {
        throw new Error(
            'Der gespeicherte Rechnungsbetrag ist ungültig.'
        );
    }

    const formattedTotal = new Intl.NumberFormat(
        'de-DE',
        {
            style: 'currency',
            currency: billingConfig.currency,
        }
    ).format(totalEur);

    const dueDateText = dueAt.toLocaleDateString(
        'de-DE',
        {
            timeZone: 'Europe/Berlin',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        }
    );

    const paymentPurpose = [
        billingConfig.paymentPurposePrefix,
        driverName,
    ].join(' ');

    const embeds = tableDescriptions.map(
        (description, index) => {
            const embed = new EmbedBuilder()
                .setColor(0xC62828)
                .setDescription(description)
                .setFooter({
                    text: `HKC | Rechnung ${invoice.id}`,
                });

            if (index === 0) {
                embed
                    .setTitle(
                        `Monatsabrechnung ${invoice.month}`
                    )
                    .setThumbnail(
                        `attachment://${LOGO_FILENAME}`
                    )
                    .addFields(
                        {
                            name: 'Fahrer',
                            value: driverName,
                            inline: true,
                        },
                        {
                            name: 'Rechnungsnummer',
                            value: invoice.id,
                            inline: true,
                        },
                        {
                            name: 'Gesamtbetrag',
                            value: formattedTotal,
                            inline: true,
                        },
                        {
                            name: 'Zahlungsfrist',
                            value: dueDateText,
                            inline: true,
                        },
                        {
                            name: 'SpedV-Kontonummer',
                            value: String(
                                billingConfig.spedvIban
                            ),
                            inline: false,
                        },
                        {
                            name: 'Verwendungszweck',
                            value: paymentPurpose,
                            inline: false,
                        }
                    );
            } else {
                embed.setTitle(
                    `Monatsabrechnung ${invoice.month} – Fortsetzung`
                );
            }

            return embed;
        }
    );

    return {
        embeds,
        attachment: new AttachmentBuilder(
            LOGO_PATH,
            {
                name: LOGO_FILENAME,
            }
        ),
    };
}

async function handleBillingPreview(interaction) {
    await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
    });

    try {
        const month = interaction.options.getString(
            'monat',
            true
        );

        validateRequestedMonth(month);

        const { isBillingStaff } =
            await getBillingPermissions(interaction);

        const invoices = listInvoices({
            guildId: interaction.guild.id,
            month,
            ...(!isBillingStaff
                ? {
                    discordUserId: interaction.user.id,
                }
                : {}),
        });

        if (invoices.length === 0) {
            return interaction.editReply({
                content:
                    `Für ${month} wurden keine Rechnungen gefunden. ` +
                    'Die Vorschau hat keine Daten verändert.',
            });
        }

        const lines = invoices.map(
            formatInvoiceStatus
        );

        return interaction.editReply({
            content:
                `**Rechnungsvorschau ${month}**\n\n` +
                lines.join('\n\n'),
        });
    } catch (error) {
        logger.error(
            'ETS-Abrechnung: Vorschau fehlgeschlagen',
            error
        );

        return interaction.editReply({
            embeds: [
                createErrorEmbed(error.message),
            ],
        });
    }
}

async function handleBillingStatus(interaction) {
    await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
    });

    try {
        const { isBillingStaff } =
            await getBillingPermissions(interaction);

        const requestedDriver =
            interaction.options.getUser('fahrer');

        if (
            requestedDriver &&
            requestedDriver.id !== interaction.user.id &&
            !isBillingStaff
        ) {
            return interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        'Du darfst nur deine eigenen Rechnungen einsehen.'
                    ),
                ],
            });
        }

        const discordUserId =
            isBillingStaff && requestedDriver
                ? requestedDriver.id
                : interaction.user.id;

        const invoices = listInvoices({
            guildId: interaction.guild.id,
            discordUserId,
        });

        if (invoices.length === 0) {
            return interaction.editReply({
                content:
                    'Für diesen Fahrer wurden keine Rechnungen gefunden.',
            });
        }

        return interaction.editReply({
            content: invoices
                .map(formatInvoiceStatus)
                .join('\n\n'),
        });
    } catch (error) {
        logger.error(
            'ETS-Abrechnung: Statusabfrage fehlgeschlagen',
            error
        );

        return interaction.editReply({
            embeds: [
                createErrorEmbed(error.message),
            ],
        });
    }
}

async function handleBillingPaid(interaction) {
    await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
    });

    try {
        const {
            member,
            isBillingStaff,
            allowedRoleIds,
        } = await getBillingPermissions(interaction);

        if (!isBillingStaff) {
            return interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        'Du bist nicht berechtigt, Zahlungseingänge zu bestätigen.'
                    ),
                ],
            });
        }

        const invoiceId =
            interaction.options.getString('rechnung-id', true).trim();

        const invoices = listInvoices({
            guildId: interaction.guild.id,
        });

        const invoice = invoices.find(
            entry => entry.id === invoiceId
        );

        if (!invoice) {
            return interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        'Die angegebene Rechnung wurde nicht gefunden.'
                    ),
                ],
            });
        }

        const result = await markInvoicePaid(
            invoice.id,
            interaction.user.id,
            [...member.roles.cache.keys()],
            allowedRoleIds
        );

        if (result.duplicate) {
            return interaction.editReply({
                content:
                    `Die Rechnung **${invoice.id}** ist bereits als bezahlt markiert.`,
            });
        }

        return interaction.editReply({
            embeds: [
                createEmbed(
                    'success',
                    'Zahlung bestätigt',
                    `Die Rechnung **${result.invoice.id}** wurde erfolgreich als bezahlt markiert.`
                ),
            ],
        });
    } catch (error) {
        logger.error(
            'ETS-Abrechnung: Zahlungseingang konnte nicht bestätigt werden',
            error
        );

        return interaction.editReply({
            embeds: [
                createErrorEmbed(error.message),
            ],
        });
    }
}

async function sendPublicBillingFallback(
    interaction,
    invoice,
    actorDiscordId
) {
    /*
     * Die Discord-ID aus der Rechnung ist die maßgebliche Identität.
     * Der SpedV-Name darf diese Identität nicht ersetzen.
     */
    const linkedNames = getSpedvNamesByDiscordId(
        invoice.discordUserId
    );

    if (
        !Array.isArray(linkedNames) ||
        linkedNames.length !== 1
    ) {
        throw new Error(
            linkedNames?.length === 0
                ? 'Fallback gesperrt: Für die Discord-ID der Rechnung wurde keine SpedV-Verknüpfung gefunden.'
                : 'Fallback gesperrt: Für die Discord-ID der Rechnung existieren mehrere SpedV-Verknüpfungen.'
        );
    }

    const driverName = linkedNames[0];

    if (
        typeof driverName !== 'string' ||
        !driverName.trim()
    ) {
        throw new Error(
            'Fallback gesperrt: Der gespeicherte SpedV-Name ist ungültig.'
        );
    }

    const linkOwner = getLinkOwner(driverName);

    if (String(linkOwner ?? '') !== String(invoice.discordUserId)) {
        throw new Error(
            'Fallback gesperrt: Die SpedV-Verknüpfung zeigt nicht auf die Discord-ID der Rechnung.'
        );
    }

    const targetMember = await interaction.guild.members.fetch(
        invoice.discordUserId
    );

    if (
        !targetMember ||
        String(targetMember.id) !== String(invoice.discordUserId)
    ) {
        throw new Error(
            'Das aufgelöste Discord-Mitglied stimmt nicht mit der Rechnungs-ID überein.'
        );
    };

    const channel = await interaction.guild.channels.fetch(
        BILLING_FALLBACK_CHANNEL_ID
    );

    if (
        !channel ||
        !channel.isTextBased() ||
        typeof channel.send !== 'function'
    ) {
        throw new Error(
            'Fallback gesperrt: Der konfigurierte Fahrer-Chat ist nicht erreichbar oder kein beschreibbarer Textkanal.'
        );
    }

    /*
     * Erst nach erfolgreicher Identitäts- und Kanalprüfung
     * wird der einmalige Fallback-Versuch dauerhaft reserviert.
     */
    recordFallbackNotificationAttempt(
        invoice.id,
        channel.id,
        actorDiscordId
    );

    const message =
        `<@${invoice.discordUserId}> – deine HKC-Monatsabrechnung ` +
        `für **${invoice.month}** konnte dir nicht per Direktnachricht ` +
        `zugestellt werden. Bitte prüfe deinen Abrechnungsstatus privat ` +
        `mit **/ets abrechnung status** oder wende dich an die Buchhaltung.`;

    let sentMessage;

    try {
        sentMessage = await channel.send({
            content: message,
            allowedMentions: {
                users: [invoice.discordUserId],
            },
        });
    } catch (sendError) {
        /*
         * Ein fehlgeschlagener API-Aufruf beweist nicht sicher,
         * dass Discord keine Nachricht erstellt hat.
         * Deshalb unknown statt failed und keine Wiederholung.
         */
        try {
            recordFallbackNotificationResult(
                invoice.id,
                'unknown',
                {
                    error: String(
                        sendError.message || sendError
                    ).slice(0, 500),
                },
                actorDiscordId
            );
        } catch (storeError) {
            logger.error(
                `ETS-Abrechnung: Fallback-Ergebnis für ${invoice.id} konnte nicht gespeichert werden.`,
                storeError
            );
        }

        throw new Error(
            'Der öffentliche Benachrichtigungsversuch hat kein eindeutiges Ergebnis. Er wurde gegen Wiederholung gesperrt und muss manuell geprüft werden.'
        );
    }

    try {
        recordFallbackNotificationResult(
            invoice.id,
            'sent',
            {
                messageId: sentMessage.id,
            },
            actorDiscordId
        );
    } catch (storeError) {
        logger.error(
            `ETS-Abrechnung: Fallback für ${invoice.id} wurde veröffentlicht, aber das Ergebnis konnte nicht gespeichert werden.`,
            storeError
        );

        throw new Error(
            'Die öffentliche Benachrichtigung wurde veröffentlicht. Das Speichern des Ergebnisses ist fehlgeschlagen. Bitte keinen erneuten Versuch auslösen; die Nachricht muss manuell geprüft werden.'
        );
    }

    return sentMessage;
}

async function handleBillingSend(interaction) {
    await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
    });

    let invoice;

    try {
        const { isBillingStaff } =
            await getBillingPermissions(interaction);

        if (!isBillingStaff) {
            return interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        'Nur Buchhaltung, Buchhaltungsleitung, stellvertretende Geschäftsführung und Geschäftsführung dürfen Rechnungen versenden.'
                    ),
                ],
            });
        }

        const invoiceId = interaction.options.getString(
            'rechnung-id',
            true
        );

        invoice = listInvoices({
            guildId: interaction.guild.id,
        }).find(item =>
            item.id === invoiceId
        );

        if (!invoice) {
            throw new Error(
                'Rechnung wurde auf diesem Server nicht gefunden.'
            );
        }

        if (invoice.status === 'paid') {
            throw new Error(
                'Diese Rechnung ist bereits bezahlt.'
            );
        }
        if (invoice.fallbackNotification) {
            const fallbackStatus = invoice.fallbackNotification.status;

            const fallbackMessage = {
                pending:
                    'Ein öffentlicher Benachrichtigungsversuch läuft oder sein Ergebnis ist noch offen.',
                sent:
                    'Die öffentliche Benachrichtigung wurde bereits veröffentlicht.',
                unknown:
                    'Das Ergebnis der öffentlichen Benachrichtigung ist unklar.',
            };

            throw new Error(
                `${fallbackMessage[fallbackStatus] ??
                'Für diese Rechnung existiert bereits ein Fallback-Versuch.'} ` +
                'Ein erneuter Versand ist aus Sicherheitsgründen gesperrt. ' +
                'Bitte prüfe den Status manuell.'
            );
        }

        if (invoice.status === 'sent') {
            if (invoice.delivery !== 'failed') {
                throw new Error(
                    'Diese Rechnung wurde bereits versendet oder der Zustellstatus ist nicht eindeutig. Ein erneuter Versand ist derzeit gesperrt.'
                );
            }
        } else if (invoice.status !== 'draft') {
            throw new Error(
                `Der Rechnungsstatus "${invoice.status}" erlaubt keinen Versand.`
            );
        }

        const linkedNames = getSpedvNamesByDiscordId(
            invoice.discordUserId
        );

        if (linkedNames.length !== 1) {
            throw new Error(
                linkedNames.length === 0
                    ? 'Für diesen Fahrer wurde keine SpedV-Verknüpfung gefunden.'
                    : 'Für diesen Fahrer existieren mehrere SpedV-Verknüpfungen. Der Versand wurde aus Sicherheitsgründen gestoppt.'
            );
        }

        const driverName = linkedNames[0];

        /*
         * Alle lokalen Voraussetzungen vor dem Versandversuch prüfen.
         * So wird eine Rechnung nicht unnötig auf pending gesetzt,
         * wenn beispielsweise das Logo oder die Rechnungsdaten fehlen.
         */
        if (!fs.existsSync(LOGO_PATH)) {
            throw new Error(
                `Das HKC-Logo wurde nicht gefunden: ${LOGO_PATH}`
            );
        }

        prepareInvoiceTable(invoice);

        const targetMember = await interaction.guild.members.fetch(
            invoice.discordUserId
        );

        /*
         * Versandversuch VOR dem Discord-Aufruf dauerhaft protokollieren.
         * Der Store liefert den verbindlichen dueAt-Wert zurück.
         */
        invoice = recordInvoiceSendAttempt(
            invoice.id,
            new Date(),
            'pending',
            interaction.user.id
        );

        /*
         * Die Zahlungsfrist und alle Rechnungsdaten werden erst
         * nach dem gespeicherten Versandversuch final formatiert.
         */
        const invoiceMessage = createInvoiceEmbeds(
            invoice,
            driverName
        );

        /*
         * 1. Ausschließlich den eigentlichen Discord-Versand behandeln.
         */
        try {
            await targetMember.send({
                embeds: invoiceMessage.embeds,
                files: [
                    invoiceMessage.attachment,
                ],
            });
        } catch (sendError) {
            const discordErrorCode =
                sendError.code ??
                sendError.rawError?.code;

            const delivery =
                Number(discordErrorCode) === 50007
                    ? 'failed'
                    : 'unknown';

            try {
                recordInvoiceDeliveryResult(
                    invoice.id,
                    delivery,
                    interaction.user.id
                );
            } catch (storeError) {
                logger.error(
                    `ETS-Abrechnung: Zustellfehler für ${invoice.id} konnte nicht gespeichert werden. Status bleibt pending.`,
                    storeError
                );

                logger.error(
                    `ETS-Abrechnung: DM-Versand für ${invoice.id} fehlgeschlagen`,
                    sendError
                );

                return interaction.editReply({
                    embeds: [
                        createErrorEmbed(
                            'Der DM-Versand ist fehlgeschlagen, aber der Zustellstatus konnte nicht gespeichert werden. Die Rechnung bleibt vorsorglich gesperrt. Es wurde keine öffentliche Nachricht ausgelöst.'
                        ),
                    ],
                });
            }

            logger.error(
                `ETS-Abrechnung: DM-Versand für ${invoice.id} fehlgeschlagen`,
                sendError
            );

            if (delivery !== 'failed') {
                return interaction.editReply({
                    embeds: [
                        createErrorEmbed(
                            'Der Zustellstatus ist unklar. Es wurde keine öffentliche Nachricht ausgelöst, um Doppelbenachrichtigungen zu vermeiden. Die Rechnung bleibt für einen erneuten Versand gesperrt.'
                        ),
                    ],
                });
            }

            try {
                await sendPublicBillingFallback(
                    interaction,
                    invoice,
                    interaction.user.id
                );

                return interaction.editReply({
                    content:
                        `Die Direktnachricht an <@${invoice.discordUserId}> wurde von Discord abgelehnt. ` +
                        `Die Identität wurde geprüft und die neutrale Benachrichtigung im Fahrer-Chat veröffentlicht.`,
                });
            } catch (fallbackError) {
                logger.error(
                    `ETS-Abrechnung: Öffentlicher Fallback für ${invoice.id} fehlgeschlagen oder gesperrt.`,
                    fallbackError
                );

                return interaction.editReply({
                    embeds: [
                        createErrorEmbed(
                            `Die Direktnachricht wurde abgelehnt. Eine öffentliche Benachrichtigung wurde nicht sicher abgeschlossen. Bitte manuell prüfen: ${fallbackError.message}`
                        ),
                    ],
                });
            }
        }

        /*
         * 2. Der DM-Versand war erfolgreich.
         *
         * Das Speichern des Ergebnisses darf NICHT als Versandfehler
         * behandelt werden, da die Nachricht bereits versendet wurde.
         */
        try {
            recordInvoiceDeliveryResult(
                invoice.id,
                'delivered',
                interaction.user.id
            );
        } catch (storeError) {
            logger.error(
                `ETS-Abrechnung: DM für ${invoice.id} wurde versendet, aber der Zustellstatus konnte nicht gespeichert werden. Rechnung bleibt pending.`,
                storeError
            );

            return interaction.editReply({
                embeds: [
                    createErrorEmbed(
                        'Die Direktnachricht wurde versendet. Der Zustellstatus konnte jedoch nicht gespeichert werden. Die Rechnung bleibt vorsorglich gesperrt. Bitte keinen erneuten Versand auslösen; der Status muss manuell geprüft werden.'
                    ),
                ],
            });
        }

        return interaction.editReply({
            content:
                `Rechnung \`${invoice.id}\` wurde mit HKC-Rechnungslayout ` +
                `per Direktnachricht an <@${invoice.discordUserId}> versendet.`,
        });
    } catch (error) {
        logger.error(
            'ETS-Abrechnung: Versand fehlgeschlagen',
            error
        );

        return interaction.editReply({
            embeds: [
                createErrorEmbed(error.message),
            ],
        });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ets')
        .setDescription('ETS2/ATS- und SpedV-Funktionen')

        // SpedV-Verknüpfung
        .addSubcommand(subcommand =>
            subcommand
                .setName('link')
                .setDescription(
                    'Verknüpfe deinen Discord-Account mit SpedV'
                )
                .addStringOption(option =>
                    option
                        .setName('spedv-name')
                        .setDescription(
                            'Dein exakter SpedV-Name'
                        )
                        .setRequired(true)
                )
        )

        // Abrechnungsfunktionen
        .addSubcommandGroup(group =>
            group
                .setName('abrechnung')
                .setDescription(
                    'Monatliche Fahrerabrechnungen'
                )

                .addSubcommand(subcommand =>
                    subcommand
                        .setName('vorschau')
                        .setDescription(
                            'Zeigt die vorbereiteten Monatsrechnungen'
                        )
                        .addStringOption(option =>
                            option
                                .setName('monat')
                                .setDescription(
                                    'Abrechnungsmonat im Format YYYY-MM'
                                )
                                .setRequired(true)
                        )
                )

                .addSubcommand(subcommand =>
                    subcommand
                        .setName('senden')
                        .setDescription(
                            'Sendet eine Monatsrechnung nach Bestätigung'
                        )
                        .addStringOption(option =>
                            option
                                .setName('rechnung-id')
                                .setDescription(
                                    'Eindeutige ID der Monatsrechnung'
                                )
                                .setRequired(true)
                        )
                )

                .addSubcommand(subcommand =>
                    subcommand
                        .setName('status')
                        .setDescription(
                            'Zeigt den Status einer Fahrerabrechnung'
                        )
                        .addUserOption(option =>
                            option
                                .setName('fahrer')
                                .setDescription(
                                    'Discord-Mitglied des Fahrers'
                                )
                                .setRequired(false)
                        )
                )
                .addSubcommand(subcommand =>
                    subcommand
                        .setName('bezahlt')
                        .setDescription(
                            'Bestätigt den Zahlungseingang einer Rechnung'
                        )
                        .addStringOption(option =>
                            option
                                .setName('rechnung-id')
                                .setDescription(
                                    'Eindeutige ID der bezahlten Rechnung'
                                )
                                .setRequired(true)
                        )
                )
        ),

    async execute(interaction) {
        const subcommandGroup =
            interaction.options.getSubcommandGroup(false);

        const subcommand =
            interaction.options.getSubcommand(false);

        if (subcommandGroup === 'abrechnung') {
            if (subcommand === 'vorschau') {
                return handleBillingPreview(interaction);
            }

            if (subcommand === 'senden') {
                return handleBillingSend(interaction);
            }

            if (subcommand === 'status') {
                return handleBillingStatus(interaction);
            }

            if (subcommand === 'bezahlt') {
                return handleBillingPaid(interaction);
            }
        }

        if (subcommand === 'link') {
            return verifySpedvName(interaction);
        }

        return interaction.reply({
            embeds: [
                createErrorEmbed(
                    'Dieser ETS-Befehl ist nicht bekannt.'
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });
    },
};
