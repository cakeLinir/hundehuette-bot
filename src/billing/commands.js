'use strict';

const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');
const logger = require('../utils/logger');
const rules = require('./rules');
const { StoreError } = require('./db');
const { buildStatement, runClosingCheck } = require('./closing');
const { describeLine } = require('./invoiceMessage');
const { buildStatementMessage, buildClosingMessage } = require('./report');
const { berlinMonth, isMonthClosed, monthsBetween } = require('./time');

const COLORS = Object.freeze({ info: 0x3498db, ok: 0x2ecc71, warn: 0xf39c12, fail: 0xe74c3c });
const BILLING_START_MONTH = rules.billingStartDate.slice(0, 7);
const CONFIRM_MS = 60_000;
const FIELD_LIMIT = 600;
const MAX_DETAIL_FIELDS = 8;
const UNIT_LABEL = Object.freeze({ kmh: 'km/h', mph: 'mph' });

const STATUS_LABEL = Object.freeze({
    fine: 'Strafe',
    clear: 'kein Verstoß',
    waived: 'Ausnahme genehmigt',
    dismissed: 'kein Verstoß (geklärt)',
    open_review: 'Prüffall offen',
});

const ART = Object.freeze({
    'kein-verstoss': { kind: 'dismiss', label: 'Prüffall geklärt (kein Verstoß)' },
    festsetzen: { kind: 'assess', label: 'Strafe festgesetzt' },
    ausnahme: { kind: 'waive', label: 'Ausnahme genehmigt (§ 5.3)' },
    widerrufen: { kind: 'revoke', label: 'Entscheidung widerrufen' },
});

const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const money = amount => euro.format(amount).replace(/\u00a0/g, ' ');

const clip = (text, max) => {
    const value = String(text ?? '');
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const dateText = iso => new Date(iso).toLocaleDateString('de-DE', {
    timeZone: rules.timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});

const card = (title, description, color = COLORS.info) => ({
    embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(clip(description, 4000))],
});
const failure = text => card('Nicht möglich', text, COLORS.fail);
const success = (title, text) => card(title, text, COLORS.ok);

function fieldFrom(name, lines) {
    let value = '';
    let shown = 0;
    for (const line of lines) {
        const next = `${value ? `${value}\n` : ''}${clip(line, 110)}`;
        if (next.length > FIELD_LIMIT) break;
        value = next;
        shown += 1;
    }
    if (shown < lines.length) value += `\n… und ${lines.length - shown} weitere`;
    return { name: clip(`${name} (${lines.length})`, 256), value, inline: false };
}

const DETAIL_LINES = Object.freeze({
    open_reviews: e => `${e.visibleId ?? `#${e.taskId}`} ${e.spedvName ?? 'unbekannt'}${e.global ? ' (ohne Monat)' : ''} · ${e.message}`,
    not_evaluated: e => `${e.visibleId}`,
    pending_tasks: e => `${e.visibleId} · ${e.state}`,
    provisional_tasks: e => `${e.visibleId} ${e.spedvName} · ${e.state}`,
    state_changed: e => `${e.visibleId} ${e.spedvName} · ${e.state}`,
    unlinked_drivers: e => `${e.spedvName} · ${money(e.fineEur)}`,
    invoice_totals: e => `${e.number} · Summe ${money(e.totalEur)}, Zeilen ${money(e.lineSumEur)}`,
    late_fines: e => `${e.number} · ${e.visibleId} (${e.spedvName})`,
    drafts_missing: e => `${e.spedvName} · ${money(e.fineEur)}`,
});

function detailFields(check) {
    return check.items
        .filter(item => item.status !== 'ok' && item.data.length > 0 && DETAIL_LINES[item.id])
        .map(item => fieldFrom(item.label, item.data.map(DETAIL_LINES[item.id])))
        .slice(0, MAX_DETAIL_FIELDS);
}

