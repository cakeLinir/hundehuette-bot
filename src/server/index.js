const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { handleStreamOnline, handleStreamOffline } = require('./twitchEvents');

const app = express();
app.disable('x-powered-by');

const MAX_AGE_MS = 10 * 60 * 1000; // Twitch: Nachrichten älter als 10 Minuten verwerfen
const seenMessages = new Map();    // messageId -> Zeitpunkt (Duplikat-Schutz)

setInterval(() => {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const [id, at] of seenMessages) if (at < cutoff) seenMessages.delete(id);
}, 60_000).unref();

// Raw Body für die Twitch-Signaturprüfung
app.use(express.json({
    limit: '256kb',
    verify: (req, res, buf) => { req.rawBody = buf; },
}));

function hasValidSignature(req) {
    const id = req.get('twitch-eventsub-message-id');
    const timestamp = req.get('twitch-eventsub-message-timestamp');
    const signature = req.get('twitch-eventsub-message-signature');
    const secret = process.env.TWITCH_WEBHOOK_SECRET;
    if (!id || !timestamp || !signature || !secret || !req.rawBody) return false;

    const expected = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(id)
        .update(timestamp)
        .update(req.rawBody)
        .digest('hex');

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Twitch EventSub Webhook ─────────────────────────────────
app.post('/webhook/twitch', (req, res) => {
    if (!hasValidSignature(req)) {
        logger.warn('Twitch Webhook: Ungültige Signatur!');
        return res.status(403).send('Forbidden');
    }

    const sentAt = Date.parse(req.get('twitch-eventsub-message-timestamp'));
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > MAX_AGE_MS) {
        logger.warn('Twitch Webhook: Zeitstempel zu alt oder ungültig');
        return res.status(403).send('Forbidden');
    }

    const messageId = req.get('twitch-eventsub-message-id');
    const messageType = req.get('twitch-eventsub-message-type');
    const subscriptionType = req.get('twitch-eventsub-subscription-type');

    // Challenge bei neuer Subscription: Klartext zurück
    if (messageType === 'webhook_callback_verification') {
        logger.success('Twitch EventSub Subscription verifiziert!');
        return res.status(200).type('text/plain').send(req.body.challenge);
    }

    if (messageType === 'revocation') {
        logger.warn(`Twitch EventSub Subscription widerrufen (${subscriptionType})`);
        return res.sendStatus(204);
    }

    if (messageType !== 'notification') return res.sendStatus(204);

    // Twitch kann dieselbe Nachricht mehrfach senden
    if (seenMessages.has(messageId)) return res.sendStatus(200);
    seenMessages.set(messageId, Date.now());

    // Genau eine Antwort, sofort. Verarbeitung läuft danach.
    res.sendStatus(200);

    const event = req.body.event;
    Promise.resolve()
        .then(async () => {
            if (subscriptionType === 'stream.online') await handleStreamOnline(event);
            if (subscriptionType === 'stream.offline') await handleStreamOffline(event);
        })
        .catch(err => logger.error('Twitch-Event konnte nicht verarbeitet werden', err));
});

// ── OAuth Callback (Twitch-Verknüpfung) ─────────────────────
app.get('/auth/twitch/callback', require('./oauthCallback'));

// ── Health Check ────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'online', bot: 'Hundehütte' });
});

function startServer(client) {
    // Client für Events verfügbar machen
    app.locals.client = client;

    const port = Number(process.env.PORT ?? 3001);
    app.listen(port, '127.0.0.1', (err) => {
        if (err) {
            logger.error(`Webserver konnte nicht auf Port ${port} starten`, err);
            return;
        }
        logger.success(`Webserver läuft auf 127.0.0.1:${port}`);
    });
}

module.exports = { startServer };
