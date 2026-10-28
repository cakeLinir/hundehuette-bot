
/**
 * Rangdefinitionen der Spedition.
 *
 * WICHTIG:
 * - Die ersten vier Einträge bilden die reguläre Fahrer-Beförderungskette.
 * - Funktions- und Leitungsränge sind keine Stationen dieser Beförderungskette.
 * - Die Reihenfolge der vier Fahrerränge muss erhalten bleiben.
 * - Interne Schlüssel bestehender Ränge dürfen nicht geändert werden.
 *
 * key          Interner Schlüssel.
 * spedv        Exakter Rangname in SpedV.
 * role         Discord-Rollenname.
 * env          Optionale .env-Variable mit einer Rollen-ID.
 * color        Discord-Rollenfarbe.
 * permissions  Zusätzliche Discord-Rechte.
 * promotion    Beförderungskriterien (nur reguläre Fahrerränge).
 * leader       Ob der Rang bei Beförderungsempfehlungen gepingt wird.
 * category     Einordnung in das Rangsystem.
 *
 * Die Reihenfolge der Einträge allein definiert NICHT die
 * Beförderungsreihenfolge. Diese bleibt auf die vier Fahrerränge
 * beschränkt und muss in der Beförderungslogik berücksichtigt werden.
 */
module.exports = [
    // ============================================================
    // REGULÄRE FAHRERRÄNGE
    // Reihenfolge: niedrigster -> höchster Fahrerrang
    // ============================================================

    {
        key: 'probe',
        spedv: 'Fahrer auf Probe',
        role: 'Fahrer auf Probe',
        env: 'ROLE_PROBEFAHRER',
        color: 0x95a5a6,
        permissions: [],
        promotion: { minDays: 7, minKm: 2500 },
        leader: false,
        category: 'driver',
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
        category: 'driver',
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
        category: 'driver',
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
        category: 'driver',
    },

    // ============================================================
    // LEITUNGS- UND FUNKTIONSRÄNGE
    // Keine regulären Stationen der Fahrer-Beförderungskette
    // ============================================================

    {
        key: 'geschaeftsfuehrer',
        spedv: 'Geschäftsführer',
        role: 'Geschäftsführer',
        env: 'ROLE_GESCHAEFTSFUEHRER',
        color: 0xe74c3c,
        permissions: [],
        leader: true,
        category: 'leadership',
    },
    {
        key: 'stv_geschaeftsfuehrer',
        spedv: 'Stv. Geschäftsführer',
        role: 'Stv. Geschäftsführer',
        env: 'ROLE_STV_GESCHAEFTSFUEHRER',
        color: 0xc0392b,
        permissions: [],
        leader: true,
        category: 'leadership',
    },
    {
        key: 'betriebsleiter',
        spedv: 'Betriebsleiter',
        role: 'Betriebsleiter',
        env: 'ROLE_BETRIEBSLEITER',
        color: 0xd35400,
        permissions: [],
        leader: true,
        category: 'leadership',
    },
    {
        key: 'dispositionsleiter',
        spedv: 'Dispositionsleiter',
        role: 'Dispositionsleiter',
        env: 'ROLE_DISPOSITIONSLEITER',
        color: 0x9b59b6,
        permissions: [],
        leader: true,
        category: 'leadership',
    },
    {
        key: 'buchhaltungsleiter',
        spedv: 'Buchhaltungsleiter',
        role: 'Buchhaltungsleiter',
        env: 'ROLE_BUCHHALTUNGSLEITER',
        color: 0x16a085,
        permissions: [],
        leader: true,
        category: 'leadership',
    },
    {
        key: 'fuhrparkmanagement',
        spedv: 'Fuhrparkmanagement',
        role: 'Fuhrparkmanagement',
        env: 'ROLE_FUHRPARKMANAGEMENT',
        color: 0x2980b9,
        permissions: [],
        leader: true,
        category: 'leadership',
    },
    {
        key: 'ausbildungsleiter',
        spedv: 'Ausbildungsleiter',
        role: 'Ausbildungsleiter',
        env: 'ROLE_AUSBILDUNGSLEITER',
        color: 0x27ae60,
        permissions: [],
        leader: true,
        category: 'leadership',
    },
    {
        key: 'personalmanager',
        spedv: 'Personalmanager',
        role: 'Personalmanager',
        env: 'ROLE_PERSONALMANAGER',
        color: 0x8e44ad,
        permissions: [],
        leader: true,
        category: 'leadership',
    },
    {
        key: 'event_konvoimanager',
        spedv: 'Event- und Konvoimanager',
        role: 'Event- und Konvoimanager',
        env: 'ROLE_EVENT_KONVOIMANAGER',
        color: 0xf39c12,
        permissions: [],
        leader: true,
        category: 'leadership',
    },
    {
        key: 'konvoi_leiter',
        spedv: 'Konvoi-Leiter',
        role: 'Konvoi-Leiter',
        env: 'ROLE_KONVOILEITER',
        color: 0x1abc9c,
        permissions: [],
        leader: true,
        category: 'leadership',
    },

    // ============================================================
    // WEITERE FUNKTIONSRÄNGE
    // Keine regulären Stationen der Fahrer-Beförderungskette
    // ============================================================

    {
        key: 'buchhaltung',
        spedv: 'Buchhaltung',
        role: 'Buchhaltung',
        env: 'ROLE_BUCHHALTUNG',
        color: 0x2ecc71,
        permissions: [],
        leader: false,
        category: 'function',
    },
    {
        key: 'ausbilder',
        spedv: 'Ausbilder',
        role: 'Ausbilder',
        env: 'ROLE_AUSBILDER',
        color: 0x3498db,
        permissions: [],
        leader: false,
        category: 'function',
    },
    {
        key: 'disponent',
        spedv: 'Disponent',
        role: 'Disponent',
        env: 'ROLE_DISPOSITION',
        color: 0x9b59b6,
        permissions: [],
        leader: false,
        category: 'function',
    },
    {
        key: 'konvoi_begleiter',
        spedv: 'Konvoi-Begleiter',
        role: 'Konvoi-Begleiter',
        env: 'ROLE_KONVOIBEGLЕITER',
        color: 0x1abc9c,
        permissions: [],
        leader: false,
        category: 'function',
    },
];
