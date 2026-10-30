'use strict';

const assert = require('node:assert/strict');

const {
    assertCommitHasOperations,
} = require('../src/utils/speedBillingCommitGuard');

function run() {
    console.log('=== HKC Speed-Billing Commit-Guard Tests ===');

    // Fall 1: Leerer Plan muss gesperrt werden.
    assert.throws(
        () => assertCommitHasOperations({
            operations: [],
        }),
        /keine Operationen/
    );

    console.log('OK: Leerer Importplan wird gesperrt.');

    // Fall 2: Plan mit mindestens einer Operation darf passieren.
    assert.equal(
        assertCommitHasOperations({
            operations: [
                {
                    type: 'job',
                    taskId: 'test-1001',
                },
            ],
        }),
        true
    );

    console.log('OK: Importplan mit Operation wird akzeptiert.');

    // Fall 3: Fehlende Operationsliste muss gesperrt werden.
    assert.throws(
        () => assertCommitHasOperations({}),
        /Operationsliste/
    );

    console.log('OK: Fehlende Operationsliste wird gesperrt.');

    // Fall 4: Ungültiger Plan muss gesperrt werden.
    assert.throws(
        () => assertCommitHasOperations(null),
        /Importplan ist ungültig/
    );

    console.log('OK: Ungültiger Importplan wird gesperrt.');

    console.log('\nAlle Commit-Guard-Tests bestanden.');
}

try {
    run();
} catch (error) {
    console.error('\nCommit-Guard-Test fehlgeschlagen:');
    console.error(error.stack || error.message);
    process.exitCode = 1;
}