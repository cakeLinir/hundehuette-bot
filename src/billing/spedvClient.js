'use strict';

const axios = require('axios');

const DEFAULT_BASE_URL = 'https://api.sped-v.de';
// Telemetrie großer Aufträge (bis ca. 12.000 Punkte) braucht mehrere Sekunden
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000];

function isRetryable(status) {
    // Kein HTTP-Status = Netzwerkfehler oder Timeout
    if (status === undefined || status === null) return true;
    return status === 429 || status >= 500;
}

function toIsoDate(value, label) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new TypeError(`Ungültiger Zeitwert für ${label}.`);
    }
    return date.toISOString();
}

function requireTaskId(value) {
    const id = String(value ?? '').trim();
    if (!/^\d+$/.test(id)) {
        throw new TypeError('Ungültige SpedV-Auftrags-ID.');
    }
    return id;
}

function createSpedvClient(options = {}) {
    const http = options.httpClient || axios;
    const apiKey = options.apiKey || process.env.SPEDV_API_KEY;
    const baseUrl = String(options.baseUrl || process.env.SPEDV_API_URL || DEFAULT_BASE_URL)
        .replace(/\/+$/, '');
    const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
    const retryDelaysMs = Array.isArray(options.retryDelaysMs)
        ? options.retryDelaysMs
        : DEFAULT_RETRY_DELAYS_MS;
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

    if (!apiKey || !String(apiKey).trim()) {
        throw new Error('SPEDV_API_KEY fehlt. SpedV-Zugriff abgebrochen.');
    }

    async function get(path, params) {
        let reason = 'Netzwerkfehler';

        for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
            try {
                const response = await http.get(`${baseUrl}${path}`, {
                    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
                    timeout,
                    ...(params ? { params } : {}),
                });
                return response.data;
            } catch (error) {
                // Schlüssel und vollständige Request-Konfiguration niemals protokollieren.
                const status = error.response?.status;
                reason = status ? `HTTP ${status}` : (error.code || 'Netzwerkfehler');

                if (!isRetryable(status) || attempt === retryDelaysMs.length) break;
                await sleep(retryDelaysMs[attempt]);
            }
        }

        throw new Error(`SpedV-Abfrage fehlgeschlagen (${reason}).`);
    }

    /** Auftragsliste. Ohne Parameter vollständig (per Messung belegt). */
    async function fetchTasks(query = {}) {
        const params = {};
        if (query.start !== undefined && query.start !== null) {
            params.start = toIsoDate(query.start, 'start');
        }
        if (query.end !== undefined && query.end !== null) {
            params.end = toIsoDate(query.end, 'end');
        }

        const data = await get('/v1/tasks', Object.keys(params).length ? params : undefined);

        if (!Array.isArray(data)) {
            throw new Error('SpedV: /tasks lieferte kein direktes Array.');
        }

        const seen = new Set();
        for (const task of data) {
            if (!task || task.id === undefined || task.id === null) {
                throw new Error('SpedV: Auftragsliste enthält einen Auftrag ohne ID.');
            }
            const id = String(task.id);
            if (seen.has(id)) {
                throw new Error(`SpedV: Doppelte Auftrags-ID ${id} in der Antwort.`);
            }
            seen.add(id);
        }

        return data;
    }

    async function fetchTaskDetails(taskId) {
        const id = requireTaskId(taskId);
        const data = await get(`/v1/tasks/${encodeURIComponent(id)}/details`);

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error(`SpedV: Ungültige Detailantwort für Auftrag ${id}.`);
        }
        return data;
    }

    async function fetchDriveData(taskId) {
        const id = requireTaskId(taskId);
        const data = await get(`/v1/tasks/${encodeURIComponent(id)}/drivedata`);

        if (!Array.isArray(data)) {
            throw new Error(`SpedV: Telemetrie für Auftrag ${id} ist kein Array.`);
        }
        return data;
    }

    return { fetchTasks, fetchTaskDetails, fetchDriveData };
}

module.exports = { createSpedvClient };
