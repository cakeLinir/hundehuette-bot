const express = require('express');
const authMiddleware = require('../middleware/auth');
const guildAdmin = require('../middleware/guildAdmin');
const { isGuildAdmin } = guildAdmin;
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');
const { getModules, setModule } = require('../../utils/moduleManager');
const { postVerifyEmbed } = require('../../commands/admin/verify');

// Interne Daten, die das Dashboard weder lesen noch überschreiben darf
const PROTECTED_KEYS = new Set(['tickets', 'linkedTwitchUsers']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MODULE_NAME = /^[a-z0-9_-]{1,32}$/i;

function sanitizeSettings(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const clean = {};
    for (const [key, value] of Object.entries(body)) {
        if (PROTECTED_KEYS.has(key) || FORBIDDEN_KEYS.has(key)) continue;
        clean[key] = value;
    }
    return clean;
}

module.exports = (client) => {
    const router = express.Router();

    const botInGuild = (req, res, next) => {
        if (!client.guilds.cache.has(req.params.id)) {
            return res.status(404).json({ error: 'Bot ist nicht auf diesem Server' });
        }
        next();
    };

    // Server, auf denen der Nutzer Admin ist
    router.get('/guilds', authMiddleware, (req, res) => {
        const adminGuilds = (req.session.guilds ?? [])
            .filter(isGuildAdmin)
            .map(g => ({ ...g, botPresent: client.guilds.cache.has(g.id) }));
        res.json(adminGuilds);
    });

    // Ab hier gilt für jede Route mit :id: eingeloggt + Admin dieses Servers + Bot ist dort
    router.use('/guild/:id', authMiddleware, guildAdmin, botInGuild);

    router.get('/guild/:id/channels', (req, res) => {
        const guild = client.guilds.cache.get(req.params.id);
        const channels = guild.channels.cache
            .filter(c => c.type === 0 || c.type === 4) // Text + Kategorie
            .map(c => ({ id: c.id, name: c.name, type: c.type }))
            .sort((a, b) => a.name.localeCompare(b.name));
        res.json(channels);
    });

    router.get('/guild/:id/roles', (req, res) => {
        const guild = client.guilds.cache.get(req.params.id);
        const roles = guild.roles.cache
            .filter(r => !r.managed && r.name !== '@everyone')
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
            .sort((a, b) => a.name.localeCompare(b.name));
        res.json(roles);
    });

    router.get('/guild/:id/settings', (req, res) => {
        const { tickets, linkedTwitchUsers, ...safe } = getGuildSettings(req.params.id) ?? {};
        res.json(safe);
    });

    router.get('/guild/:id/modules', (req, res) => {
        res.json(getModules(req.params.id));
    });

    router.post('/guild/:id/settings', (req, res) => {
        const clean = sanitizeSettings(req.body);
        if (!clean) return res.status(400).json({ error: 'Ungültige Einstellungen' });
        setGuildSettings(req.params.id, clean);
        res.json({ success: true });
    });

    router.post('/guild/:id/modules', (req, res) => {
        const { moduleName, enabled } = req.body ?? {};
        if (typeof moduleName !== 'string' || !MODULE_NAME.test(moduleName) || typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'Ungültiges Modul' });
        }
        setModule(req.params.id, moduleName, enabled);
        res.json({ success: true });
    });

    router.post('/guild/:id/verify/post', async (req, res) => {
        const guild = client.guilds.cache.get(req.params.id);
        const settings = getGuildSettings(req.params.id);
        if (!settings.verifyChannelId) {
            return res.status(400).json({ error: 'Kein Verify-Kanal konfiguriert' });
        }
        try {
            await postVerifyEmbed(guild, settings.verifyChannelId);
            res.json({ success: true });
        } catch (err) {
            console.error('[Dashboard] Verify-Nachricht fehlgeschlagen:', err.message);
            res.status(500).json({ error: 'Verify-Nachricht konnte nicht gepostet werden' });
        }
    });

    return router;
};
