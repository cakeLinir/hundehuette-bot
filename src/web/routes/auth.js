const express = require('express');
const router = express.Router();
const axios = require('axios');

const DISCORD_API = 'https://discord.com/api/v10';
const SCOPES = 'identify email guilds guilds.members.read';

router.get('/login', (req, res) => {
    const url = `https://discord.com/oauth2/authorize` +
        `?client_id=${process.env.CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(SCOPES)}`;
    res.redirect(url);
});

router.get('/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/?error=no_code');

    try {
        const tokenRes = await axios.post(`${DISCORD_API}/oauth2/token`,
            new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.REDIRECT_URI,
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token } = tokenRes.data;

        const [userRes, guildsRes] = await Promise.all([
            axios.get(`${DISCORD_API}/users/@me`, {
                headers: { Authorization: `Bearer ${access_token}` }
            }),
            axios.get(`${DISCORD_API}/users/@me/guilds`, {
                headers: { Authorization: `Bearer ${access_token}` }
            })
        ]);

        req.session.user = userRes.data;
        req.session.guilds = guildsRes.data;
        req.session.access_token = access_token;

        res.redirect('/dashboard');
    } catch (err) {
        console.error('[Auth] Callback Fehler:', err.response?.data || err.message);
        res.redirect('/?error=auth_failed');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Session-Status für React abfragen
router.get('/me', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ loggedIn: false });
    res.json({ loggedIn: true, user: req.session.user });
});

module.exports = router;
