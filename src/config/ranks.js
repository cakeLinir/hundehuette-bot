/**
 * Einzige Stelle, an der Ränge definiert werden.
 * Reihenfolge: niedrigster -> höchster Rang.
 *
 *  key          interner Schlüssel (nie ändern, wird in den Settings gespeichert)
 *  spedv        Rangname in SpedV (Groß-/Kleinschreibung egal)
 *  role         Name der Discord-Rolle
 *  env          optionale .env-Variable mit einer vorhandenen Rollen-ID
 *  color        Rollenfarbe
 *  permissions  NUR zusätzliche Rechte (Rechte sind additiv, Einschränkungen laufen über Kanal-Rechte)
 *  promotion    Kriterien für eine Beförderungsempfehlung zum nächsten Rang (null = nur manuell)
 *  leader       Leitungsrang (wird bei Empfehlungen gepingt)
 */
module.exports = [
    {
        key: 'probe',
        spedv: 'Fahrer auf Probe',
        role: 'Fahrer auf Probe',
        env: 'ROLE_PROBEFAHRER',
        color: 0x95a5a6,
        permissions: [],
        promotion: { minDays: 7, minKm: 2500 },
        leader: false,
    },
    {
        key: 'junior',
        spedv: 'Junior Fahrer',
        role: 'Junior Fahrer',
        env: 'ROLE_JUNIORFAHRER',
        color: 0x3498db,
        permissions: [],
        promotion: { minDays: 14, minKm: 5000 },
        leader: false,
    },
    {
        key: 'fahrer',
        spedv: 'Fahrer',
        role: 'Fahrer',
        env: 'ROLE_FAHRER',
        color: 0x2ecc71,
        permissions: [],
        promotion: { minDays: 30, minKm: 10000 },
        leader: false,
    },
    {
        key: 'senior',
        spedv: 'Senior Fahrer',
        role: 'Senior Fahrer',
        env: 'ROLE_SENIORFAHRER',
        color: 0xf1c40f,
        permissions: [],
        promotion: { minDays: 182, minKm: 50000 },
        leader: false,
    },
    {
        key: 'werkstattleiter',
        spedv: 'Werkstattleiter',
        role: 'Werkstattleiter',
        env: 'ROLE_WERKSTATTLEITER',
        color: 0x00bcd4,
        permissions: ['ManageMessages', 'ModerateMembers', 'ManageThreads', 'MuteMembers', 'MoveMembers'],
        promotion: null,
        leader: false,
    },
    {
        key: 'buchhaltung',
        spedv: 'Buchhaltung',
        role: 'Buchhaltung',
        env: 'ROLE_BUCHHALTUNG',
        color: 0x9b59b6,
        permissions: [],
        promotion: null,
        leader: false,
    },
    {
        key: 'disposition',
        spedv: 'Disposition',
        role: 'Disposition',
        env: 'ROLE_DISPOSITION',
        color: 0x1abc9c,
        permissions: [],
        promotion: null,
        leader: false,
    },
    {
        key: 'geschaeftsfuehrer',
        spedv: 'Geschäftsführer',
        role: 'Geschäftsführer',
        env: 'ROLE_GESCHAEFTSFUEHRER',
        color: 0xff0000,
        permissions: [
            'ManageMessages', 'ModerateMembers', 'ManageThreads', 'MuteMembers', 'MoveMembers',
            'KickMembers', 'ManageNicknames', 'MentionEveryone', 'ManageEvents', 'ViewAuditLog', 'PrioritySpeaker',
        ],
        promotion: null,
        leader: true,
    },
];
