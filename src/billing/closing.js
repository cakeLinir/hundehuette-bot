'use strict';

const rules = require('./rules');
const { berlinMonth, isMonthClosed } = require('./time');
const { isBillableState, stateName, formatVisibleId } = require('./evaluate');

// 0 = InDrive, 1 = Done, 5 = Paused: noch nicht abgerechnet
const PENDING_STATES = Object.freeze([0, ...rules.openStates]);
// 4 = AdminCheck: wird abgerechnet, der Status kann sich aber noch ändern
const PROVISIONAL_STATES = Object.freeze([4]);

const SEVERITY = { ok: 0, warn: 1, fail: 2 };

function startMonthOf(task) {
    const date = new Date(task?.startTime);
    return Number.isFinite(date.getTime()) ? berlinMonth(date) : null;
}

/**
 * Laufende Abrechnung eines Monats: je Fahrer die aktuellen Zahlen.
 * Verändert nichts und darf jederzeit aufgerufen werden.
 */
function buildStatement({ store, month }) {
    const activeInvoices = new Map(
        store.listInvoices({ month })
            .filter(invoice => invoice.status !== 'void')
            .map(invoice => [invoice.spedv_user_id, invoice])
    );

    const globalReviews = store.listOpenReviews({ month })
        .filter(review => review.billing_month === null)
        .map(review => ({
            taskId: review.task_id,
            visibleId: review.visible_id,
            reason: review.reason,
            message: review.message,
        }));

    const drivers = store.summarizeMonth(month).map(row => {
        const invoice = row.spedv_user_id === null ? null : activeInvoices.get(row.spedv_user_id);

        return {
            spedvUserId: row.spedv_user_id,
            spedvName: row.spedv_name ?? 'unbekannt',
            tasks: row.tasks,
            fines: row.fines,
            fineEur: row.fine_eur,
            clears: row.clears,
            waived: row.waived,
            dismissed: row.dismissed,
            openReviews: row.open_reviews,
            invoice: invoice
                ? { number: invoice.number, status: invoice.status, totalEur: invoice.total_eur }
                : null,
        };
    });

    return {
        month,
        drivers,
        globalReviews,
        totals: {
            drivers: drivers.length,
            driversWithFines: drivers.filter(driver => driver.fineEur > 0).length,
            fines: drivers.reduce((sum, driver) => sum + driver.fines, 0),
            fineEur: drivers.reduce((sum, driver) => sum + driver.fineEur, 0),
            openReviews: drivers.reduce((sum, driver) => sum + driver.openReviews, 0) + globalReviews.length,
            invoicedEur: drivers.reduce((sum, driver) => sum + (driver.invoice?.totalEur ?? 0), 0),
        },
    };
}

/**
 * Generalprüfung eines Monats. Verändert nichts.
 *
 * @param {object} options
 * @param {object} options.store         Speicher
 * @param {Array}  options.listedTasks   Aktuelle Auftragsliste aus SpedV (GET /v1/tasks)
 * @param {Iterable<string>} options.linkedUserIds SpedV-IDs der Fahrer mit verifizierter Discord-Verknüpfung
 * @param {string} options.month         YYYY-MM
 * @param {Date}   [options.now]
 */
