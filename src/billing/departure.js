'use strict';

const { StoreError, plain, plainAll, requireText } = require('./db');

const DEPARTURE_REASON = 'Austritt aus der Spedition';

function requireUserId(value) {
    const id = String(value ?? '').trim();
    if (!/^\d+$/.test(id)) throw new StoreError('Ungültige SpedV-ID des Fahrers.');
    return id;
}

/**
 * Austritt eines Fahrers aus der Spedition.
 * Bezahlte Rechnungen bleiben unverändert. Offene Rechnungen werden storniert,
 * alle übrigen Strafen erlassen und offene Prüffälle geschlossen.
 */
function createDepartureApi({ db, transaction, writeAudit }) {
    const st = {
        openInvoices: db.prepare(`
            SELECT * FROM invoices
            WHERE spedv_user_id = ? AND status IN ('draft', 'sent')
            ORDER BY billing_month, number`),
        paidSummary: db.prepare(`
            SELECT COUNT(*) AS count, COALESCE(SUM(total_eur), 0) AS total_eur
            FROM invoices WHERE spedv_user_id = ? AND status = 'paid'`),
        voidInvoice: db.prepare(`
            UPDATE invoices SET status = 'void', void_at = ?, void_by = ?, void_reason = ? WHERE id = ?`),
        deactivateLines: db.prepare('UPDATE invoice_lines SET active = 0 WHERE invoice_id = ?'),
        // Strafen, die in keiner aktiven Rechnung stehen
        uninvoicedFines: db.prepare(`
            SELECT e.task_id, e.visible_id, e.billing_month, e.effective_fine_eur AS fine_eur,
                   e.decision_id, e.decision_kind
            FROM task_effective e
            WHERE e.spedv_user_id = ? AND e.effective_status = 'fine'
              AND NOT EXISTS (SELECT 1 FROM invoice_lines l WHERE l.task_id = e.task_id AND l.active = 1)
            ORDER BY e.billing_month, e.completed_at, e.task_id`),
        openReviews: db.prepare(`
            SELECT task_id, visible_id, billing_month FROM task_effective
            WHERE spedv_user_id = ? AND effective_status = 'open_review'
            ORDER BY billing_month, completed_at, task_id`),
        revokeDecision: db.prepare(`
            UPDATE decisions SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ?`),
        insertDecision: db.prepare(`
            INSERT INTO decisions (task_id, kind, speed_kmh, excess_kmh, fine_eur, reason, decided_by, decided_at)
            VALUES (?, ?, NULL, NULL, 0, ?, ?, ?)`),
    };

    /** Zeigt, was ein Austritt verändern würde. Verändert nichts. */
    function previewDeparture(spedvUserId) {
        const user = requireUserId(spedvUserId);
        const openInvoices = plainAll(st.openInvoices.all(user)).map(invoice => ({
            number: invoice.number,
            month: invoice.billing_month,
            status: invoice.status,
            totalEur: invoice.total_eur,
        }));
        const uninvoicedFines = plainAll(st.uninvoicedFines.all(user)).map(fine => ({
            taskId: fine.task_id,
            visibleId: fine.visible_id,
            month: fine.billing_month,
            fineEur: fine.fine_eur,
        }));
        const openReviews = plainAll(st.openReviews.all(user)).map(review => ({
            taskId: review.task_id,
            visibleId: review.visible_id,
            month: review.billing_month,
        }));
        const paid = plain(st.paidSummary.get(user));

        return {
            spedvUserId: user,
            openInvoices,
            uninvoicedFines,
            openReviews,
            paid: { count: Number(paid.count), totalEur: Number(paid.total_eur) },
            nothingToDo: openInvoices.length === 0 && uninvoicedFines.length === 0 && openReviews.length === 0,
        };
    }

    /** Führt den Austritt in einer einzigen Transaktion aus. Ein zweiter Aufruf ändert nichts. */
    function recordDeparture({ spedvUserId, actor, reason = DEPARTURE_REASON, now = new Date() }) {
        const user = requireUserId(spedvUserId);
        const who = requireText(actor, 'Die ausführende Person', 1, 64);
        const why = requireText(reason, 'Die Begründung', 3, 500);
        const at = now instanceof Date ? now : new Date(now);
        if (!Number.isFinite(at.getTime())) throw new StoreError('Der Zeitpunkt ist ungültig.');
        const iso = at.toISOString();

        return transaction(() => {
            // 1. Offene Rechnungen stornieren (gibt die Aufträge frei)
            const voided = [];
            for (const invoice of st.openInvoices.all(user)) {
                st.voidInvoice.run(iso, who, why, invoice.id);
                st.deactivateLines.run(invoice.id);
                writeAudit(who, 'invoice_voided', invoice.number, {
                    reason: why,
                    previousStatus: invoice.status,
                    totalEur: invoice.total_eur,
                    departure: true,
                });
                voided.push(invoice.number);
            }

            // 2. Alle Strafen außerhalb bezahlter Rechnungen erlassen
            const waived = [];
            for (const fine of st.uninvoicedFines.all(user)) {
                // Eine festgesetzte Strafe ist selbst eine Entscheidung: erst widerrufen
                if (fine.decision_kind === 'assess') {
                    st.revokeDecision.run(iso, who, why, fine.decision_id);
                    writeAudit(who, 'decision_revoked', fine.task_id, { kind: 'assess', reason: why, departure: true });
                }
                st.insertDecision.run(fine.task_id, 'waive', why, who, iso);
                writeAudit(who, 'decision_waive', fine.task_id, {
                    reason: why,
                    fineEur: 0,
                    previousFineEur: fine.fine_eur,
                    departure: true,
                });
                waived.push(fine.task_id);
            }

            // 3. Offene Prüffälle schließen, damit sie nichts mehr blockieren
            const dismissed = [];
            for (const review of st.openReviews.all(user)) {
                st.insertDecision.run(review.task_id, 'dismiss', why, who, iso);
                writeAudit(who, 'decision_dismiss', review.task_id, { reason: why, fineEur: 0, departure: true });
                dismissed.push(review.task_id);
            }

            writeAudit(who, 'driver_departed', user, { reason: why, voided, waived, dismissed });
            return { spedvUserId: user, voided, waived, dismissed };
        });
    }

    return { previewDeparture, recordDeparture };
}

module.exports = { createDepartureApi, DEPARTURE_REASON };
