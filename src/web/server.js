const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const authRoutes = require('./routes/auth');
const getDashboardRoutes = require('./routes/dashboard');
const legalRoutes = require('./legal');

module.exports = (client) => {
    if (!process.env.SESSION_SECRET) {
        throw new Error('SESSION_SECRET fehlt in der .env');
    }

    const app = express();
    const port = Number(process.env.WEB_PORT ?? 3000);
    const distPath = path.join(__dirname, '../../dashboard/dist');
    const indexPath = path.join(distPath, 'index.html');

    // Hinter Reverse-Proxy (IIS/Caddy/nginx) nötig
    app.set('trust proxy', 1);

    // Öffentliche Seiten zuerst: ohne Session, ohne Login
    app.use(legalRoutes);

    app.use(session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.COOKIE_SECURE === 'true',
            maxAge: 1000 * 60 * 60 * 24
        }
    }));

    app.use(express.json());
    app.use('/auth', authRoutes);
    app.use('/api', getDashboardRoutes(client));
    app.use(express.static(distPath));

    app.get('/{*path}', (req, res) => {
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            res.status(404).send('Dashboard not built yet.');
        }
    });

    // Express 5: Listen-Fehler (z. B. EADDRINUSE) landen im Callback
    app.listen(port, (err) => {
        if (err) {
            console.error(`[Web] Start auf Port ${port} fehlgeschlagen:`, err.message);
            return;
        }
        console.log(`[Web] Dashboard läuft auf Port ${port}`);
    });
};
