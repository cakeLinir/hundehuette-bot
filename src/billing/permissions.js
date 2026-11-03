'use strict';

const POSITIONS = require('../config/positions');

// Rechnungen versenden, Zahlung bestätigen, stornieren, Prüffälle klären
const STAFF_KEYS = Object.freeze([
    'geschaeftsfuehrer',
    'stellv_geschaeftsfuehrer',
    'buchhaltungsleiter',
    'buchhaltung',
]);

// Ausnahmen nach § 5.3 genehmigen
const EXCEPTION_KEYS = Object.freeze(['geschaeftsfuehrer', 'stellv_geschaeftsfuehrer']);

// Wer bei der Generalprüfung benachrichtigt wird
const PING_KEYS = Object.freeze(['buchhaltungsleiter', 'buchhaltung']);

// Erst bei Gebrauch laden: das Modul legt beim Laden Dateien an
const defaultGetRoleId = (guildId, position) =>
    require('../utils/rankRoles').getPositionRoleId(guildId, position);

/** Discord-Rollen-IDs zu den Funktionsstellen mit diesen Schlüsseln. */
function roleIds(guildId, keys, getRoleId = defaultGetRoleId) {
    return keys
        .map(key => POSITIONS.find(position => position.key === key))
        .filter(Boolean)
        .map(position => getRoleId(guildId, position))
        .filter(id => typeof id === 'string' && /^\d{17,20}$/.test(id));
}

module.exports = { STAFF_KEYS, EXCEPTION_KEYS, PING_KEYS, roleIds };
