'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const WORKER_COUNT = 8;
const JOBS_PER_WORKER = 10;
const TOTAL_JOBS = WORKER_COUNT * JOBS_PER_WORKER;

const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-speed-billing-locking-')
);

const storePath = path.join(tempDirectory, 'speedBilling.json');
const workerPath = path.join(__dirname, 'speedBillingLockWorker.js');

function startWorker(workerId) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                workerPath,
                String(workerId),
                String(JOBS_PER_WORKER),
            ],
            {
                cwd: path.resolve(__dirname, '..'),
                env: {
                    ...process.env,
                    HKC_BILLING_DATA_PATH: storePath,
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        );

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', chunk => {
            stdout += chunk;
        });

        child.stderr.on('data', chunk => {
            stderr += chunk;
        });

        child.on('error', reject);

        child.on('close', code => {
            if (code !== 0) {
                reject(new Error(
                    `Worker ${workerId} fehlgeschlagen. ` +
                    `Exit-Code: ${code}\n` +
                    `stdout: ${stdout}\n` +
                    `stderr: ${stderr}`
                ));
                return;
            }

            try {
                resolve(JSON.parse(stdout));
            } catch (error) {
                reject(new Error(
                    `Ungültige Ausgabe von Worker ${workerId}: ` +
                    `${stdout}\n${error.message}`
                ));
            }
        });
    });
}

async function run() {
    try {
        console.log('Starte Parallelzugriffstest.');
        console.log(`Worker: ${WORKER_COUNT}`);
        console.log(`Aufträge je Worker: ${JOBS_PER_WORKER}`);
        console.log(`Erwartete Aufträge: ${TOTAL_JOBS}`);
        console.log('Store: temporäres Testverzeichnis');

        const results = await Promise.all(
            Array.from(
                { length: WORKER_COUNT },
                (_, index) => startWorker(index + 1)
            )
        );

        assert.equal(results.length, WORKER_COUNT);

        for (const result of results) {
            assert.equal(result.createdCount, JOBS_PER_WORKER);
            assert.equal(result.failedCount, 0);
        }

        const rawStore = fs.readFileSync(storePath, 'utf8');
        const parsedStore = JSON.parse(rawStore);

        assert.equal(
            Object.keys(parsedStore.jobs).length,
            TOTAL_JOBS,
            'Nicht alle Aufträge wurden gespeichert.'
        );

        assert.equal(
            parsedStore.audit.length,
            TOTAL_JOBS,
            'Die Anzahl der Audit-Einträge stimmt nicht.'
        );

        const taskIds = Object.values(parsedStore.jobs)
            .map(job => job.taskId);

        assert.equal(
            new Set(taskIds).size,
            TOTAL_JOBS,
            'Es wurden doppelte Auftrags-IDs gespeichert.'
        );

        assert.equal(
            fs.existsSync(`${storePath}.lock`),
            false,
            'Nach dem Test darf keine Lock-Datei zurückbleiben.'
        );

        console.log('');
        console.log('ALLE PARALLELTESTS ERFOLGREICH.');
        console.log(`Worker erfolgreich: ${results.length}`);
        console.log(`Aufträge gespeichert: ${Object.keys(parsedStore.jobs).length}`);
        console.log(`Audit-Einträge: ${parsedStore.audit.length}`);
        console.log('JSON-Struktur: gültig');
        console.log('Doppelte Auftrags-IDs: keine');
        console.log('Lock-Datei: ordnungsgemäß freigegeben');
        console.log('Discord-Aktionen: keine');
    } finally {
        fs.rmSync(tempDirectory, {
            recursive: true,
            force: true,
        });
    }
}

run().catch(error => {
    console.error('PARALLELTEST FEHLGESCHLAGEN');
    console.error(error);
    process.exitCode = 1;
});
