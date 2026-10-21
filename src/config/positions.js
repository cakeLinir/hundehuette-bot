/**
 * Funktionsstellen der Spedition.
 *
 * Diese Liste ist unabhängig von den SpedV-Fahrerrängen.
 * minRank verweist auf den internen Schlüssel aus ranks.js.
 *
 * Alle 15 Funktionsstellen können öffentlich beantragt werden.
 * reviewerPositionKeys legt fest, welche Funktionsstellen die
 * Bewerbung prüfen dürfen. Discord-Administrator und Geschäftsführung
 * können gemäß positionApplicationPermissions.js ebenfalls prüfen.
 *
 * permissions sind zusätzliche Discord-Rechte.
 * Keine Funktionsstelle erhält standardmäßig administrative Rechte.
 */
module.exports = [
    {
        key: 'geschaeftsfuehrer',
        name: 'Geschäftsführung',
        role: 'Geschäftsführer',
        env: 'ROLE_GESCHAEFTSFUEHRER',
        reviewerPositionKeys: [],
        color: 0xff0000,
        minRank: 'senior',
        permissions: [],
        category: 'geschaeftsfuehrung',
        description:
            'Koordiniert die Spedition, trifft grundlegende organisatorische Entscheidungen und verantwortet die Zusammenarbeit aller Funktionsbereiche.',
    },
    {
        key: 'stellv_geschaeftsfuehrer',
        name: 'Stellvertretende Geschäftsführung',
        role: 'Stv. Geschäftsführer',
        env: 'ROLE_STV_GESCHAEFTSFUEHRER',
        reviewerPositionKeys: ['geschaeftsfuehrer'],
        color: 0xe74c3c,
        minRank: 'senior',
        permissions: [],
        category: 'geschaeftsfuehrung',
        description:
            'Vertritt die Geschäftsführung und unterstützt bei strategischen Entscheidungen sowie der Koordination der Leitungsebene.',
    },
    {
        key: 'betriebsleiter',
        name: 'Betriebsleiter',
        role: 'Betriebsleiter',
        env: 'ROLE_BETRIEBSLEITER',
        reviewerPositionKeys: ['geschaeftsfuehrer'],
        color: 0xc0392b,
        minRank: 'senior',
        permissions: [],
        category: 'leitung',
        description:
            'Koordiniert den laufenden Speditionsbetrieb und stimmt die Arbeit der Funktionsbereiche miteinander ab.',
    },
    {
        key: 'dispositionsleiter',
        name: 'Dispositionsleiter',
        role: 'Dispositionsleiter',
        env: 'ROLE_DISPOSITIONSLEITER',
        reviewerPositionKeys: ['geschaeftsfuehrer'],
        color: 0x16a085,
        minRank: 'senior',
        permissions: [],
        category: 'leitung',
        description:
            'Verantwortet die Disposition, organisiert Touren und koordiniert die eingesetzten Fahrer und Disponenten.',
    },
    {
        key: 'buchhaltungsleiter',
        name: 'Buchhaltungsleiter',
        role: 'Buchhaltungsleiter',
        env: 'ROLE_BUCHHALTUNGSLEITER',
        reviewerPositionKeys: ['geschaeftsfuehrer'],
        color: 0x8e44ad,
        minRank: 'senior',
        permissions: [],
        category: 'leitung',
        description:
            'Koordiniert die Buchhaltung und verantwortet die Prüfung sowie Dokumentation interner Abrechnungen.',
    },
    {
        key: 'werkstattleiter',
        name: 'Werkstattleitung',
        role: 'Werkstattleiter',
        env: 'ROLE_WERKSTATTLEITER',
        reviewerPositionKeys: ['geschaeftsfuehrer'],
        color: 0x00bcd4,
        minRank: 'senior',
        permissions: [],
        category: 'leitung',
        description:
            'Koordiniert Werkstatt- und Fuhrparkaufgaben, unterstützt Fahrer bei technischen Fragen und organisiert die zugehörigen Abläufe.',
    },
    {
        key: 'ausbildungsleiter',
        name: 'Ausbildungsleiter',
        role: 'Ausbildungsleiter',
        env: 'ROLE_AUSBILDUNGSLEITER',
        reviewerPositionKeys: ['geschaeftsfuehrer'],
        color: 0x2980b9,
        minRank: 'senior',
        permissions: [],
        category: 'leitung',
        description:
            'Plant die Fahrerausbildung, koordiniert Ausbilder und entwickelt einheitliche Ausbildungsabläufe.',
    },
    {
        key: 'personalmanager',
        name: 'Personalmanager',
        role: 'Personalmanager',
        env: 'ROLE_PERSONALMANAGER',
        reviewerPositionKeys: ['geschaeftsfuehrer'],
        color: 0xd35400,
        minRank: 'senior',
        permissions: [],
        category: 'leitung',
        description:
            'Unterstützt die Personalplanung, begleitet interne Personalangelegenheiten und koordiniert die Betreuung der Fahrer.',
    },
    {
        key: 'event_konvoimanager',
        name: 'Event- und Konvoimanager',
        role: 'Event- und Konvoimanager',
        env: 'ROLE_EVENT_KONVOIMANAGER',
        reviewerPositionKeys: ['geschaeftsfuehrer', 'dispositionsleiter'],
        color: 0xf39c12,
        minRank: 'fahrer',
        permissions: [],
        category: 'organisation',
        description:
            'Plant Speditionsevents und Konvois, koordiniert Termine und stimmt organisatorische Abläufe mit den Beteiligten ab.',
    },
    {
        key: 'moderationsleiter',
        name: 'Community- und Moderationsleiter',
        role: 'Moderationsleiter',
        env: 'ROLE_MODERATIONSLEITER',
        reviewerPositionKeys: ['geschaeftsfuehrer'],
        color: 0x7f8c8d,
        minRank: 'senior',
        permissions: [],
        category: 'leitung',
        description:
            'Koordiniert die Community-Moderation, begleitet interne Konfliktklärungen und stimmt Moderationsabläufe mit der Leitung ab.',
    },
    {
        key: 'disposition',
        name: 'Disponent',
        role: 'Disponent',
        env: 'ROLE_DISPOSITION',
        reviewerPositionKeys: ['dispositionsleiter'],
        color: 0x1abc9c,
        minRank: 'fahrer',
        permissions: [],
        category: 'fachfunktion',
        description:
            'Unterstützt bei Tourenplanung, Fahrtenkoordination und der Organisation gemeinsamer Speditionsaktivitäten.',
    },
    {
        key: 'ausbilder',
        name: 'Ausbilder',
        role: 'Ausbilder',
        env: 'ROLE_AUSBILDER',
        reviewerPositionKeys: ['ausbildungsleiter'],
        color: 0x3498db,
        minRank: 'senior',
        permissions: [],
        category: 'fachfunktion',
        description:
            'Begleitet neue Fahrer, vermittelt Speditionsabläufe und unterstützt bei der praktischen Fahrerausbildung.',
    },
    {
        key: 'konvoileiter',
        name: 'Konvoi-Leiter',
        role: 'Konvoi-Leiter',
        env: 'ROLE_KONVOILEITER',
        reviewerPositionKeys: ['dispositionsleiter'],
        color: 0xe67e22,
        minRank: 'fahrer',
        permissions: [],
        category: 'konvoi',
        description:
            'Plant und leitet Konvois, informiert Teilnehmer über die Route und sorgt für einen koordinierten Ablauf.',
    },
    {
        key: 'konvoibegleiter',
        name: 'Konvoi-Begleiter',
        role: 'Konvoi-Begleiter',
        env: 'ROLE_KONVOIBEGLEITER',
        reviewerPositionKeys: ['dispositionsleiter'],
        color: 0xf1c40f,
        minRank: 'fahrer',
        permissions: [],
        category: 'konvoi',
        description:
            'Unterstützt die Konvoi-Leitung, begleitet die Gruppe und hilft bei der Koordination der Teilnehmer.',
    },
    {
        key: 'buchhaltung',
        name: 'Buchhaltung',
        role: 'Buchhaltung',
        env: 'ROLE_BUCHHALTUNG',
        reviewerPositionKeys: ['buchhaltungsleiter'],
        color: 0x9b59b6,
        minRank: 'fahrer',
        permissions: [],
        category: 'fachfunktion',
        description:
            'Unterstützt bei der Prüfung und Dokumentation von Speditionsabrechnungen und internen Finanzübersichten.',
    },
];
