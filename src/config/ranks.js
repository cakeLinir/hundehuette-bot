
/**
 * Fahrer-Ränge der Spedition.
 *
 * Reihenfolge: niedrigster -> höchster Rang.
 * Diese Liste ist ausschließlich für die Beförderungskette zuständig.
 *
 * key          Interner Schlüssel; bestehende Schlüssel nicht ändern.
 * spedv        Rangname in SpedV.
 * role         Discord-Rollenname.
 * env          Optionale .env-Variable mit einer vorhandenen Rollen-ID.
 * color        Discord-Rollenfarbe.
 * permissions  Zusätzliche Discord-Rechte.
 * promotion    Kriterien für eine Empfehlung zum nächsten Fahrerrang.
 * leader       Ob dieser Rang bei Beförderungsempfehlungen gepingt wird.
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
        promotion: { minDays: 60, minKm: 20000 },
        leader: false,
    },
];
