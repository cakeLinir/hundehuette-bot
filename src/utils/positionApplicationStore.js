
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const writeFileAtomic = require('write-file-atomic');

const dataDir = path.join(__dirname, '..', '..', 'data');
const dataPath = path.join(dataDir, 'positionApplications.json');

const ACTIVE_STATUSES = new Set(['pending', 'reviewing']);
const VALID_STATUSES = new Set([
    'pending',
    'reviewing',
    'accepted',
    'rejected',
    'withdrawn',
]);

function ensureStore() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(dataPath)) {
        writeFileAtomic.sync(
            dataPath,
            JSON.stringify({ version: 1, guilds: {} }, null, 2),
        );
    }
}

function readStore() {
    ensureStore();

    let data;

    try {
        data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    } catch (error) {
        // Nicht automatisch überschreiben: Eine beschädigte Datei
        // könnte noch wichtige Bewerbungen enthalten.
        throw new Error(
            `Bewerbungsdatei kann nicht gelesen werden: ${error.message}`,
        );
    }

    if (
        !data ||
        typeof data !== 'object' ||
        !data.guilds ||
        typeof data.guilds !== 'object'
    ) {
        throw new Error(
            'Ungültige Struktur in data/positionApplications.json.',
        );
    }

    return data;
}

function writeStore(data) {
    writeFileAtomic.sync(dataPath, JSON.stringify(data, null, 2));
}

function getGuildApplications(data, guildId) {
    if (!data.guilds[guildId]) {
        data.guilds[guildId] = {};
    }

    return data.guilds[guildId];
}

/**
 * Gibt alle Bewerbungen eines Servers zurück.
 */
function listApplications(guildId) {
    const data = readStore();
    const applications = getGuildApplications(data, guildId);

    return Object.values(applications);
}

/**
 * Findet eine Bewerbung anhand ihrer ID.
 */
function getApplication(guildId, applicationId) {
    const data = readStore();
    const applications = getGuildApplications(data, guildId);

    return applications[applicationId] ?? null;
}

/**
 * Erstellt eine Bewerbung.
 * Pro Person darf es höchstens eine aktive Bewerbung pro Server geben.
 */
function createApplication(guildId, input) {
    if (!guildId || !input?.applicantId || !input?.positionKey) {
        throw new Error(
            'Für eine Bewerbung fehlen Server-ID, Bewerber-ID oder Funktionsstelle.',
        );
    }

    const data = readStore();
    const applications = getGuildApplications(data, guildId);

    const existing = Object.values(applications).find(application =>
        application.applicantId === input.applicantId &&
        ACTIVE_STATUSES.has(application.status)
    );

    if (existing) {
        return {
            created: false,
            reason: 'active_application_exists',
            application: existing,
        };
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const application = {
        id,
        guildId,
        applicantId: input.applicantId,
        positionKey: input.positionKey,
        answers: input.answers ?? {},
        status: 'pending',
        reviewerId: null,
        reviewNote: null,
        createdAt: now,
        updatedAt: now,
        decidedAt: null,
    };

    applications[id] = application;
    writeStore(data);

    return {
        created: true,
        application,
    };
}

/**
 * Ändert den Status einer Bewerbung.
 * Die Berechtigungsprüfung muss vor dem Aufruf durch den Handler erfolgen.
 */
function updateApplication(guildId, applicationId, changes) {
    const data = readStore();
    const applications = getGuildApplications(data, guildId);
    const application = applications[applicationId];

    if (!application) {
        return {
            updated: false,
            reason: 'not_found',
        };
    }

    if (changes.status && !VALID_STATUSES.has(changes.status)) {
        throw new Error(`Ungültiger Bewerbungsstatus: ${changes.status}`);
    }

    if (!ACTIVE_STATUSES.has(application.status)) {
        return {
            updated: false,
            reason: 'already_closed',
            application,
        };
    }

    if (changes.status) {
        application.status = changes.status;
    }

    if (changes.reviewerId !== undefined) {
        application.reviewerId = changes.reviewerId;
    }

    if (changes.reviewNote !== undefined) {
        application.reviewNote = changes.reviewNote;
    }

    application.updatedAt = new Date().toISOString();

    if (
        ['accepted', 'rejected', 'withdrawn'].includes(application.status)
    ) {
        application.decidedAt = application.updatedAt;
    }

    writeStore(data);

    return {
        updated: true,
        application,
    };
}

module.exports = {
    ACTIVE_STATUSES,
    listApplications,
    getApplication,
    createApplication,
    updateApplication,
};
