const express = require('express');
const session = require('express-session');
const path = require('path');
const authRoutes = require('./routes/auth');
const getDashboardRoutes = require('./routes/dashboard');

module.exports = (client) => {
    const app = express();

    app.use(session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
    }));

    app.use(express.json());
    app.use('/auth', authRoutes);
    app.use('/api', getDashboardRoutes(client));

    app.use(express.static(path.join(__dirname, '../../dashboard/dist')));
    app.get('/{*path}', (req, res) => {
        res.sendFile(path.join(__dirname, '../../dashboard/dist/index.html'));
    });

    app.listen(3000, () => console.log('[Web] Dashboard läuft auf Port 3000'));
};