function runClosingCheck({ store, listedTasks, linkedUserIds = [], month, now = new Date() }) {
    const billingStartMonth = rules.billingStartDate.slice(0, 7);
    const linked = new Set([...linkedUserIds].map(String));
    const byId = new Map(listedTasks.map(task => [String(task.id), task]));
    const statement = buildStatement({ store, month });
    const items = [];

    const add = (id, label, status, detail, data = []) =>
        items.push({ id, label, status, detail, data });

    const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

    // 1. Monat abgeschlossen
    const closed = isMonthClosed(month, now);
    add(
        'month_closed',
        'Monat abgeschlossen',
        closed ? 'ok' : 'fail',
        closed ? 'Der Monat ist abgeschlossen.' : 'Der Monat läuft noch. Rechnungen sind erst danach möglich.'
    );

    // 2. Vollständigkeit: jeder in diesem Monat gestartete, abrechenbare Auftrag muss ausgewertet sein
    const notEvaluated = listedTasks
        .filter(task =>
            isBillableState(task.state) &&
            startMonthOf(task) === month &&
            store.getEffective(String(task.id)) === null
        )
        .map(task => ({ taskId: String(task.id), visibleId: formatVisibleId(task.id), userId: String(task.userID ?? '') }));

    add(
        'not_evaluated',
        'Alle Aufträge ausgewertet',
        notEvaluated.length ? 'fail' : 'ok',
        notEvaluated.length
            ? `${plural(notEvaluated.length, 'Auftrag ist', 'Aufträge sind')} noch nicht ausgewertet. Der nächste Lauf holt sie nach.`
            : 'Alle Aufträge des Monats sind ausgewertet.',
        notEvaluated
    );

    // 3. Noch nicht abgerechnete Aufträge, die in diesen Monat fallen könnten
    const pending = listedTasks
        .filter(task => {
            if (!PENDING_STATES.includes(Number(task.state))) return false;
            const started = startMonthOf(task) ?? month;
            return started >= billingStartMonth && started <= month;
        })
        .map(task => ({
            taskId: String(task.id),
            visibleId: formatVisibleId(task.id),
            userId: String(task.userID ?? ''),
            state: stateName(task.state),
        }));

    add(
        'pending_tasks',
        'Keine offenen Aufträge',
        pending.length ? 'warn' : 'ok',
        pending.length
            ? `${plural(pending.length, 'Auftrag ist', 'Aufträge sind')} noch unterwegs, geliefert oder pausiert und nicht abgerechnet. Sie könnten noch in diesen Monat fallen.`
            : 'Es gibt keine offenen Aufträge.',
        pending
    );

    // 4. Strafaufträge: Status und Vorläufigkeit
    const fineTasks = [];
    for (const driver of statement.drivers) {
        if (driver.spedvUserId === null || driver.fineEur <= 0) continue;
        for (const fine of store.listFines({ month, spedvUserId: driver.spedvUserId })) {
            fineTasks.push({ fine, driver });
        }
    }

    const staleUsers = new Set();
    const stale = [];
    const provisional = [];

    for (const { fine, driver } of fineTasks) {
        const current = byId.get(fine.task_id);

        if (!current || !isBillableState(current.state)) {
            staleUsers.add(driver.spedvUserId);
            stale.push({
                taskId: fine.task_id,
                visibleId: fine.visible_id,
                spedvName: driver.spedvName,
                state: current ? stateName(current.state) : 'nicht mehr vorhanden',
            });
        } else if (PROVISIONAL_STATES.includes(Number(current.state))) {
            provisional.push({
                taskId: fine.task_id,
                visibleId: fine.visible_id,
                spedvName: driver.spedvName,
                state: stateName(current.state),
            });
        }
    }

    add(
        'provisional_tasks',
        'Keine vorläufigen Strafaufträge',
        provisional.length ? 'warn' : 'ok',
        provisional.length
            ? `${plural(provisional.length, 'Strafauftrag ist', 'Strafaufträge sind')} noch in der Tourprüfung (AdminCheck). Der Status kann sich ändern.`
            : 'Alle Strafaufträge sind endgültig abgerechnet.',
        provisional
    );

    add(
        'state_changed',
        'Status der Strafaufträge unverändert',
        stale.length ? 'fail' : 'ok',
        stale.length
            ? `${plural(stale.length, 'Strafauftrag ist', 'Strafaufträge sind')} in SpedV nicht mehr abrechenbar. Der nächste Lauf macht daraus einen Prüffall.`
            : 'Alle Strafaufträge sind in SpedV weiterhin abrechenbar.',
        stale
    );

    // 5. Offene Prüffälle
    const openReviews = store.listOpenReviews({ month }).map(review => ({
        taskId: review.task_id,
        visibleId: review.visible_id,
        spedvUserId: review.spedv_user_id,
        spedvName: review.spedv_name,
        reason: review.reason,
        message: review.message,
        global: review.billing_month === null,
    }));

    const blockedUsers = new Set(
        openReviews.filter(review => !review.global && review.spedvUserId).map(review => review.spedvUserId)
    );
    const hasGlobalReview = openReviews.some(review => review.global);

    add(
        'open_reviews',
        'Keine offenen Prüffälle',
        openReviews.length ? 'fail' : 'ok',
        openReviews.length
            ? `${plural(openReviews.length, 'Prüffall ist', 'Prüffälle sind')} offen${hasGlobalReview ? ', mindestens einer blockiert alle Rechnungen' : ''}.`
            : 'Es gibt keine offenen Prüffälle.',
        openReviews
    );

    // 6. Verknüpfung: ohne Discord-Konto ist kein Versand möglich
    const unlinked = statement.drivers
        .filter(driver => driver.fineEur > 0 && !linked.has(String(driver.spedvUserId)))
        .map(driver => ({ spedvUserId: driver.spedvUserId, spedvName: driver.spedvName, fineEur: driver.fineEur }));

    add(
        'unlinked_drivers',
        'Fahrer mit Strafe sind verknüpft',
        unlinked.length ? 'fail' : 'ok',
        unlinked.length
            ? `${plural(unlinked.length, 'Fahrer ist', 'Fahrer sind')} nicht mit Discord verknüpft. Eine Rechnung kann nicht zugestellt werden.`
            : 'Alle Fahrer mit Strafe sind mit Discord verknüpft.',
        unlinked
    );
    const unlinkedUsers = new Set(unlinked.map(driver => String(driver.spedvUserId)));

    // 7. Rechnungen: Summen und Nachzügler
    const brokenInvoices = [];
    const lateFines = [];

    for (const driver of statement.drivers) {
        if (!driver.invoice) continue;

        const invoice = store.getInvoice(driver.invoice.number);
        const lineSum = invoice.lines.reduce((sum, line) => sum + line.fine_eur, 0);

        if (lineSum !== invoice.total_eur) {
            brokenInvoices.push({
                number: invoice.number,
                totalEur: invoice.total_eur,
                lineSumEur: lineSum,
            });
        }

        const inInvoice = new Set(invoice.lines.map(line => line.task_id));
        for (const fine of store.listFines({ month, spedvUserId: driver.spedvUserId })) {
            if (!inInvoice.has(fine.task_id)) {
                lateFines.push({
                    number: invoice.number,
                    taskId: fine.task_id,
                    visibleId: fine.visible_id,
                    spedvName: driver.spedvName,
                });
            }
        }
    }

    add(
        'invoice_totals',
        'Rechnungssummen stimmen',
        brokenInvoices.length ? 'fail' : 'ok',
        brokenInvoices.length
            ? `${plural(brokenInvoices.length, 'Rechnung weicht', 'Rechnungen weichen')} von der Summe ihrer Zeilen ab.`
            : 'Alle Rechnungssummen stimmen mit den Zeilen überein.',
        brokenInvoices
    );

    add(
        'late_fines',
        'Keine Nachzügler',
        lateFines.length ? 'warn' : 'ok',
        lateFines.length
            ? `${plural(lateFines.length, 'Strafauftrag kam', 'Strafaufträge kamen')} nach dem Rechnungsentwurf dazu.`
            : 'Es gibt keine Nachzügler.',
        lateFines
    );

    // 8. Entwürfe
    const draftsMissing = statement.drivers
        .filter(driver => driver.fineEur > 0 && !driver.invoice)
        .map(driver => ({ spedvUserId: driver.spedvUserId, spedvName: driver.spedvName, fineEur: driver.fineEur }));

    add(
        'drafts_missing',
        'Entwürfe vorhanden',
        draftsMissing.length ? 'warn' : 'ok',
        draftsMissing.length
            ? `Für ${plural(draftsMissing.length, 'Fahrer', 'Fahrer')} gibt es noch keinen Entwurf.`
            : 'Für alle Fahrer mit Strafe gibt es einen Entwurf.',
        draftsMissing
    );

    // Versandbereit: Monat zu, Strafe vorhanden, nichts blockiert, verknüpft, Status in Ordnung
    const readyDrivers = closed && !hasGlobalReview
        ? statement.drivers
            .filter(driver =>
                driver.fineEur > 0 &&
                driver.spedvUserId !== null &&
                !blockedUsers.has(driver.spedvUserId) &&
                !unlinkedUsers.has(String(driver.spedvUserId)) &&
                !staleUsers.has(driver.spedvUserId)
            )
            .map(driver => ({
                spedvUserId: driver.spedvUserId,
                spedvName: driver.spedvName,
                fineEur: driver.fineEur,
                invoiceNumber: driver.invoice?.number ?? null,
                invoiceStatus: driver.invoice?.status ?? null,
            }))
        : [];

    const status = items.reduce(
        (worst, item) => (SEVERITY[item.status] > SEVERITY[worst] ? item.status : worst),
        'ok'
    );

    return {
        month,
        checkedAt: now.toISOString(),
        status,
        passed: status !== 'fail',
        items,
        readyDrivers,
        statement,
    };
}

module.exports = { buildStatement, runClosingCheck };
