'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const WORKER_COUNT = 12;

const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'hkc-speed-billing-init-race-')
);

const storePath = path.join(tempDirectory, 'speedBilling.json');

const workerCode = `
'use strict';

const store = require(
    require('node:path').resolve(
        process.cwd(),
        'src',
        'utils',
        'speedBillingStore.js'
    )
);

const jobs = store.listJobs();

if (!Array.isArray(jobs)) {
    throw new Error('listJobs() lieferte kein Array.');
}

process.stdout.write(JSON.stringify({
    success: true,
    jobs: jobs.length
}));
`;

function startWorker(workerId) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ['-e', workerCode],
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
                    `Initialisierungs-Worker ${workerId} fehlgeschlagen.\n` +
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
        assert.equal(
            fs.existsSync(storePath),
            false,
            'Der Store muss vor dem Test fehlen.'
        );

        console.log('Starte Erstinitialisierungstest.');
        console.log(`Parallele Prozesse: ${WORKER_COUNT}`);
        console.log('Store existiert vorher: nein');
        console.log('Store: temporäres Testverzeichnis');

        const results = await Promise.all(
            Array.from(
                { length: WORKER_COUNT },
                (_, index) => startWorker(index + 1)
            )
        );

        assert.equal(results.length, WORKER_COUNT);

        for (const result of results) {
            assert.equal(result.success, true);
            assert.equal(result.jobs, 0);
        }

        const rawStore = fs.readFileSync(storePath, 'utf8');
        const parsedStore = JSON.parse(rawStore);

        assert.equal(parsedStore.version, 1);
        assert.deepEqual(parsedStore.jobs, {});
        assert.deepEqual(parsedStore.invoices, {});
        assert.deepEqual(parsedStore.reviewCases, {});
        assert.deepEqual(parsedStore.audit, []);

        assert.equal(
            fs.existsSync(`${storePath}.lock`),
            false,
            'Nach Abschluss darf keine Lock-Datei zurückbleiben.'
        );

        console.log('');
        console.log('ERSTINITIALISIERUNG ERFOLGREICH.');
        console.log(`Erfolgreiche Prozesse: ${results.length}`);
        console.log('Initialisierter Store: gültig');
        console.log('JSON-Struktur: gültig');
        console.log('Lock-Datei: ordnungsgemäß entfernt');
    } finally {
        fs.rmSync(tempDirectory, {
            recursive: true,
            force: true,
        });
    }
}

run().catch(error => {
    console.error('ERSTINITIALISIERUNG FEHLGESCHLAGEN');
    console.error(error);
    process.exitCode = 1;
});