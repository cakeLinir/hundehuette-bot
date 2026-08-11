const express = require('express');
const authMiddleware = require('../middleware/auth');
const { getGuildSettings, setGuildSettings } = require('../../utils/settingsManager');
const { getModules, setModule, DEFAULT_MODULES } = require('../../utils/moduleManager');
const { postVerifyEmbed } = require('../../commands/admin/verify');

module.exports = (client) => {
    const router = express.Router();

    // Guilds wo User Admin ist
    router.get('/guilds', authMiddleware, (req, res) => {
        const adminGuilds = req.session.guilds
            .filter(g => (BigInt(g.permissions) & BigInt(0x8)) === BigInt(0x8))
            .map(g => ({
                ...g,
                botPresent: client.guilds.cache.has(g.id)
            }));
        res.json(adminGuilds);
    });

    // Channels einer Guild
    router.get('/guild/:id/channels', authMiddleware, (req, res) => {
        const guild = client.guilds.cache.get(req.params.id);
        if (!guild) return res.status(404).json({ error: 'Guild nicht gefunden' });

        const channels = guild.channels.cache
            .filter(c => c.type === 0 || c.type === 4) // Text + Kategorie
            .map(c => ({ id: c.id, name: c.name, type: c.type }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json(channels);
    });

    // Rollen einer Guild
    router.get('/guild/:id/roles', authMiddleware, (req, res) => {
        const guild = client.guilds.cache.get(req.params.id);
        if (!guild) return res.status(404).json({ error: 'Guild nicht gefunden' });

        const roles = guild.roles.cache
            .filter(r => !r.managed && r.name !== '@everyone')
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json(roles);
    });

    // Settings laden
    router.get('/guild/:id/settings', authMiddleware, (req, res) => {
        const settings = getGuildSettings(req.params.id);
        res.json(settings ?? {});
    });

    // Module laden
    router.get('/guild/:id/modules', authMiddleware, (req, res) => {
        const modules = getModules(req.params.id);
        res.json(modules);
    });


    // Settings speichern
    router.post('/guild/:id/settings', authMiddleware, (req, res) => {
        setGuildSettings(req.params.id, req.body);
        res.json({ success: true });
    });

    // Einzelnes Modul setzen
    router.post('/guild/:id/modules', authMiddleware, (req, res) => {
        const { moduleName, enabled } = req.body;
        setModule(req.params.id, moduleName, enabled);
        res.json({ success: true });
    });

    // Verify Message posten
    router.post('/guild/:id/verify/post', authMiddleware, async (req, res) => {
        const guild = client.guilds.cache.get(req.params.id);
        if (!guild) return res.status(404).json({ error: 'Guild nicht gefunden' });

        const settings = getGuildSettings(req.params.id);
        if (!settings.verifyChannelId) return res.status(400).json({ error: 'Kein Verify-Kanal konfiguriert' });

        try {
            await postVerifyEmbed(guild, settings.verifyChannelId);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    return router;
};
