// sessions.js — mit automatischem TTL (Standard: 10 Minuten)
const SESSION_TTL_MS = 10 * 60 * 1000;
const store = new Map(); // key: `${userId}:${type}` → { data, timer }

function setSession(userId, type, partial) {
    const key = `${userId}:${type}`;
    const existing = store.get(key);

    // Alten Timer canceln
    if (existing?.timer) clearTimeout(existing.timer);

    const data = { ...(existing?.data ?? {}), ...partial };
    const timer = setTimeout(() => store.delete(key), SESSION_TTL_MS);

    store.set(key, { data, timer });
}

function getSession(userId, type) {
    return store.get(`${userId}:${type}`)?.data ?? {};
}

function deleteSession(userId, type) {
    const key = `${userId}:${type}`;
    const entry = store.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    store.delete(key);
}

module.exports = { setSession, getSession, deleteSession };
