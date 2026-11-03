'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpedvClient } = require('../src/billing/spedvClient');

const API_KEY = 'test-key-nicht-echt';

function httpSequence(steps) {
    const calls = [];
    return {
        calls,
        async get(url, config) {
            calls.push({ url, config });
            const step = steps[Math.min(calls.length - 1, steps.length - 1)];
            if (step.data !== undefined) return { data: step.data };

            const error = new Error('simulierter Fehler');
            if (step.status) error.response = { status: step.status };
            if (step.code) error.code = step.code;
            throw error;
        },
    };
}

function clientWith(steps) {
    const http = httpSequence(steps);
    const client = createSpedvClient({
        apiKey: API_KEY,
        httpClient: http,
        retryDelaysMs: [0, 0],
        sleep: async () => { },
    });
    return { client, http };
}

test('500 wird wiederholt, der zweite Versuch gelingt', async () => {
    const { client, http } = clientWith([{ status: 500 }, { data: [{ id: 1 }] }]);
    assert.deepEqual(await client.fetchTasks(), [{ id: 1 }]);
    assert.equal(http.calls.length, 2);
});

test('401 wird nicht wiederholt und enthält nie den Schlüssel', async () => {
    const { client, http } = clientWith([{ status: 401 }]);
    await assert.rejects(
        () => client.fetchTasks(),
        error => /HTTP 401/.test(error.message) && !error.message.includes(API_KEY)
    );
    assert.equal(http.calls.length, 1);
});

test('Netzwerkfehler: drei Versuche, dann Fehler', async () => {
    const { client, http } = clientWith([{ code: 'ECONNRESET' }]);
    await assert.rejects(() => client.fetchTasks(), /ECONNRESET/);
    assert.equal(http.calls.length, 3);
});

test('Schlüssel steht im Header, start/end sind optional', async () => {
    let setup = clientWith([{ data: [] }]);
    await setup.client.fetchTasks({ start: '2026-11-01T00:00:00Z', end: '2026-12-01T00:00:00Z' });
    assert.equal(setup.http.calls[0].config.headers['X-Api-Key'], API_KEY);
    assert.equal(setup.http.calls[0].config.params.start, '2026-11-01T00:00:00.000Z');

    setup = clientWith([{ data: [] }]);
    await setup.client.fetchTasks();
    assert.equal(setup.http.calls[0].config.params, undefined);
});

test('Doppelte Auftrags-ID in der Liste wird abgelehnt', async () => {
    const { client } = clientWith([{ data: [{ id: 5 }, { id: 5 }] }]);
    await assert.rejects(() => client.fetchTasks(), /Doppelte Auftrags-ID/);
});

test('Telemetrie muss ein Array sein, Details ein Objekt', async () => {
    let setup = clientWith([{ data: { nicht: 'array' } }]);
    await assert.rejects(() => setup.client.fetchDriveData(1), /kein Array/);

    setup = clientWith([{ data: [] }]);
    await assert.rejects(() => setup.client.fetchTaskDetails(1), /Ungültige Detailantwort/);
});

test('Ungültige Auftrags-ID wird abgelehnt', async () => {
    const { client } = clientWith([{ data: [] }]);
    await assert.rejects(() => client.fetchTaskDetails('1; drop'), TypeError);
});
