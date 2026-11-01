
'use strict';

/**
 * Integrationstest für /ets abrechnung senden
 *
 * - Lädt den echten ETS-Command.
 * - Ruft den echten execute()-Einstieg auf.
 * - Simuliert Discord, SpedV, Logger und Billing-Store.
 * - Versendet niemals echte Discord-DMs.
 * - Verwendet ausschließlich temporäre In-Memory-Testdaten.
 * - Prüft den neuen Embed- und Logo-Versand.
 */

const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;

const TEST_IDS = {
    guild: '11111111111111111',
    staff: '22222222222222222',
    driver: '33333333333333333',
    invoice: 'test-guild:2026-11:test-driver',
    staffRole: '44444444444444444',
};

const TEST_INVOICE = {
    id: TEST_IDS.invoice,
    guildId: TEST_IDS.guild,
    discordUserId: TEST_IDS.driver,
    month: '2026-11',
    status: 'draft',
    delivery: null,
    totalEur: 150,
    lineItems: [
        {
            taskId: 123456,
            completedAt: '2026-11-10T12:00:00.000Z',
            maxVelocityKmh: 97,
            excessKmh: 2,
            amountEur: 150,
        },
    ],
    createdAt: '2026-11-11T12:00:00.000Z',
    updatedAt: '2026-11-11T12:00:00.000Z',
    sendAttemptAt: null,
    dueAt: null,
    paidAt: null,
    warningSentAt: null,
};

