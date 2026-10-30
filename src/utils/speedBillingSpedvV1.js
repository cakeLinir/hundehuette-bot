
'use strict';

const axios = require('axios');

const DEFAULT_BASE_URL = 'https://api.sped-v.de';
const DEFAULT_TIMEOUT_MS = 30_000;

function createSpedvV1Client(options = {}) {
    const http = options.httpClient || axios;
    const apiKey = options.apiKey || process.env.SPEDV_API_KEY;
    const baseUrl = String(options.baseUrl || process.env.SPEDV_API_URL || DEFAULT_BASE_URL)
        .replace(/\/+$/, '');
    const timeout = options.timeout || DEFAULT_TIMEOUT_MS;

    if (!apiKey || !String(apiKey).trim()) {
        throw new Error('SPEDV_API_KEY fehlt. SpedV-v1-Zugriff abgebrochen.');
    }

    async function get(path) {
        try {
            const response = await http.get(`${baseUrl}${path}`, {
                headers: {
                    'X-Api-Key': apiKey,
                    Accept: 'application/json',
                },
                timeout,
            });

            return response.data;
        } catch (error) {
            // API-Key und vollständige Request-Konfiguration niemals protokollieren.
            const status = error.response?.status;
            const code = error.code;
            const reason = status ? `HTTP ${status}` : (code || 'Netzwerkfehler');

            throw new Error(`SpedV-v1-Abfrage fehlgeschlagen (${reason}).`);
        }
    }

    async function fetchTasks() {
        const data = await get('/v1/tasks');

        if (!Array.isArray(data)) {
            throw new Error('SpedV-v1: /tasks lieferte kein direktes Array.');
        }

        const seen = new Set();

        for (const task of data) {
            if (!task || task.id === undefined || task.id === null) {
                throw new Error('SpedV-v1: Aufgabenliste enthält einen Auftrag ohne ID.');
            }

            const id = String(task.id);

            if (seen.has(id)) {
                throw new Error(`SpedV-v1: Doppelte Auftrags-ID ${id} in der Antwort.`);
            }

            seen.add(id);
        }

        return data;
    }

    async function fetchTaskDetails(taskId) {
        const id = requireTaskId(taskId);
        const data = await get(`/v1/tasks/${encodeURIComponent(id)}/details`);

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error(`SpedV-v1: Ungültige Detailantwort für Auftrag ${id}.`);
        }

        return data;
    }

    async function fetchDriveData(taskId) {
        const id = requireTaskId(taskId);
        const data = await get(`/v1/tasks/${encodeURIComponent(id)}/drivedata`);

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error(`SpedV-v1: Ungültige Telemetrieantwort für Auftrag ${id}.`);
        }

        for (const field of ['velocity', 'timestamp']) {
            if (!Array.isArray(data[field])) {
                throw new Error(`SpedV-v1: Telemetriefeld ${field} fehlt für Auftrag ${id}.`);
            }
        }

        if (data.velocity.length !== data.timestamp.length) {
            throw new Error(`SpedV-v1: Telemetriearrays sind unvollständig für Auftrag ${id}.`);
        }

        return data;
    }

    return {
        fetchTasks,
        fetchTaskDetails,
        fetchDriveData,
    };
}

function requireTaskId(value) {
    const id = String(value ?? '').trim();

    if (!id || !/^\d+$/.test(id)) {
        throw new TypeError('Ungültige SpedV-Auftrags-ID.');
    }

    return id;
}

module.exports = {
    createSpedvV1Client,
};
