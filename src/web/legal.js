const express = require('express');
const path = require('path');

const router = express.Router();
const publicDir = path.join(__dirname, '../../public');

const pages = {
    '/privacy': 'privacy.html',
    '/terms': 'terms.html',
    '/legal.css': 'legal.css',
};

for (const [route, file] of Object.entries(pages)) {
    router.get(route, (req, res) => {
        res.set('Cache-Control', 'public, max-age=3600');
        res.sendFile(path.join(publicDir, file));
    });
}

// Schrift und Logo lokal ausliefern (keine Abrufe bei Dritten)
router.use(
    '/legal-assets',
    express.static(path.join(publicDir, 'legal-assets'), {
        maxAge: '7d',
        index: false,
        fallthrough: false,
    })
);

module.exports = router;
