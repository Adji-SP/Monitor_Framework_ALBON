// Verify startup mode without importing a real database, USB port or WebSocket server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function startup(flags = []) {
    const calls = { api: 0, serial: 0, websocket: 0 };
    const dependencies = {
        dotenv: { config() {} },
        './modules/database/databaseManager': class { async initialize() {} getDatabase() { return {}; } },
        './modules/api/apiServer': class { start() { calls.api++; } getPort() { return 3001; } },
        './modules/serial/serialManager': class { async initialize() { calls.serial++; } },
        './modules/websocket/websocketManager': class { async initialize() { calls.websocket++; } },
        './lib/com/mixerBridge': class {}
    };
    const context = vm.createContext({
        require(name) { assert.ok(dependencies[name], `Unexpected dependency: ${name}`); return dependencies[name]; },
        console: { log() {}, error() {} },
        process: { argv: ['node', 'server.js', ...flags],
            env: { USE_SERIAL: 'true', USE_WS: 'true' }, on() {}, exit() { assert.fail('Startup exited unexpectedly'); } }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8') + '\nglobalThis.testServer = serverInstance;', context);
    await new Promise(setImmediate);
    assert.equal(context.testServer.isInitialized, true);
    return calls;
}

test('browser-serial mode leaves USB and WebSocket untouched while starting the storage API', async () => {
    assert.deepEqual(await startup(['--browser-serial']), { api: 1, serial: 0, websocket: 0 });
});
test('plain node server.js never claims the browser serial port, even with legacy environment settings', async () => {
    assert.deepEqual(await startup(), { api: 1, serial: 0, websocket: 0 });
    assert.deepEqual(await startup(['--serial-bridge', '--browser-serial']), { api: 1, serial: 0, websocket: 0 });
});
test('explicit legacy bridge mode retains its existing serial and WebSocket services', async () => {
    assert.deepEqual(await startup(['--serial-bridge']), { api: 1, serial: 1, websocket: 1 });
});