function monthOption(interaction, fallback) {
    const value = interaction.options.getString('monat');
    if (!value) return fallback;

    const month = value.trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new StoreError('Der Monat muss im Format JJJJ-MM angegeben werden, zum Beispiel 2026-11.');
    }
    return month;
}

/** Letzter abgeschlossener Monat, sonst der aktuelle. */
function defaultReviewMonth(at) {
    const closed = monthsBetween(BILLING_START_MONTH, berlinMonth(at)).filter(month => isMonthClosed(month, at));
    return closed.at(-1) ?? berlinMonth(at);
}

function invoiceNumberOption(interaction, required = true) {
    const value = String(interaction.options.getString('rechnung') ?? '').trim().toUpperCase();
    if (!value && required) throw new StoreError('Bitte gib die Rechnungsnummer an.');
    return value;
}

function createAbrechnungHandlers(deps) {
    const {
        getContext,
        isModuleEnabled,
        canAct,
        findLink,
        linksOf,
        sendInvoice,
        announce,
        now = () => new Date(),
    } = deps;

    const note = async (guild, text) => {
        try {
            await announce(guild, text);
        } catch (error) {
            logger.warn(`Abrechnung: Hinweis im Buchhaltungs-Channel nicht gesendet: ${error.message}`);
        }
    };

    function requireStaff(interaction) {
        if (!canAct(interaction, 'staff')) {
            throw new StoreError(
                'Dafür fehlt dir die Berechtigung. Erlaubt sind Geschäftsführung, Stellvertretung, Buchhaltungsleitung und Buchhaltung.'
            );
        }
    }

    const linkedIdsOf = statement =>
        statement.drivers
            .map(driver => driver.spedvUserId)
            .filter(Boolean)
            .filter(id => {
                try {
                    return findLink(id)?.verified === true;
                } catch {
                    return false;
                }
            });

    async function readiness(ctx, month, at) {
        let listed;
        try {
            listed = await ctx.spedvClient.fetchTasks();
        } catch {
            throw new StoreError('SpedV ist gerade nicht erreichbar. Die Prüfung braucht die aktuelle Auftragsliste.');
        }

        const statement = buildStatement({ store: ctx.store, month });
        const check = runClosingCheck({
            store: ctx.store,
            listedTasks: listed,
            linkedUserIds: linkedIdsOf(statement),
            month,
            now: at,
        });
        return { statement, check };
    }

    // --- Fahrer ---

    async function handleOwn(interaction, ctx) {
        const links = linksOf(interaction.user.id).filter(link => link.verified);
        if (links.length === 0) {
            return interaction.editReply(card(
                'Keine Verknüpfung',
                'Du bist noch nicht mit deinem SpedV-Konto verknüpft. Nutze **/ets link**, danach siehst du hier deine Abrechnung.'
            ));
        }

        const at = now();
        const months = monthsBetween(BILLING_START_MONTH, berlinMonth(at)).slice(-6);
        const embed = new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle('📒 Deine Abrechnung')
            .setFooter({ text: 'HKC Abrechnung | Virtuelle Strafzahlungen nach § 5, keine reale Geldforderung' });

        let sections = 0;
        for (const link of links) {
            for (const month of months) {
                const fines = ctx.store.listFines({ month, spedvUserId: link.spedvUserId });
                const invoice = ctx.store
                    .listInvoices({ month, spedvUserId: link.spedvUserId })
                    .find(entry => entry.status !== 'void');
                const pending = ctx.store.listBlockingReviews({ month, spedvUserId: link.spedvUserId }).length;

                if (fines.length === 0 && !invoice && pending === 0) continue;

                const lines = fines.slice(0, 8).map(row => {
                    const info = describeLine(
                        { max_velocity_kmh: row.max_velocity_kmh, fine_eur: row.effective_fine_eur },
                        row
                    );
                    const speed = info.speed === null ? '-' : `${info.speed} ${info.unit}`;
                    return `${row.visible_id ?? `#${row.task_id}`} · ${speed} · ${money(row.effective_fine_eur)}`;
                });
                if (fines.length > 8) lines.push(`… und ${fines.length - 8} weitere`);

                const total = fines.reduce((sum, row) => sum + row.effective_fine_eur, 0);
                if (fines.length > 0) lines.push(`**Summe: ${money(total)}**`);

                if (invoice) {
                    const state = {
                        draft: 'Entwurf, noch nicht versendet',
                        sent: `versendet, fällig bis ${invoice.due_at ? dateText(invoice.due_at) : '-'}`,
                        paid: 'bezahlt',
                    }[invoice.status];
                    lines.push(`Rechnung ${invoice.number}: ${state}`);
                }
                if (pending > 0) lines.push(`⏳ ${pending} Auftrag/Aufträge werden noch geprüft.`);

                embed.addFields({
                    name: links.length > 1 ? `${month} · ${link.spedvName}` : month,
                    value: clip(lines.join('\n'), 1000),
                    inline: false,
                });
                sections += 1;
            }
        }

        if (sections === 0) embed.setDescription('Du hast aktuell keine Strafen. Weiter so!');
        return interaction.editReply({ embeds: [embed] });
    }

    // --- Buchhaltung ---

    async function handleStatus(interaction, ctx) {
        const at = now();
        const month = monthOption(interaction, berlinMonth(at));
        const statement = buildStatement({ store: ctx.store, month });
        return interaction.editReply(buildStatementMessage({ statement, closed: isMonthClosed(month, at), now: at }));
    }

    async function handleCheck(interaction, ctx) {
        const at = now();
        const month = monthOption(interaction, defaultReviewMonth(at));
        const { check } = await readiness(ctx, month, at);

        await interaction.editReply(buildClosingMessage({ check, now: at }));

        const fields = detailFields(check);
        if (fields.length > 0) {
            await interaction.followUp({
                embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle(`Details ${month}`).addFields(fields)],
                flags: MessageFlags.Ephemeral,
            });
        }
        return null;
    }

    async function handleReviews(interaction, ctx) {
        const month = monthOption(interaction, null);
        const reviews = ctx.store.listOpenReviews({ month });

        if (reviews.length === 0) {
            return interaction.editReply(success('Keine offenen Prüffälle', 'Es gibt nichts zu klären.'));
        }

        const lines = reviews.slice(0, 25).map(row =>
            `${row.visible_id ?? `#${row.task_id}`} · ${row.spedv_name ?? 'unbekannt'} · ${row.billing_month ?? 'ohne Monat'} · ${clip(row.message, 120)}`
        );
        if (reviews.length > 25) lines.push(`… und ${reviews.length - 25} weitere`);

        return interaction.editReply(card(
            `Offene Prüffälle (${reviews.length})`,
            `${lines.join('\n')}\n\nKlären mit **/abrechnung klaeren**.`,
            COLORS.warn
        ));
    }

    async function handleDecide(interaction, ctx) {
        const taskId = String(interaction.options.getString('auftrag') ?? '').replace(/\D/g, '');
        if (!taskId) throw new StoreError('Bitte gib die Auftragsnummer an, zum Beispiel #12\'657\'450.');

        const art = ART[interaction.options.getString('art')];
        if (!art) throw new StoreError('Unbekannte Art der Klärung.');

        const reason = String(interaction.options.getString('begruendung') ?? '').trim();
        const task = ctx.store.getEffective(taskId);
        if (!task) throw new StoreError('Auftrag nicht gefunden. Es gibt nur ausgewertete Aufträge.');

        // Ausnahmen und ihr Widerruf: nur Geschäftsführung und Stellvertretung
        const touchesException = art.kind === 'waive' || (art.kind === 'revoke' && task.decision_kind === 'waive');
        if (touchesException && !canAct(interaction, 'exception')) {
            throw new StoreError('Ausnahmen nach § 5.3 dürfen nur Geschäftsführung und Stellvertretung genehmigen oder widerrufen.');
        }

        const actor = interaction.user.id;
        let result;
        let extra = '';

        if (art.kind === 'revoke') {
            result = ctx.store.revokeDecision({ taskId, reason, actor });
        } else if (art.kind === 'assess') {
            const speed = interaction.options.getNumber('geschwindigkeit');
            if (speed === null || speed === undefined) {
                throw new StoreError('Zum Festsetzen der Strafe ist die festgestellte Geschwindigkeit nötig (km/h bei ETS2, mph bei ATS).');
            }
            result = ctx.store.decide({ taskId, kind: 'assess', reason, actor, speed });
            extra = ` (${speed} ${UNIT_LABEL[rules.games[task.game]?.unit] ?? ''})`.replace(' ()', '');
        } else {
            result = ctx.store.decide({ taskId, kind: art.kind, reason, actor });
        }

        const visible = result.visible_id ?? `#${taskId}`;
        await note(interaction.guild, `🔎 ${visible}: ${art.label} durch <@${actor}> – ${clip(reason, 200)}`);

        const label = STATUS_LABEL[result.effective_status] ?? result.effective_status;
        const fine = result.effective_fine_eur > 0 ? ` · ${money(result.effective_fine_eur)}` : '';
        return interaction.editReply(success(art.label, `Auftrag **${visible}** · ${label}${fine}${extra}`));
    }

    async function handleSendOne(interaction, ctx, number) {
        const at = now();
        const invoice = ctx.store.getInvoice(number);
        if (!invoice) throw new StoreError('Rechnung nicht gefunden.');

        const { check } = await readiness(ctx, invoice.billing_month, at);
        const ready = check.readyDrivers.some(driver => driver.spedvUserId === invoice.spedv_user_id);
        if (!ready) {
            const open = check.items.filter(item => item.status === 'fail').map(item => item.label);
            throw new StoreError(
                `Der Fahrer ist für ${invoice.billing_month} noch nicht versandbereit.` +
                `${open.length ? ` Offen: ${open.join(', ')}.` : ''} Details: /abrechnung pruefung monat:${invoice.billing_month}`
            );
        }

        const result = await sendInvoice({
            guild: interaction.guild,
            store: ctx.store,
            number,
            actor: interaction.user.id,
            config: ctx.config,
            now: at,
            findLink,
        });

        await note(
            interaction.guild,
            `📨 Rechnung ${number} wurde von <@${interaction.user.id}> versendet (${deliveryText(result)}).`
        );
        return interaction.editReply(success('Rechnung versendet', `**${number}** · ${deliveryText(result)} · Frist bis ${dateText(result.dueAt)}`));
    }

    const deliveryText = result => {
        if (result.delivery === 'delivered') return 'zugestellt';
        if (result.delivery === 'failed') {
            return result.fallback === 'sent'
                ? 'DM nicht möglich, Hinweis im Fahrer-Chat'
                : 'DM nicht möglich, kein Hinweis im Chat';
        }
        return 'Zustellung unklar, bitte prüfen';
    };

    async function handleSendMonth(interaction, ctx, month) {
        const at = now();
        const { check } = await readiness(ctx, month, at);
        const targets = check.readyDrivers.filter(driver => driver.invoiceNumber && driver.invoiceStatus === 'draft');

        if (targets.length === 0) {
            throw new StoreError(`Für ${month} gibt es keine versandbereiten Entwürfe. Details: /abrechnung pruefung monat:${month}`);
        }

        const yes = `abr-yes-${interaction.id}`;
        const no = `abr-no-${interaction.id}`;
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(yes).setLabel('Jetzt senden').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(no).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary)
        );

        const total = targets.reduce((sum, driver) => sum + driver.fineEur, 0);
        const lines = targets.slice(0, 20).map(driver => `${driver.spedvName} · ${driver.invoiceNumber} · ${money(driver.fineEur)}`);
        if (targets.length > 20) lines.push(`… und ${targets.length - 20} weitere`);

        const message = await interaction.editReply({
            ...card(
                `Rechnungen ${month} versenden?`,
                `**${targets.length}** Rechnungen, zusammen **${money(total)}**:\n\n${lines.join('\n')}\n\n` +
                'Die Fahrer erhalten die Rechnung per Direktnachricht, die Zahlungsfrist beginnt jetzt.',
                COLORS.warn
            ),
            components: [row],
        });

        let pressed;
        try {
            pressed = await message.awaitMessageComponent({
                filter: component => component.user.id === interaction.user.id && component.customId.endsWith(interaction.id),
                time: CONFIRM_MS,
            });
        } catch {
            return interaction.editReply({ ...card('Zeit abgelaufen', 'Es wurde nichts versendet.'), components: [] });
        }

        if (pressed.customId !== yes) {
            await pressed.update({ ...card('Abgebrochen', 'Es wurde nichts versendet.'), components: [] });
            return null;
        }

        await pressed.update({ ...card('Versand läuft …', `${targets.length} Rechnungen werden gesendet.`, COLORS.warn), components: [] });

        // Direkt vor dem Versand noch einmal prüfen: es kann sich in der Zwischenzeit etwas geändert haben
        const fresh = await readiness(ctx, month, now());
        const allowed = new Set(
            fresh.check.readyDrivers.filter(driver => driver.invoiceStatus === 'draft').map(driver => driver.invoiceNumber)
        );

        const counts = { delivered: 0, failed: 0, unknown: 0, fallback: 0, skipped: 0 };
        const errors = [];

        for (const target of targets) {
            if (!allowed.has(target.invoiceNumber)) {
                counts.skipped += 1;
                continue;
            }

            try {
                const result = await sendInvoice({
                    guild: interaction.guild,
                    store: ctx.store,
                    number: target.invoiceNumber,
                    actor: interaction.user.id,
                    config: ctx.config,
                    now: now(),
                    findLink,
                });
                counts[result.delivery] += 1;
                if (result.fallback === 'sent') counts.fallback += 1;
            } catch (error) {
                if (!(error instanceof StoreError)) logger.error(`Abrechnung: Versand ${target.invoiceNumber} fehlgeschlagen`, error);
                errors.push(`${target.spedvName}: ${error instanceof StoreError ? error.message : 'Unerwarteter Fehler'}`);
            }
        }

        await note(
            interaction.guild,
            `📨 Rechnungen ${month} wurden von <@${interaction.user.id}> versendet: ` +
            `zugestellt ${counts.delivered}, Hinweis im Chat ${counts.fallback}, unklar ${counts.unknown}, ` +
            `nicht gesendet ${counts.skipped + errors.length}.`
        );

        const summary = [
            `Zugestellt: **${counts.delivered}**`,
            `DM nicht möglich (Hinweis im Chat: ${counts.fallback}): **${counts.failed}**`,
            `Zustellung unklar: **${counts.unknown}**`,
            `Übersprungen: **${counts.skipped}**`,
            `Fehler: **${errors.length}**`,
            ...errors.map(entry => `• ${clip(entry, 150)}`),
        ];
        return interaction.editReply({
            ...card(`Rechnungen ${month}`, summary.join('\n'), errors.length || counts.unknown ? COLORS.warn : COLORS.ok),
            components: [],
        });
    }

    async function handleSend(interaction, ctx) {
        const number = invoiceNumberOption(interaction, false);
        const month = interaction.options.getString('monat')?.trim();

        if (Boolean(number) === Boolean(month)) {
            throw new StoreError('Gib entweder eine Rechnungsnummer (rechnung) oder einen Monat (monat) an, aber nicht beides.');
        }
        if (number) return handleSendOne(interaction, ctx, number);

        return handleSendMonth(interaction, ctx, monthOption(interaction, null));
    }

    async function handlePaid(interaction, ctx) {
        const number = invoiceNumberOption(interaction);
        const result = ctx.store.markPaid({ number, actor: interaction.user.id, now: now() });

        if (!result.updated) {
            return interaction.editReply(card('Schon erledigt', `Die Rechnung **${number}** ist bereits als bezahlt markiert.`));
        }

        await note(interaction.guild, `💶 Rechnung ${number} ist bezahlt (bestätigt von <@${interaction.user.id}>).`);
        return interaction.editReply(success('Zahlung bestätigt', `Die Rechnung **${number}** ist als bezahlt markiert.`));
    }

    async function handleVoid(interaction, ctx) {
        const number = invoiceNumberOption(interaction);
        const reason = String(interaction.options.getString('grund') ?? '').trim();

        ctx.store.voidInvoice({ number, reason, actor: interaction.user.id, now: now() });

        await note(interaction.guild, `🗑️ Rechnung ${number} wurde von <@${interaction.user.id}> storniert: ${clip(reason, 200)}`);
        return interaction.editReply(success(
            'Rechnung storniert',
            `**${number}** ist storniert, die Aufträge sind wieder frei. Der Fahrer wird nicht automatisch benachrichtigt.`
        ));
    }

    async function handleRun(interaction, ctx) {
        if (!ctx.runtime?.runNow) throw new StoreError('Der Zeitplan der Abrechnung läuft nicht.');

        const result = await ctx.runtime.runNow();
        if (result.skipped) return interaction.editReply(card('Nicht ausgeführt', `Grund: ${result.skipped}.`));
        if (result.error) throw new StoreError(`Der Lauf ist fehlgeschlagen: ${result.error}`);

        return interaction.editReply(success('Lauf abgeschlossen', [
            `Ausgewertet: **${result.evaluated}**`,
            `Neue Strafen: **${result.newFines}**`,
            `Neue Prüffälle: **${result.newReviews}**`,
            `Übersichten aktualisiert: **${result.statements.length}**`,
            `Generalprüfungen: **${result.closings.length}**`,
        ].join('\n')));
    }

    const HANDLERS = Object.freeze({
        meine: { run: handleOwn, staff: false },
        status: { run: handleStatus, staff: true },
        pruefung: { run: handleCheck, staff: true },
        pruefaelle: { run: handleReviews, staff: true },
        klaeren: { run: handleDecide, staff: true },
        senden: { run: handleSend, staff: true },
        bezahlt: { run: handlePaid, staff: true },
        storno: { run: handleVoid, staff: true },
        lauf: { run: handleRun, staff: true },
    });

    async function execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            if (!interaction.guild) throw new StoreError('Dieser Befehl funktioniert nur auf dem Server.');
            if (!isModuleEnabled(interaction.guild.id)) {
                throw new StoreError('Das ETS2/ATS-Modul ist auf diesem Server deaktiviert.');
            }

            const ctx = getContext();
            if (!ctx.enabled) throw new StoreError('Die Abrechnung ist noch nicht eingeschaltet.');

            const handler = HANDLERS[interaction.options.getSubcommand()];
            if (!handler) throw new StoreError('Dieser Abrechnungsbefehl ist nicht bekannt.');
            if (handler.staff) requireStaff(interaction);

            return await handler.run(interaction, ctx);
        } catch (error) {
            if (!(error instanceof StoreError)) logger.error('Abrechnung: Befehl fehlgeschlagen', error);

            const reply = error instanceof StoreError
                ? failure(error.message)
                : failure('Unerwarteter Fehler. Details stehen im Bot-Protokoll.');
            return interaction.editReply({ ...reply, components: [] }).catch(() => null);
        }
    }

    return { execute };
}

module.exports = { createAbrechnungHandlers };