'use strict';

const rules = require('./rules');
const { isMonthClosed } = require('./time');
const {
    StoreError,
    plainAll,
    requireText,
    requireMonth,
} = require('./db');

const DAY_MS = 86_400_000;
const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'void'];
const DELIVERY_RESULTS = ['delivered', 'failed', 'unknown'];

function parseDate(value, label) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new StoreError(`${label} ist kein gültiger Zeitpunkt.`);
    }
    return date;
}

function createInvoiceApi({ db, transaction, writeAudit }) {
    const st = {
        byNumber: db.prepare('SELECT * FROM invoices WHERE number = ?'),
        findActive: db.prepare(
            `SELECT * FROM invoices WHERE billing_month = ? AND spedv_user_id = ? AND status <> 'void'`
        ),
        numberExists: db.prepare('SELECT 1 AS found FROM invoices WHERE number = ?'),
        lines: db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY completed_at, task_id'),
        blockers: db.prepare(`
      SELECT task_id FROM task_effective
      WHERE effective_status = 'open_review'
        AND (billing_month IS NULL OR (billing_month = ? AND spedv_user_id = ?))
      ORDER BY task_id`),
        openFines: db.prepare(`
      SELECT
        e.task_id,
        e.visible_id,
        e.completed_at,
        e.spedv_name,
        e.effective_fine_eur AS fine_eur,
        CASE WHEN e.decision_kind = 'assess' THEN d.speed_kmh ELSE e.max_velocity_kmh END AS max_velocity_kmh,
        CASE WHEN e.decision_kind = 'assess' THEN d.excess_kmh ELSE e.excess_kmh END AS excess_kmh
      FROM task_effective e
      LEFT JOIN decisions d ON d.id = e.decision_id
      WHERE e.effective_status = 'fine'
        AND e.billing_month = ?
        AND e.spedv_user_id = ?
        AND NOT EXISTS (SELECT 1 FROM invoice_lines l WHERE l.task_id = e.task_id AND l.active = 1)
      ORDER BY e.completed_at, e.task_id`),
        driversWithOpenFines: db.prepare(`
      SELECT DISTINCT e.spedv_user_id
      FROM task_effective e
      WHERE e.effective_status = 'fine'
        AND e.billing_month = ?
        AND e.spedv_user_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM invoice_lines l WHERE l.task_id = e.task_id AND l.active = 1)
      ORDER BY e.spedv_user_id`),
        insertInvoice: db.prepare(`
      INSERT INTO invoices (number, billing_month, spedv_user_id, spedv_name, total_eur, status, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`),
        insertLine: db.prepare(`
      INSERT INTO invoice_lines (invoice_id, task_id, visible_id, completed_at, max_velocity_kmh, excess_kmh, fine_eur)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
        setTotal: db.prepare('UPDATE invoices SET total_eur = ? WHERE id = ?'),
        firstSend: db.prepare(`
      UPDATE invoices SET status = 'sent', discord_id = ?, first_send_at = ?, last_send_at = ?,
        due_at = ?, delivery = 'pending' WHERE id = ?`),
        retrySend: db.prepare(`
      UPDATE invoices SET discord_id = ?, last_send_at = ?, delivery = 'pending' WHERE id = ?`),
        setDelivery: db.prepare('UPDATE invoices SET delivery = ? WHERE id = ?'),
        fallbackAttempt: db.prepare(`
      UPDATE invoices SET fallback_status = 'pending', fallback_channel_id = ?, fallback_at = ? WHERE id = ?`),
        fallbackResult: db.prepare(`
      UPDATE invoices SET fallback_status = ?, fallback_message_id = ? WHERE id = ?`),
        reminder: db.prepare('UPDATE invoices SET reminder_at = ?, reminder_delivery = ? WHERE id = ?'),
        dueForReminder: db.prepare(`
      SELECT * FROM invoices
      WHERE status = 'sent' AND due_at < ? AND reminder_at IS NULL
      ORDER BY due_at, number`),
        pay: db.prepare(`UPDATE invoices SET status = 'paid', paid_at = ?, paid_by = ? WHERE id = ?`),
        voidInvoice: db.prepare(`
      UPDATE invoices SET status = 'void', void_at = ?, void_by = ?, void_reason = ? WHERE id = ?`),
        deactivateLines: db.prepare('UPDATE invoice_lines SET active = 0 WHERE invoice_id = ?'),
        list: db.prepare(`
      SELECT * FROM invoices
      WHERE (? IS NULL OR billing_month = ?)
        AND (? IS NULL OR status = ?)
        AND (? IS NULL OR spedv_user_id = ?)
      ORDER BY billing_month, number`),
    };

    function loadInvoice(row) {
        if (!row) return null;
        return { ...row, lines: plainAll(st.lines.all(row.id)) };
    }

    function requireInvoice(number) {
        const invoice = st.byNumber.get(String(number ?? '').trim());
        if (!invoice) throw new StoreError('Rechnung nicht gefunden.');
        return invoice;
    }

    function nextNumber(month, spedvUserId) {
        const base = `HKC-${month}-${spedvUserId}`;
        let number = base;
        let revision = 1;
        while (st.numberExists.get(number)) {
            revision += 1;
            number = `${base}-${revision}`;
        }
        return number;
    }

    function assertMonthBillable(month, now) {
        requireMonth(month);
        if (month < rules.billingStartDate.slice(0, 7)) {
            throw new StoreError(`Vor dem Abrechnungsbeginn (${rules.billingStartDate}) wird nichts abgerechnet.`);
        }
        if (!isMonthClosed(month, now)) {
            throw new StoreError('Der Monat ist noch nicht abgeschlossen.');
        }
    }

    /**
     * Erstellt den Rechnungsentwurf eines Fahrers für einen abgeschlossenen Monat.
     * Nur Aufträge mit Strafe über 0 EUR kommen hinein. Erwartete Fälle liefern ein Ergebnis
     * mit "reason" statt eines Fehlers: no_fines, blocked, exists, exists_late_fines.
     */
    function createDraft({ month, spedvUserId, actor, now = new Date() }) {
        const who = requireText(actor, 'Die ausführende Person', 1, 64);
        const user = requireText(spedvUserId, 'Die SpedV-ID', 1, 20);
        const at = parseDate(now, 'Der Zeitpunkt');
        assertMonthBillable(month, at);

        return transaction(() => {
            const existing = st.findActive.get(month, user);
            const fines = st.openFines.all(month, user);

            if (existing && fines.length === 0) {
                return { created: false, reason: 'exists', invoice: loadInvoice(existing) };
            }

            const blockers = st.blockers.all(month, user).map(row => row.task_id);
            if (blockers.length > 0) {
                return { created: false, reason: 'blocked', blockers };
            }

            if (!existing && fines.length === 0) {
                return { created: false, reason: 'no_fines' };
            }

            const addedTotal = fines.reduce((sum, line) => sum + line.fine_eur, 0);

            if (existing) {
                if (existing.status !== 'draft') {
                    return {
                        created: false,
                        reason: 'exists_late_fines',
                        invoice: loadInvoice(existing),
                        lateTaskIds: fines.map(line => line.task_id),
                    };
                }

                for (const line of fines) {
                    st.insertLine.run(
                        existing.id, line.task_id, line.visible_id, line.completed_at,
                        line.max_velocity_kmh, line.excess_kmh, line.fine_eur
                    );
                }
                st.setTotal.run(existing.total_eur + addedTotal, existing.id);
                writeAudit(who, 'invoice_draft_updated', existing.number, {
                    addedTasks: fines.map(line => line.task_id),
                    totalEur: existing.total_eur + addedTotal,
                });

                return {
                    created: false,
                    updated: true,
                    invoice: loadInvoice(st.byNumber.get(existing.number)),
                };
            }

            const number = nextNumber(month, user);
            const info = st.insertInvoice.run(
                number, month, user, fines[0].spedv_name ?? user, addedTotal, at.toISOString(), who
            );
            const invoiceId = Number(info.lastInsertRowid);

            for (const line of fines) {
                st.insertLine.run(
                    invoiceId, line.task_id, line.visible_id, line.completed_at,
                    line.max_velocity_kmh, line.excess_kmh, line.fine_eur
                );
            }

            writeAudit(who, 'invoice_draft_created', number, {
                tasks: fines.map(line => line.task_id),
                totalEur: addedTotal,
            });

            return { created: true, invoice: loadInvoice(st.byNumber.get(number)) };
        });
    }

    /** Erstellt Entwürfe für alle Fahrer mit noch nicht abgerechneten Strafen. */
    function createDraftsForMonth({ month, actor, now = new Date() }) {
        const at = parseDate(now, 'Der Zeitpunkt');
        assertMonthBillable(month, at);

        const results = st.driversWithOpenFines.all(month).map(row => ({
            spedvUserId: row.spedv_user_id,
            ...createDraft({ month, spedvUserId: row.spedv_user_id, actor, now: at }),
        }));

        return {
            month,
            created: results.filter(result => result.created).length,
            updated: results.filter(result => result.updated).length,
            blocked: results.filter(result => result.reason === 'blocked').length,
            lateFines: results.filter(result => result.reason === 'exists_late_fines').length,
            results,
        };
    }

    function getInvoice(number) {
        return loadInvoice(st.byNumber.get(String(number ?? '').trim()));
    }

    function listInvoices({ month = null, status = null, spedvUserId = null } = {}) {
        if (month !== null) requireMonth(month);
        if (status !== null && !INVOICE_STATUSES.includes(status)) {
            throw new StoreError('Unbekannter Rechnungsstatus.');
        }
        const user = spedvUserId === null ? null : String(spedvUserId);
        return plainAll(st.list.all(month, month, status, status, user, user));
    }

    /**
     * Hält einen Versandversuch fest und setzt beim ersten Versuch die Frist
     * (Zahlungsfrist ab erstem Versandversuch, auch wenn die DM nicht zugestellt wird).
     */
    function recordSendAttempt({ number, discordId, actor, now = new Date() }) {
        const who = requireText(actor, 'Die ausführende Person', 1, 64);
        const target = String(discordId ?? '').trim();
        if (!/^\d{17,20}$/.test(target)) {
            throw new StoreError('Ungültige Discord-ID des Empfängers.');
        }
        const at = parseDate(now, 'Der Versandzeitpunkt');

        return transaction(() => {
            const invoice = requireInvoice(number);
            const isRetry = invoice.status === 'sent' && invoice.delivery === 'failed';

            if (invoice.status !== 'draft' && !isRetry) {
                if (invoice.status === 'paid') throw new StoreError('Die Rechnung ist bereits bezahlt.');
                if (invoice.status === 'void') throw new StoreError('Die Rechnung ist storniert.');
                throw new StoreError(
                    'Ein erneuter Versand ist nur nach eindeutig fehlgeschlagener Zustellung möglich.'
                );
            }

            const iso = at.toISOString();

            if (invoice.status === 'draft') {
                const due = new Date(at.getTime() + rules.paymentDays * DAY_MS).toISOString();
                st.firstSend.run(target, iso, iso, due, invoice.id);
            } else {
                st.retrySend.run(target, iso, invoice.id);
            }

            writeAudit(who, 'invoice_send_attempt', invoice.number, {
                retry: isRetry,
                discordId: target,
            });

            return loadInvoice(st.byNumber.get(invoice.number));
        });
    }

    function recordDeliveryResult({ number, delivery, actor }) {
        const who = requireText(actor, 'Die ausführende Person', 1, 64);
        if (!DELIVERY_RESULTS.includes(delivery)) {
            throw new StoreError('Ungültiger Zustellstatus.');
        }

        return transaction(() => {
            const invoice = requireInvoice(number);
            if (invoice.status !== 'sent' || invoice.delivery !== 'pending') {
                throw new StoreError('Für diese Rechnung gibt es keinen offenen Versandversuch.');
            }

            st.setDelivery.run(delivery, invoice.id);
            writeAudit(who, 'invoice_delivery_result', invoice.number, { delivery });

            return loadInvoice(st.byNumber.get(invoice.number));
        });
    }

    /** Öffentlicher Hinweis im Fahrer-Chat: nur nach fehlgeschlagener DM und nur einmal. */
    function recordFallbackAttempt({ number, channelId, actor }) {
        const who = requireText(actor, 'Die ausführende Person', 1, 64);
        const channel = requireText(channelId, 'Die Kanal-ID', 1, 32);

        return transaction(() => {
            const invoice = requireInvoice(number);
            if (invoice.status !== 'sent' || invoice.delivery !== 'failed') {
                throw new StoreError('Ein öffentlicher Hinweis ist nur nach eindeutig fehlgeschlagener DM erlaubt.');
            }
            if (invoice.fallback_status) {
                throw new StoreError('Für diese Rechnung gab es schon einen öffentlichen Hinweis. Ein erneuter Post ist gesperrt.');
            }

            st.fallbackAttempt.run(channel, new Date().toISOString(), invoice.id);
            writeAudit(who, 'invoice_fallback_attempt', invoice.number, { channelId: channel });

            return loadInvoice(st.byNumber.get(invoice.number));
        });
    }

    function recordFallbackResult({ number, status, messageId = null, actor }) {
        const who = requireText(actor, 'Die ausführende Person', 1, 64);
        if (!['sent', 'unknown'].includes(status)) {
            throw new StoreError('Das Ergebnis muss "sent" oder "unknown" sein.');
        }

        return transaction(() => {
            const invoice = requireInvoice(number);
            if (invoice.fallback_status !== 'pending') {
                throw new StoreError('Es gibt keinen offenen öffentlichen Hinweis.');
            }

            st.fallbackResult.run(status, messageId === null ? null : String(messageId), invoice.id);
            writeAudit(who, 'invoice_fallback_result', invoice.number, { status, messageId });

            return loadInvoice(st.byNumber.get(invoice.number));
        });
    }

    /** Versendete, unbezahlte Rechnungen mit abgelaufener Frist, die noch keine Erinnerung bekamen. */
    function listDueForReminder(now = new Date()) {
        const at = parseDate(now, 'Der Zeitpunkt');
        return plainAll(st.dueForReminder.all(at.toISOString()));
    }

    /** Genau eine Erinnerung pro Rechnung, mit dem Ergebnis der Zustellung. */
    function recordReminder({ number, delivery, actor, now = new Date() }) {
        const who = requireText(actor, 'Die ausführende Person', 1, 64);
        const at = parseDate(now, 'Der Zeitpunkt');
        if (!DELIVERY_RESULTS.includes(delivery)) {
            throw new StoreError('Ungültiger Zustellstatus.');
        }

        return transaction(() => {
            const invoice = requireInvoice(number);
            if (invoice.status !== 'sent') {
                throw new StoreError('Nur versendete, unbezahlte Rechnungen können erinnert werden.');
            }
            if (!invoice.due_at || at.getTime() <= new Date(invoice.due_at).getTime()) {
                throw new StoreError('Die Zahlungsfrist ist noch nicht abgelaufen.');
            }
            if (invoice.reminder_at) {
                throw new StoreError('Die Erinnerung wurde bereits versendet.');
            }

            st.reminder.run(at.toISOString(), delivery, invoice.id);
            writeAudit(who, 'invoice_reminder', invoice.number, { delivery });

            return loadInvoice(st.byNumber.get(invoice.number));
        });
    }

    /** Zahlungseingang. Wer das darf, entscheidet die aufrufende Schicht (Rollenprüfung). */
    function markPaid({ number, actor, now = new Date() }) {
        const who = requireText(actor, 'Die ausführende Person', 1, 64);
        const at = parseDate(now, 'Der Zeitpunkt');

        return transaction(() => {
            const invoice = requireInvoice(number);

            if (invoice.status === 'paid') {
                return { updated: false, invoice: loadInvoice(invoice) };
            }
            if (invoice.status !== 'sent') {
                throw new StoreError('Nur versendete Rechnungen können als bezahlt markiert werden.');
            }

            st.pay.run(at.toISOString(), who, invoice.id);
            writeAudit(who, 'invoice_paid', invoice.number, { totalEur: invoice.total_eur });

            return { updated: true, invoice: loadInvoice(st.byNumber.get(invoice.number)) };
        });
    }

    /** Storno gibt die Aufträge wieder frei, damit eine neue Rechnung entstehen kann. */
    function voidInvoice({ number, reason, actor, now = new Date() }) {
        const who = requireText(actor, 'Die ausführende Person', 1, 64);
        const why = requireText(reason, 'Die Begründung', 3, 500);
        const at = parseDate(now, 'Der Zeitpunkt');

        return transaction(() => {
            const invoice = requireInvoice(number);
            if (invoice.status === 'paid') {
                throw new StoreError('Eine bezahlte Rechnung kann nicht storniert werden.');
            }
            if (invoice.status === 'void') {
                throw new StoreError('Die Rechnung ist bereits storniert.');
            }

            st.voidInvoice.run(at.toISOString(), who, why, invoice.id);
            st.deactivateLines.run(invoice.id);
            writeAudit(who, 'invoice_voided', invoice.number, {
                reason: why,
                previousStatus: invoice.status,
                totalEur: invoice.total_eur,
            });

            return loadInvoice(st.byNumber.get(invoice.number));
        });
    }

    return {
        createDraft,
        createDraftsForMonth,
        getInvoice,
        listInvoices,
        recordSendAttempt,
        recordDeliveryResult,
        recordFallbackAttempt,
        recordFallbackResult,
        listDueForReminder,
        recordReminder,
        markPaid,
        voidInvoice,
    };
}

module.exports = { createInvoiceApi };
