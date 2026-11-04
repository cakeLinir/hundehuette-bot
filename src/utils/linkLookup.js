'use strict';

const SNOWFLAKE = /^\d{17,20}$/;

const norm = value => String(value ?? '').trim().toLocaleLowerCase('de-DE');

/**
 * Liest die Discord-ID aus einem Eintrag von etsLinks.json.
 * Unterstützt das alte Format (Text/Zahl) und das neue Format ({ discordId, ... }).
 * Gibt nur eine gültige ID zurück, nie ein Objekt.
 */
function discordIdOfLink(value) {
    const raw = value && typeof value === 'object' && !Array.isArray(value)
        ? value.discordId
        : value;
    const id = String(raw ?? '').trim();
    return SNOWFLAKE.test(id) ? id : null;
}

/**
 * Sucht die Discord-ID eines SpedV-Fahrers.
 * 1. über die SpedV-ID (stabil, auch bei Namensänderung)
 * 2. ersatzweise über den Namen, aber nie, wenn der Eintrag zu einer anderen SpedV-ID gehört
 */
function findDiscordIdForDriver(links, driver) {
    if (!links || typeof links !== 'object' || Array.isArray(links) || !driver) {
        return null;
    }

    const entries = Object.entries(links);
    const spedvUserId = String(driver.id ?? '').trim();
    const hasUserId = /^\d+$/.test(spedvUserId);

    if (hasUserId) {
        for (const [, value] of entries) {
            if (
                value &&
                typeof value === 'object' &&
                String(value.spedvUserId ?? '').trim() === spedvUserId
            ) {
                const id = discordIdOfLink(value);
                if (id) return id;
            }
        }
    }

    const wanted = norm(driver.userName);
    if (!wanted) return null;

    for (const [name, value] of entries) {
        if (norm(name) !== wanted) continue;

        // Gehört der Eintrag zu einem anderen SpedV-Konto, wird nicht gepingt
        const linkedUserId =
            value && typeof value === 'object' ? String(value.spedvUserId ?? '').trim() : '';
        if (hasUserId && linkedUserId && linkedUserId !== spedvUserId) continue;

        return discordIdOfLink(value);
    }

    return null;
}

module.exports = { discordIdOfLink, findDiscordIdForDriver };
