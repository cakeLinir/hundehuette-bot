// sessions.js — In-Memory Sessions mit TTL (Standard: 30 Minuten)
const SESSION_TTL_MS = 30 * 60 * 1000;
const store = new Map(); // key: `${userId}:${type}` → { data, timer }

function setSession(userId, type, partial = {}, ttl = SESSION_TTL_MS) {
  const key = `${userId}:${type}`;
  const existing = store.get(key);

  if (existing?.timer) clearTimeout(existing.timer);

  const data = { ...(existing?.data ?? {}), ...partial };
  const timer = setTimeout(() => store.delete(key), ttl);
  timer.unref?.(); // blockiert kein Beenden des Prozesses

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
