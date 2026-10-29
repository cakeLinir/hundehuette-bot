const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;

class FakeOption {
    constructor() { this.definition = {}; }
    setName(name) { this.definition.name = name; return this; }
    setDescription(description) { this.definition.description = description; return this; }
    setRequired(required) { this.definition.required = required; return this; }
}

class FakeSubcommand extends FakeOption {
    constructor() { super(); this.definition.options = []; }
    addStringOption(callback) {
        const option = new FakeOption();
        callback(option);
        this.definition.options.push(option.definition);
        return this;
    }
}

class FakeSlashCommandBuilder {
    constructor() { this.definition = { options: [] }; }
    setName(name) { this.definition.name = name; return this; }
    setDescription(description) { this.definition.description = description; return this; }
    addSubcommand(callback) {
        const subcommand = new FakeSubcommand();
        callback(subcommand);
        this.definition.options.push({ type: 'subcommand', ...subcommand.definition });
        return this;
    }
}

Module._load = function(request, parent, isMain) {
    if (request === 'discord.js') {
        return { SlashCommandBuilder: FakeSlashCommandBuilder, MessageFlags: { Ephemeral: 64 } };
    }
    if (request.endsWith('/utils/embedBuilder') || request === '../../utils/embedBuilder') {
        return { createEmbed: () => ({}), createErrorEmbed: () => ({}) };
    }
    if (request.endsWith('/utils/moduleManager') || request === '../../utils/moduleManager') {
        return { isModuleEnabled: () => true };
    }
    if (request.endsWith('/utils/logger') || request === '../../utils/logger') {
        return { warn() {}, error() {} };
    }
    if (request.endsWith('/utils/spedvApi') || request === '../../utils/spedvApi') {
        return { fetchUsers() {}, findDriver() {}, isRankAllowed() {}, fetchAboutMe() {}, getLinkOwner() {}, setLink() {} };
    }
    if (request.endsWith('/utils/etsVerification') || request === '../../utils/etsVerification') {
        return { getPending() {}, createPending() {}, clearPending() {}, codeInText() {}, TTL_MS: 1800000 };
    }
    if (request.endsWith('/utils/spedvRoleSync') || request === '../../utils/spedvRoleSync') {
        return { applyRoles() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
};

try {
    const commandPath = path.resolve(__dirname, '../src/commands/community/ets.js');
    delete require.cache[commandPath];
    const command = require(commandPath);
    const definition = command.data.definition;

    assert.equal(definition.name, 'ets');
    assert.equal(definition.options.length, 1);
    assert.equal(definition.options[0].type, 'subcommand');
    assert.equal(definition.options[0].name, 'spedv-name');
    assert.equal(definition.options[0].options.length, 1);
    assert.equal(definition.options[0].options[0].name, 'name');
    assert.equal(definition.options[0].options[0].required, true);
    console.log('OK: /ets has required /ets spedv-name name:<...> structure.');
} finally {
    Module._load = originalLoad;
}
