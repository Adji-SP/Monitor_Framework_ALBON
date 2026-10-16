const test = require('node:test');
const assert = require('node:assert/strict');
const MixerBridge = require('../lib/com/mixerBridge');
const Parser = require('../lib/com/fermentorParser');
const WebSocketHandler = require('../lib/com/webSocketCommunicator');

const status = (extra = {}) => ({ version: 1, driver: 'BTS7960', boot_id: 42, revision: 2,
    uptime_ms: 10000, state: 'AUTO PAUSED', armed: false, output_pwm: 0, configured_pwm: 64,
    target_rpm: 3, measured_rpm: null, hmi_connected: true, next_start_in_ms: 0,
    run_remaining_ms: 0, start_delay_ms: 30000, run_duration_ms: 120000, interval_ms: 21600000, ...extra });
const client = { ip: '127.0.0.1', origin: 'http://localhost:3000', isAuthenticated: true, clientType: 'application' };
const request = (action = 'RESUME', extra = {}) => ({ type: 'mixer_command', requestId: 'test_1', action, bootId: 42, revision: 2, ...extra });
function rig(options = {}) {
    let time = 1000;
    const writes = [], replies = [], broadcasts = [];
    const serial = { isConnected: () => true, writeMixerCommand: async (line) => writes.push(line) };
    const bridge = new MixerBridge({ getSerial: () => serial, broadcast: (s) => broadcasts.push(s), now: () => time, ...options });
    const parser = new Parser({ onMixer: (m) => bridge.receive(m) });
    const feed = (data = status()) => parser.push(`[MIXER_STATUS] ${JSON.stringify(data)}`);
    const ack = (index = 0, ok = true) => parser.push(`[MIXER_ACK] ${JSON.stringify({ id: Number(writes[index].split(' ')[1]), ok, reason: ok ? 'APPLIED' : 'EXPIRED' })}`);
    return { bridge, parser, serial, writes, replies, broadcasts, feed, ack,
        advance: (ms) => { time += ms; }, command: (req = request(), who = client) => bridge.command(req, who, (r) => replies.push(r)) };
}

test('serial telemetry -> validated RESUME -> firmware ACK; never an optimistic success', async () => {
    const r = rig(); r.feed();
    await r.command();
    assert.match(r.writes[0], /^MIXER \d+ RESUME 42 2 13000$/);
    assert.equal(r.replies.length, 0);
    r.ack();
    assert.equal(r.replies[0].ok, true);
    assert.equal(r.broadcasts[0].data.measured_rpm, null);
    assert.equal(r.bridge.pending.size, 0);
});

test('STOP preempts resume, ignores its late ACK and is allowed with stale/missing telemetry', async () => {
    const r = rig(); r.feed(); await r.command();
    r.advance(9000); await r.command(request('STOP', { requestId: 'stop_2' }));
    assert.equal(r.replies[0].ok, false);
    assert.match(r.writes[1], / STOP /);
    r.ack(0); assert.equal(r.replies.length, 1);
    r.ack(1); assert.equal(r.replies[1].ok, true);
    r.bridge.connectionChanged('disconnected');
    await r.command(request('STOP', { requestId: 'stop_3' }));
    r.ack(2); assert.equal(r.replies[2].ok, true);
});

test('stale status, reboot/revision mismatch, HMI offline, armed state and invalid actions block RESUME', async () => {
    for (const [data, req, age] of [
        [status(), request(), 2001], [status(), request('RESUME', { bootId: 41 }), 0],
        [status(), request('RESUME', { revision: 1 }), 0], [status({ hmi_connected: false }), request(), 0],
        [status({ armed: true, state: 'AUTO WAIT' }), request(), 0], [status(), request('SPEED:255'), 0]
    ]) {
        const r = rig(); r.feed(data); r.advance(age); await r.command(req);
        assert.equal(r.writes.length, 0); assert.equal(r.replies[0].ok, false);
    }
    const r = rig(); await r.command(); assert.equal(r.writes.length, 0);
});

test('physical commands reject other origins, LAN clients, unauthenticated peers and non-application clients', async () => {
    for (const override of [{ origin: 'https://evil.example' }, { origin: '' }, { ip: '192.168.1.4' },
        { isAuthenticated: false }, { clientType: 'microcontroller' }]) {
        const r = rig(); r.feed(); await r.command(request('STOP'), { ...client, ...override });
        assert.equal(r.writes.length, 0); assert.equal(r.replies[0].ok, false);
    }
});

test('timeouts/negative ACK/serial failure/reboot/disconnect do not retry or claim success', async () => {
    const r = rig({ ackTimeout: 10 }); r.feed(); await r.command();
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(r.replies[0].ok, false); assert.equal(r.writes.length, 1);
    r.ack(); assert.equal(r.replies.length, 1);
    const n = rig(); n.feed(); await n.command(); n.ack(0, false); assert.equal(n.replies[0].ok, false);
    const d = rig(); d.feed(); await d.command(); d.bridge.connectionChanged('disconnected');
    assert.equal(d.replies[0].ok, false); assert.equal(d.bridge.latest, null);
    const b = rig(); b.feed(); await b.command(); b.feed(status({ boot_id: 43 })); assert.equal(b.replies[0].ok, false);
    const f = rig(); f.feed(); f.serial.writeMixerCommand = async () => { throw new Error('port closed'); };
    await f.command(); assert.equal(f.replies[0].ok, false); assert.equal(f.bridge.pending.size, 0);
    const o = rig(); o.serial.isConnected = () => false;
    await o.command(request('STOP')); assert.equal(o.writes.length, 0);
});

test('malformed/partial mixer messages do not manufacture sensor readings; O2 warm-up remains WAIT', () => {
    const frames = [], mixer = [];
    const p = new Parser({ onFrame: (f) => frames.push(f), onMixer: (m) => mixer.push(m) });
    ['================ SENSOR READINGS ================', 'DS18B20 : 24.88 C',
        '[MIXER_STATUS] {bad}', `[MIXER_STATUS] ${JSON.stringify(status())}`, 'pH/ADS : 4.01 pH',
        'O2 : WAIT (WARMUP 02:59)', 'CO2 : 656 ppm', 'SHT30 RH : 59.2 %RH'].forEach((s) => p.push(s));
    assert.equal(frames.length, 1); assert.equal(mixer.length, 1);
    assert.equal(frames[0].metrics.process_temp, 24.88); assert.equal(frames[0].metrics.ph, 4.01);
    assert.equal(frames[0].metrics.o2, null); assert.equal(frames[0].status.o2, 'WAIT');
    const r = rig(); r.feed(status({ output_pwm: 256 })); assert.equal(r.bridge.latest, null);
    r.feed(status({ uptime_ms: -1 })); assert.equal(r.bridge.latest, null);
});

test('WebSocket dispatcher routes only mixer_command to the same bridge', async () => {
    const r = rig(); r.feed();
    const handler = new WebSocketHandler({ logLevel: 'error' }, null, null);
    handler.mixerControl = r.bridge;
    const sent = [], ws = { readyState: 1, send: (s) => sent.push(JSON.parse(s)) };
    handler._handleClientMessage(ws, { ...client, dataReceived: 0 }, Buffer.from(JSON.stringify(request())));
    assert.equal(r.writes.length, 1); assert.equal(sent.length, 0);
    r.ack(); assert.equal(sent[0].type, 'mixer_command_result'); assert.equal(sent[0].ok, true);
});