function createHarness(options = {}) {
    const state = {
        invoice: structuredClone(TEST_INVOICE),
        sendCalls: 0,
        sendMessages: [],
        deliveryResults: [],
        sendAttempts: [],
        replies: [],
        deferred: false,
        logs: [],
        fallbackAttempts: [],
        fallbackResults: [],
        publicMessages: [],
    };

    const roleIdsByEnv = {
        ROLE_GESCHAEFTSFUEHRER: '55555555555555555',
        ROLE_STV_GESCHAEFTSFUEHRER: '66666666666666666',
        ROLE_BUCHHALTUNGSLEITER: '77777777777777777',
        ROLE_BUCHHALTUNG: TEST_IDS.staffRole,
    };

    const positions = require('../src/config/positions');
    const positionRoleIds = new Map();

    for (const position of positions) {
        positionRoleIds.set(
            position.key,
            roleIdsByEnv[position.env] ?? null
        );
    }

    const store = {
        listInvoices({ guildId }) {
            return state.invoice.guildId === guildId
                ? [state.invoice]
                : [];
        },

        recordInvoiceSendAttempt(
            invoiceId,
            attemptDate,
            delivery,
            actorDiscordId
        ) {
            assert.equal(invoiceId, TEST_IDS.invoice);
            assert.equal(delivery, 'pending');
            assert.equal(actorDiscordId, TEST_IDS.staff);

            state.sendAttempts.push({
                invoiceId,
                attemptDate,
                delivery,
                actorDiscordId,
            });

            if (state.invoice.status === 'sent') {
                assert.equal(
                    state.invoice.delivery,
                    'failed',
                    'Ein erneuter Versand darf nur nach failed erfolgen.'
                );
            } else {
                assert.equal(state.invoice.status, 'draft');
            }

            state.invoice.status = 'sent';
            state.invoice.delivery = 'pending';

            if (!state.invoice.sendAttemptAt) {
                state.invoice.sendAttemptAt = attemptDate.toISOString();

                const dueAt = new Date(attemptDate);
                dueAt.setDate(dueAt.getDate() + 14);
                state.invoice.dueAt = dueAt.toISOString();
            }

            return structuredClone(state.invoice);
        },

        recordInvoiceDeliveryResult(
            invoiceId,
            delivery,
            actorDiscordId
        ) {
            assert.equal(invoiceId, TEST_IDS.invoice);
            assert.equal(actorDiscordId, TEST_IDS.staff);

            state.deliveryResults.push(delivery);

            if (
                options.failDeliveryPersistenceFor === delivery
            ) {
                throw new Error(
                    `Simulierter Speicherfehler für ${delivery}`
                );
            }

            assert.equal(
                state.invoice.delivery,
                'pending',
                'Ein Zustellergebnis darf nur aus pending gespeichert werden.'
            );

            state.invoice.delivery = delivery;

            return structuredClone(state.invoice);
        },
        recordFallbackNotificationAttempt(
            invoiceId,
            channelId,
            actorDiscordId
        ) {
            assert.equal(invoiceId, TEST_IDS.invoice);
            assert.equal(actorDiscordId, TEST_IDS.staff);

            state.fallbackAttempts.push({
                invoiceId,
                channelId,
                actorDiscordId,
            });

            if (options.failFallbackAttemptPersistence) {
                throw new Error(
                    'Simulierter Fehler beim Reservieren des Fallbacks'
                );
            }

            assert.equal(
                state.invoice.delivery,
                'failed',
                'Fallback darf nur nach eindeutig fehlgeschlagener DM erfolgen.'
            );

            assert.equal(
                state.invoice.fallbackNotification,
                undefined,
                'Fallback darf nur einmal reserviert werden.'
            );

            state.invoice.fallbackNotification = {
                status: 'pending',
                channelId,
                messageId: null,
                attemptedAt: new Date().toISOString(),
                completedAt: null,
                error: null,
            };

            return structuredClone(state.invoice);
        },

        recordFallbackNotificationResult(
            invoiceId,
            status,
            details = {},
            actorDiscordId = null
        ) {
            assert.equal(invoiceId, TEST_IDS.invoice);
            assert.equal(actorDiscordId, TEST_IDS.staff);
            assert.ok(['sent', 'unknown'].includes(status));

            state.fallbackResults.push({
                status,
                details,
            });

            if (options.failFallbackResultPersistence) {
                throw new Error(
                    'Simulierter Fehler beim Speichern des Fallback-Ergebnisses'
                );
            }

            assert.equal(
                state.invoice.fallbackNotification?.status,
                'pending'
            );

            state.invoice.fallbackNotification = {
                ...state.invoice.fallbackNotification,
                status,
                messageId: details.messageId ?? null,
                completedAt: new Date().toISOString(),
                error: details.error ?? null,
            };

            return structuredClone(state.invoice);
        },
    };

    const fakeLogger = {
        info(...args) {
            state.logs.push({ level: 'info', args });
        },

        warn(...args) {
            state.logs.push({ level: 'warn', args });
        },

        error(...args) {
            state.logs.push({ level: 'error', args });
        },

        debug(...args) {
            state.logs.push({ level: 'debug', args });
        },
    };

    const fakeEmbedBuilder = {
        createEmbed(message) {
            return { type: 'success', message };
        },

        createErrorEmbed(message) {
            return { type: 'error', message };
        },
    };

    const fakeSpedvApi = {
        fetchUsers: async () => [],
        findDriver: async () => null,
        isRankAllowed: () => false,
        fetchAboutMe: async () => '',
        getLinkOwner: (name) => {
            if (options.linkOwner !== undefined) {
                return options.linkOwner;
            }

            return name === 'Testfahrer'
                ? TEST_IDS.driver
                : null;
        },

        getSpedvNamesByDiscordId(discordId) {
            assert.equal(discordId, TEST_IDS.driver);
            return options.linkedNames ?? ['Testfahrer'];
        },

        setLink() {},
    };

    const fakeVerification = {
        getPending: () => null,
        createPending: () => null,
        clearPending() {},
        codeInText: () => false,
        TTL_MS: 30 * 60 * 1000,
    };

    const fakeRoleSync = {
        applyRoles: async () => {},
    };

    const fakeRankRoles = {
        getPositionRoleId(guildId, position) {
            assert.equal(guildId, TEST_IDS.guild);
            return positionRoleIds.get(position.key) ?? null;
        },
    };

    const mockedModules = {
        '../../utils/embedBuilder': fakeEmbedBuilder,
        '../../utils/moduleManager': {
            isModuleEnabled: () => true,
        },
        '../../utils/logger': fakeLogger,
        '../../utils/spedvApi': fakeSpedvApi,
        '../../utils/etsVerification': fakeVerification,
        '../../utils/spedvRoleSync': fakeRoleSync,
        '../../utils/rankRoles': fakeRankRoles,
        '../../utils/speedBillingStore': store,
    };

    const originalCache = new Map();

    const commandPath = require.resolve(
        '../src/commands/community/ets'
    );

    originalCache.set(
        commandPath,
        require.cache[commandPath]
    );

    delete require.cache[commandPath];

    Module._load = function(request, parent, isMain) {
        if (
            Object.prototype.hasOwnProperty.call(
                mockedModules,
                request
            )
        ) {
            return mockedModules[request];
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let command;

    try {
        command = require(commandPath);
    } finally {
        Module._load = originalLoad;
    }

    const staffMember = {
        id: TEST_IDS.staff,

        roles: {
            cache: {
                has(roleId) {
                    return roleId === TEST_IDS.staffRole;
                },
            },
        },
    };

    const driverMember = {
        id: options.driverMemberId ?? TEST_IDS.driver,

        async send(message) {
            state.sendCalls += 1;
            state.sendMessages.push(message);

            if (options.sendError) {
                throw options.sendError;
            }

            return {
                id: 'simulated-message-id',
            };
        },
    };

    const fallbackChannel = {
        id: '1560300974185123840',

        isTextBased() {
            return true;
        },

        async send(message) {
            state.publicMessages.push(message);

            if (options.fallbackSendError) {
                throw options.fallbackSendError;
            }

            return {
                id: 'simulated-public-message-id',
            };
        },
    };

    const guild = {
        id: TEST_IDS.guild,

        roles: {
            cache: {
                has(roleId) {
                    return Object.values(roleIdsByEnv).includes(
                        roleId
                    );
                },
            },
        },

        members: {
            async fetch(userId) {
                if (userId === TEST_IDS.staff) {
                    return staffMember;
                }

                if (userId === TEST_IDS.driver) {
                    return driverMember;
                }

                throw new Error(
                    `Unbekannte Test-Mitglied-ID: ${userId}`
                );
            },
        },

        channels: {
            async fetch(channelId) {
                assert.equal(
                    channelId,
                    '1560300974185123840'
                );

                if (options.fallbackChannelMissing) {
                    return null;
                }

                if (options.fallbackChannelUnwritable) {
                    return {
                        id: channelId,
                        isTextBased: () => false,
                    };
                }

                return fallbackChannel;
            },
        },
    };

    const interaction = {
        guild,

        user: {
            id: TEST_IDS.staff,
        },

        options: {
            getSubcommandGroup() {
                return 'abrechnung';
            },

            getSubcommand() {
                return 'senden';
            },

            getString(name, required) {
                assert.equal(name, 'rechnung-id');
                assert.equal(required, true);
                return TEST_IDS.invoice;
            },
        },

        async deferReply() {
            state.deferred = true;
        },

        async editReply(payload) {
            state.replies.push(payload);
            return payload;
        },
    };

    return {
        command,
        interaction,
        state,
    };
}

async function runCommand(harness) {
    await harness.command.execute(harness.interaction);
}

/**
 * Extrahiert lesbaren Inhalt aus Discord-Embeds.
 * Unterstützt sowohl EmbedBuilder als auch serialisierte Embed-Daten.
 */
function getEmbedText(message) {
    assert.ok(
        message && typeof message === 'object',
        'Die Discord-Nachricht muss ein Objekt sein.'
    );

    assert.ok(
        Array.isArray(message.embeds),
        'Die Discord-Nachricht muss ein embeds-Array enthalten.'
    );

    const values = [];

    for (const embed of message.embeds) {
        const data = embed.data ?? embed;

        if (data.title) {
            values.push(data.title);
        }

        if (data.description) {
            values.push(data.description);
        }

        if (data.author?.name) {
            values.push(data.author.name);
        }

        if (data.footer?.text) {
            values.push(data.footer.text);
        }

        if (Array.isArray(data.fields)) {
            for (const field of data.fields) {
                if (field.name) {
                    values.push(field.name);
                }

                if (field.value) {
                    values.push(field.value);
                }
            }
        }
    }

    return values.join('\n');
}

function assertPendingAndLocked(harness, expectedSendCalls) {
    assert.equal(
        harness.state.invoice.status,
        'sent',
        'Die Rechnung muss nach dem Versandversuch den Status sent haben.'
    );

    assert.equal(
        harness.state.invoice.delivery,
        'pending',
        'Der Zustellstatus muss pending bleiben.'
    );

    assert.equal(
        harness.state.sendCalls,
        expectedSendCalls
    );
}

async function testSuccessfulDelivery() {
    const harness = createHarness();

    await runCommand(harness);

    assert.equal(harness.state.deferred, true);
    assert.equal(harness.state.sendCalls, 1);
    assert.equal(harness.state.invoice.status, 'sent');
    assert.equal(harness.state.invoice.delivery, 'delivered');
    assert.equal(harness.state.deliveryResults[0], 'delivered');
    assert.equal(harness.state.sendAttempts.length, 1);

    const message = harness.state.sendMessages[0];
    const embedText = getEmbedText(message);

    assert.ok(
        embedText.includes('Monatsabrechnung 2026-11'),
        'Der Rechnungstitel muss den Abrechnungsmonat enthalten.'
    );

    assert.ok(
        embedText.includes('Testfahrer'),
        'Der Fahrername muss im Embed enthalten sein.'
    );

    assert.ok(
        embedText.includes('150'),
        'Der Rechnungsbetrag muss im Embed enthalten sein.'
    );

    assert.ok(
        embedText.includes('123456'),
        'Die Fahrt-ID muss im Embed enthalten sein.'
    );

    assert.ok(
        embedText.includes('97'),
        'Die gefahrene Höchstgeschwindigkeit muss im Embed enthalten sein.'
    );

    assert.ok(
        embedText.includes('2'),
        'Die Überschreitung muss im Embed enthalten sein.'
    );

    assert.ok(
        Array.isArray(message.files) && message.files.length > 0,
        'Das HKC-Logo muss als Datei angehängt werden.'
    );

    assert.equal(
        message.files[0].name,
        'HKC_logo.png',
        'Der Logo-Dateiname muss HKC_logo.png sein.'
    );

    assert.ok(
        message.embeds.some(
            embed => {
                const data = embed.data ?? embed;
                return data.thumbnail?.url === 'attachment://HKC_logo.png';
            }
        ),
        'Das Logo muss als Embed-Thumbnail referenziert werden.'
    );

    console.log(
        'OK: Embed-Rechnung mit Logo wird versendet und als delivered gespeichert.'
    );
}

async function testDiscord50007() {
    const harness = createHarness({
        sendError: Object.assign(
            new Error('Cannot send messages to this user'),
            { code: 50007 }
        ),
    });

    await runCommand(harness);

    assert.equal(harness.state.sendCalls, 1);
    assert.equal(harness.state.invoice.status, 'sent');
    assert.equal(harness.state.invoice.delivery, 'failed');
    assert.equal(harness.state.deliveryResults[0], 'failed');

    console.log(
        'OK: Discord-Fehler 50007 wird als failed gespeichert.'
    );
}

async function testSuccessfulPublicFallback() {
    const harness = createHarness({
        sendError: Object.assign(
            new Error('Cannot send messages to this user'),
            { code: 50007 }
        ),
    });

    await runCommand(harness);

    assert.equal(
        harness.state.sendCalls,
        1,
        'Die DM muss genau einmal versucht werden.'
    );

    assert.equal(
        harness.state.invoice.delivery,
        'failed'
    );

    assert.equal(
        harness.state.publicMessages.length,
        1,
        'Der öffentliche Fallback muss genau einmal gesendet werden.'
    );

    assert.equal(
        harness.state.fallbackAttempts.length,
        1,
        'Der Fallback-Versuch muss einmal reserviert werden.'
    );

    assert.equal(
        harness.state.fallbackResults.length,
        1
    );

    assert.equal(
        harness.state.invoice.fallbackNotification.status,
        'sent'
    );

    assert.equal(
        harness.state.invoice.fallbackNotification.messageId,
        'simulated-public-message-id'
    );

    const publicMessage = harness.state.publicMessages[0];

    assert.ok(
        publicMessage.content.includes(`<@${TEST_IDS.driver}>`),
        'Die öffentliche Nachricht muss den betroffenen Fahrer erwähnen.'
    );

    assert.deepEqual(
        publicMessage.allowedMentions,
        {
            users: [TEST_IDS.driver],
        },
        'Es darf ausschließlich der betroffene Fahrer erwähnt werden.'
    );

    assert.ok(
        publicMessage.content.includes('/ets abrechnung status'),
        'Die Nachricht muss auf den privaten Statusbefehl verweisen.'
    );

    for (const sensitiveValue of [
        '150',
        '97',
        '123456',
    ]) {
        assert.ok(
            !publicMessage.content.includes(sensitiveValue),
            `Die öffentliche Nachricht darf ${sensitiveValue} nicht enthalten.`
        );
    }

    console.log(
        'OK: Fehlgeschlagene DM löst genau eine neutrale öffentliche Fallback-Nachricht aus.'
    );
}

async function testFallbackIdentityAndChannelGuards() {
    const cases = [
        {
            name: 'Keine SpedV-Verknüpfung',
            expectedSendCalls: 0,
            options: {
                linkedNames: [],
            },
        },
        {
            name: 'Mehrere SpedV-Verknüpfungen',
            expectedSendCalls: 0,
            options: {
                linkedNames: ['Testfahrer', 'AndererFahrer'],
            },
        },
        {
            name: 'SpedV-Verknüpfung gehört einer anderen Discord-ID',
            expectedSendCalls: 1,
            options: {
                linkOwner: '99999999999999999',
            },
        },
        {
            name: 'Discord-Mitglied-ID stimmt nicht überein',
            expectedSendCalls: 1,
            options: {
                driverMemberId: '99999999999999999',
            },
        },
        {
            name: 'Fallback-Kanal fehlt',
            expectedSendCalls: 1,
            options: {
                fallbackChannelMissing: true,
            },
        },
        {
            name: 'Fallback-Kanal ist nicht beschreibbar',
            expectedSendCalls: 1,
            options: {
                fallbackChannelUnwritable: true,
            },
        },
    ];

    for (const testCase of cases) {
        const harness = createHarness({
            ...testCase.options,
            sendError: Object.assign(
                new Error('Cannot send messages to this user'),
                { code: 50007 }
            ),
        });

        await runCommand(harness);

        const expectedInvoiceStatus =
            testCase.expectedSendCalls === 0
                ? 'draft'
                : 'sent';

        const expectedDelivery =
            testCase.expectedSendCalls === 0
                ? null
                : 'failed';

        assert.equal(
            harness.state.sendCalls,
            testCase.expectedSendCalls,
            `${testCase.name}: Unerwartete Anzahl an DM-Versuchen.`
        );

        assert.equal(
            harness.state.invoice.status,
            expectedInvoiceStatus,
            `${testCase.name}: Unerwarteter Rechnungsstatus.`
        );

        assert.equal(
            harness.state.invoice.delivery,
            expectedDelivery,
            `${testCase.name}: Unerwarteter Zustellstatus.`
        );

        assert.equal(
            harness.state.fallbackAttempts.length,
            0,
            `${testCase.name}: Es darf kein Fallback reserviert werden.`
        );

        assert.equal(
            harness.state.publicMessages.length,
            0,
            `${testCase.name}: Es darf keine öffentliche Nachricht erscheinen.`
        );
    }

    console.log(
        'OK: Identitäts- und Kanalprüfungen verhindern unsichere Fallback-Nachrichten.'
    );
}

async function testFallbackReservationPersistenceFailure() {
    const harness = createHarness({
        sendError: Object.assign(
            new Error('Cannot send messages to this user'),
            { code: 50007 }
        ),
        failFallbackAttemptPersistence: true,
    });

    await runCommand(harness);

    assert.equal(harness.state.sendCalls, 1);
    assert.equal(harness.state.invoice.delivery, 'failed');

    assert.equal(
        harness.state.fallbackAttempts.length,
        1,
        'Die Reservierung muss versucht worden sein.'
    );

    assert.equal(
        harness.state.publicMessages.length,
        0,
        'Ohne gespeicherte Reservierung darf nichts veröffentlicht werden.'
    );

    assert.equal(
        harness.state.invoice.fallbackNotification,
        undefined,
        'Bei fehlgeschlagener Reservierung darf kein gespeicherter Fallback entstehen.'
    );

    console.log(
        'OK: Fehlgeschlagene Fallback-Reservierung verhindert die öffentliche Nachricht.'
    );
}

async function testFallbackSendFailure() {
    const harness = createHarness({
        sendError: Object.assign(
            new Error('Cannot send messages to this user'),
            { code: 50007 }
        ),
        fallbackSendError: new Error('Simulierter Fehler beim öffentlichen Versand'),
    });

    await runCommand(harness);

    assert.equal(harness.state.sendCalls, 1);
    assert.equal(harness.state.invoice.delivery, 'failed');

    assert.equal(
        harness.state.publicMessages.length,
        1,
        'Der öffentliche Versand muss versucht worden sein.'
    );

    assert.equal(
        harness.state.fallbackResults.length,
        1
    );

    assert.equal(
        harness.state.fallbackResults[0].status,
        'unknown'
    );

    assert.equal(
        harness.state.invoice.fallbackNotification.status,
        'unknown',
        'Ein unklarer Versandstatus muss gespeichert werden.'
    );

    await runCommand(harness);

    assert.equal(
        harness.state.sendCalls,
        1,
        'Ein erneuter DM-Versuch muss gesperrt bleiben.'
    );

    assert.equal(
        harness.state.publicMessages.length,
        1,
        'Ein erneuter öffentlicher Versand muss gesperrt bleiben.'
    );

    console.log(
        'OK: Unklarer öffentlicher Versand wird als unknown gespeichert und gegen Wiederholung gesperrt.'
    );
}

async function testUnknownDiscordError() {
    const harness = createHarness({
        sendError: Object.assign(
            new Error('Simulierter Netzwerkfehler'),
            { code: 10006 }
        ),
    });

    await runCommand(harness);

    assert.equal(harness.state.sendCalls, 1);
    assert.equal(harness.state.invoice.status, 'sent');
    assert.equal(harness.state.invoice.delivery, 'unknown');
    assert.equal(harness.state.deliveryResults[0], 'unknown');

    console.log(
        'OK: Ein nicht eindeutiger Discord-Fehler wird als unknown gespeichert.'
    );
}

async function testDeliveredPersistenceFailure() {
    const harness = createHarness({
        failDeliveryPersistenceFor: 'delivered',
    });

    await runCommand(harness);

    assertPendingAndLocked(harness, 1);

    assert.equal(
        harness.state.deliveryResults[0],
        'delivered'
    );

    // Zweiter Aufruf muss wegen pending blockiert werden.
    await runCommand(harness);

    assertPendingAndLocked(harness, 1);
    assert.equal(harness.state.sendAttempts.length, 1);

    console.log(
        'OK: Fehler beim Speichern von delivered lässt pending bestehen und blockiert erneuten Versand.'
    );
}

async function testFailedPersistenceFailure() {
    const harness = createHarness({
        sendError: Object.assign(
            new Error('Cannot send messages to this user'),
            { code: 50007 }
        ),
        failDeliveryPersistenceFor: 'failed',
    });

    await runCommand(harness);

    assertPendingAndLocked(harness, 1);

    assert.equal(
        harness.state.deliveryResults[0],
        'failed'
    );

    // Auch hier darf kein zweiter Versand möglich sein.
    await runCommand(harness);

    assertPendingAndLocked(harness, 1);
    assert.equal(harness.state.sendAttempts.length, 1);

    console.log(
        'OK: Fehler beim Speichern von failed lässt pending bestehen und blockiert erneuten Versand.'
    );
}

async function testFallbackResultPersistenceFailure() {
    const harness = createHarness({
        sendError: Object.assign(
            new Error('Cannot send messages to this user'),
            { code: 50007 }
        ),
        failFallbackResultPersistence: true,
    });

    await runCommand(harness);

    assert.equal(harness.state.sendCalls, 1);

    assert.equal(
        harness.state.publicMessages.length,
        1,
        'Die öffentliche Nachricht muss einmal gesendet worden sein.'
    );

    assert.equal(
        harness.state.fallbackAttempts.length,
        1
    );

    assert.equal(
        harness.state.fallbackResults.length,
        1
    );

    assert.equal(
        harness.state.invoice.fallbackNotification.status,
        'pending',
        'Bei fehlgeschlagener Ergebnisspeicherung muss pending erhalten bleiben.'
    );

    await runCommand(harness);

    assert.equal(
        harness.state.sendCalls,
        1,
        'Es darf keine erneute DM gesendet werden.'
    );

    assert.equal(
        harness.state.publicMessages.length,
        1,
        'Es darf keine zweite öffentliche Nachricht gesendet werden.'
    );

    console.log(
        'OK: Fehlgeschlagene Ergebnisspeicherung lässt pending bestehen und verhindert Duplikate.'
    );
}

async function main() {
    console.log('=== ETS-Abrechnungsversand: Integrationstests ===');

    try {
        await testSuccessfulDelivery();
        await testDiscord50007();
        await testSuccessfulPublicFallback();
        await testFallbackIdentityAndChannelGuards();
        await testFallbackReservationPersistenceFailure();
        await testFallbackSendFailure();
        await testFallbackResultPersistenceFailure();
        await testUnknownDiscordError();
        await testDeliveredPersistenceFailure();
        await testFailedPersistenceFailure();

        console.log('');
        console.log('Alle zehn Versandtests erfolgreich.');
    } catch (error) {
        console.error('');
        console.error('TEST FEHLGESCHLAGEN:');
        console.error(error);
        process.exitCode = 1;
    } finally {
        Module._load = originalLoad;
    }
}

main();
