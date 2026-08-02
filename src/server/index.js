const express = require('express');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { handleStreamOnline, handleStreamOffline } = require('./twitchEvents');

const app = express();

// Raw Body für Twitch Signatur-Verifikation
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// ── Twitch EventSub Webhook ─────────────────────────────────
app.post('/webhook/twitch', async (req, res) => {
    const messageId = req.headers['twitch-eventsub-message-id'];
    const timestamp = req.headers['twitch-eventsub-message-timestamp'];
    const signature = req.headers['twitch-eventsub-message-signature'];
    const messageType = req.headers['twitch-eventsub-message-type'];
    const subscriptionType = req.headers['twitch-eventsub-subscription-type'];

    // Signatur prüfen
    const hmacMessage = messageId + timestamp + req.rawBody;
    const expectedSig = 'sha256=' + crypto
        .createHmac('sha256', process.env.TWITCH_WEBHOOK_SECRET)
        .update(hmacMessage)
        .digest('hex');

    if (signature !== expectedSig) {
        logger.warn('Twitch Webhook: Ungültige Signatur!');
        return res.status(403).send('Forbidden');
    }

    // Challenge Verifikation (bei neuer Subscription)
    if (messageType === 'webhook_callback_verification') {
        logger.success('Twitch EventSub Subscription verifiziert!');
        return res.status(200).send(req.body.challenge);
    }

    // Event verarbeiten
    if (messageType === 'notification') {
        res.status(200).send('OK');

        const event = req.body.event;

        if (subscriptionType === 'stream.online') {
            await handleStreamOnline(event);
        }

        if (subscriptionType === 'stream.offline') {
            await handleStreamOffline(event);
        }
    }

    res.status(200).send('OK');
});

// ── OAuth Callback ──────────────────────────────────────────
app.get('/auth/twitch/callback', require('./oauthCallback'));

// ── Health Check ────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'online', bot: 'Hundehütte' });
});

function startServer(client) {
    // Client für Events verfügbar machen
    app.locals.client = client;

    const port = process.env.PORT ?? 3000;
    app.listen(port, () => {
        logger.success(`Webserver läuft auf Port ${port}`);
    });
}

module.exports = { startServer };
