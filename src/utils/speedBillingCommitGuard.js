'use strict';

/**
 * Verhindert einen Commit ohne tatsächliche Importoperationen.
 *
 * Diese Prüfung ist unabhängig von der Plan-ID:
 * Ein formal gültiger, aber leerer Plan darf nicht geschrieben werden.
 */
function assertCommitHasOperations(plan) {
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        throw new TypeError('Commit gesperrt: Importplan ist ungültig.');
    }

    if (!Array.isArray(plan.operations)) {
        throw new TypeError(
            'Commit gesperrt: Importplan enthält keine gültige Operationsliste.'
        );
    }

    if (plan.operations.length === 0) {
        throw new Error(
            'Commit gesperrt: Der Importplan enthält keine Operationen. Es gibt nichts zu importieren.'
        );
    }

    return true;
}

module.exports = {
    assertCommitHasOperations,
};