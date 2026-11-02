'use strict';

// Lädt alle Command-Dateien und meldet Fehler (fehlende Module, kaputte Definition).
// Es wird nichts bei Discord registriert.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src', 'commands');
let failed = 0;

for (const category of fs.readdirSync(root)) {
    const dir = path.join(root, category);
    if (!fs.statSync(dir).isDirectory()) continue;

    for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
        try {
            const command = require(path.join(dir, file));

            if (!command.data || typeof command.execute !== 'function') {
                throw new Error('data oder execute fehlt');
            }

            command.data.toJSON();
            console.log(`OK     ${category}/${file} (/${command.data.name})`);
        } catch (error) {
            failed += 1;
            console.error(`FEHLER ${category}/${file}: ${error.message}`);
        }
    }
}

console.log(failed ? `\n${failed} Fehler.` : '\nAlle Commands laden.');

// Einige Commands ziehen Module nach, die Timer starten: Prozess explizit beenden
process.exit(failed ? 1 : 0);
