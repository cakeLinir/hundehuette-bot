// Universeller temporärer Session-Speicher
// Wird für Feedback und Ankündigungen verwendet
const sessions = new Map();

function setSession(userId, namespace, data) {
    const key     = `${namespace}_${userId}`;
    const current = sessions.get(key) ?? {};
    sessions.set(key, { ...current, ...data });
}

function getSession(userId, namespace) {
    return sessions.get(`${namespace}_${userId}`) ?? {};
}

function deleteSession(userId, namespace) {
    sessions.delete(`${namespace}_${userId}`);
}

module.exports = { setSession, getSession, deleteSession };
