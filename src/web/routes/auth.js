const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const router = express.Router();

const DISCORD_API = 'https://discord.com/api/v10';
const SCOPES = 'identify guilds';
const HTTP_TIMEOUT = 10_000;

router.get('/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;

    const url = 'https://discord.com/oauth2/authorize'
        + `?client_id=${encodeURIComponent(process.env.CLIENT_ID)}`
        + `&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}`
        + '&response_type=code'
        + `&scope=${encodeURIComponent(SCOPES)}`
        + `&state=${state}`;

    req.session.save(() => res.redirect(url));
});

router.get('/discord/callback', async (req, res) => {
    const { code, state } = req.query;
    const expected = req.session?.oauthState;

    if (!code || !state || !expected || state !== expected) {
        return res.redirect('/?error=invalid_state');
    }

    try {
        const tokenRes = await axios.post(
            `${DISCORD_API}/oauth2/token`,
            new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.REDIRECT_URI,
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: HTTP_TIMEOUT }
        );

        // Token nur für diese beiden Abfragen, wird nicht gespeichert
        const headers = { Authorization: `Bearer ${tokenRes.data.access_token}` };
        const [userRes, guildsRes] = await Promise.all([
            axios.get(`${DISCORD_API}/users/@me`, { headers, timeout: HTTP_TIMEOUT }),
            axios.get(`${DISCORD_API}/users/@me/guilds`, { headers, timeout: HTTP_TIMEOUT }),
        ]);

        const user = {
            id: userRes.data.id,
            username: userRes.data.username,
            global_name: userRes.data.global_name ?? null,
            avatar: userRes.data.avatar ?? null,
        };
        const guilds = guildsRes.data.map(g => ({
            id: g.id,
            name: g.name,
            icon: g.icon ?? null,
            owner: g.owner === true,
            permissions: String(g.permissions ?? '0'),
        }));

        // Neue Session-ID nach dem Login (verhindert Session-Fixation)
        req.session.regenerate(err => {
            if (err) return res.redirect('/?error=auth_failed');
            req.session.user = user;
            req.session.guilds = guilds;
            req.session.save(() => res.redirect('/dashboard'));
        });
    } catch (err) {
        console.error('[Auth] Callback Fehler:', err.response?.data?.error ?? err.message);
        res.redirect('/?error=auth_failed');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

// Session-Status für React abfragen
router.get('/me', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ loggedIn: false });
    res.json({ loggedIn: true, user: req.session.user });
});

module.exports = router;
