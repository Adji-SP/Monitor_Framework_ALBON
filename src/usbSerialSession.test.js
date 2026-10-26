import { UsbSerialSession } from './usbSerialSession';
const { ReadableStream, WritableStream } = require('node:stream/web');
const { TextEncoder, TextDecoder } = require('node:util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const status = (overrides = {}) => ({ version: 1, driver: 'BTS7960', boot_id: 42, revision: 2, uptime_ms: 10000,
  state: 'AUTO PAUSED', armed: false, output_pwm: 0, configured_pwm: 64, target_rpm: 3, measured_rpm: null,
  hmi_connected: true, next_start_in_ms: 0, run_remaining_ms: 0, start_delay_ms: 30000, run_duration_ms: 120000, interval_ms: 21600000, ...overrides });
const sensorBlock = '================ SENSOR READINGS ================\r\nDS18B20   : 28.62 C\r\npH input   : 1448.8 mV\r\npH/ADS    : 7.29 pH\r\nPressure in: 0.508 V\r\nPressure  : 0.03 bar\r\n[O2] Bus(NoAcknowledge(Data))\r\nO2        : OFFLINE\r\nCO2       : OFFLINE\r\nSCD41 T   : OFFLINE\r\nSCD41 RH  : OFFLINE\r\nSHT30 T   : 28.55 C\r\nSHT30 RH  : 92.60 %RH\r\n';

const fakePort = () => {
  const port = { writes: [] };
  port.open = jest.fn(async () => {
    port.readable = new ReadableStream({ start(controller) { port.controller = controller; } });
    port.writable = new WritableStream({ write(bytes) { port.writes.push(new TextDecoder().decode(bytes)); } });
  });
  port.close = jest.fn(async () => { expect(port.readable.locked).toBe(false); expect(port.writable.locked).toBe(false); });
  port.feed = (line) => port.controller.enqueue(new TextEncoder().encode(line));
  return port;
};
let session;
const setup = (options = {}) => {
  const port = fakePort();
  const serial = { requestPort: jest.fn(async () => port) };
  const messages = [], states = [], stats = [];
  session = new UsbSerialSession({ serial, onState: (state) => states.push(state), onStats: (value) => stats.push(value), onMessage: (...args) => messages.push(args), canControl: () => true, ...options });
  return { port, serial, messages, states, stats };
};
beforeEach(() => { jest.useFakeTimers(); let id = 100; global.crypto = { getRandomValues: jest.fn((array) => { array[0] = id++; return array; }) }; });
afterEach(async () => { await session?.disconnect(); jest.restoreAllMocks(); jest.useRealTimers(); });

test('USB permission is explicit; fragmented Rust output yields the same sensor frame and raw inputs', async () => {
  const { port, serial, messages, states, stats } = setup();
  expect(serial.requestPort).not.toHaveBeenCalled();
  await session.connect();
  expect(serial.requestPort).toHaveBeenCalledWith(); // No VID/PID whitelist hiding the user's COM device.
  expect(port.open).toHaveBeenCalledWith(expect.objectContaining({ baudRate: 115200, flowControl: 'none' }));
  for (let i = 0; i < sensorBlock.length; i += 7) port.feed(sensorBlock.slice(i, i + 7));
  for (let i = 0; i < 100; i++) await flush();
  const frames = messages.filter(([, type]) => type === 'sensor_update');
  expect(frames).toHaveLength(1);
  const frame = frames[0][2].data;
  expect(frame.metrics).toMatchObject({ process_temp: 28.62, ph: 7.29, pressure: 0.03, o2: null, co2: null, sht_temp: 28.55, sht_rh: 92.6 });
  expect(frame.raw).toEqual({ ph_mv: 1448.8, pressure_v: 0.508 });
  expect(frame.status.o2).toBe('OFFLINE'); expect(states.at(-1).status).toBe('CONNECTED');
  expect(stats.at(-1)).toMatchObject({ bytes: new TextEncoder().encode(sensorBlock).length, lines: 13, frames: 1 });
  expect(port.writes).toEqual([]); // Reading must not start, stop or reset a motor.
  await session.disconnect(); expect(port.close).toHaveBeenCalledTimes(1);
});

test('permission-policy failure gives browser/site guidance, not a misleading port-busy error', async () => {
  const { serial, states } = setup();
  serial.requestPort.mockRejectedValueOnce(Object.assign(new Error('blocked'), { name: 'SecurityError' }));
  await session.connect();
  expect(states.at(-1).error).toContain('Permissions Policy');
  expect(states.at(-1).error).not.toContain('Close serial monitors');
});

test('raw bytes without newlines are visible in counters; a new connection resets diagnostics', async () => {
  const { port, serial, stats } = setup();
  port.getInfo = () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 });
  await session.connect();
  port.feed('booting'); await flush();
  expect(stats.at(-1)).toMatchObject({ bytes: 7, lines: 0, frames: 0, device: 'USB 10C4:EA60' });
  expect(port.writes).toEqual([]);
  await session.disconnect();
  serial.requestPort.mockResolvedValueOnce(fakePort()); await session.connect();
  expect(stats.at(-1)).toMatchObject({ bytes: 0, lines: 0, frames: 0 });
});

test('recoverable read errors release the old stream, discard partial frames and continue without reopening USB', async () => {
  const { port, messages, states } = setup(); await session.connect();
  const previous = port.readable;
  port.feed('================ SENSOR READINGS ================\nDS18B20 : 99 C\n'); await flush();
  const controller = port.controller;
  port.readable = new ReadableStream({ start(c) { port.controller = c; } });
  controller.error(new Error('Buffer overrun')); await flush();
  expect(previous.locked).toBe(false);
  port.feed('SHT30 RH: 12 %RH\n'); port.feed(sensorBlock); await flush();
  expect(port.open).toHaveBeenCalledTimes(1);
  expect(port.writes).toEqual([]);
  expect(states.at(-1).status).toBe('CONNECTED');
  expect(messages.filter(([, type]) => type === 'sensor_update')).toHaveLength(1);
  expect(messages.find(([, type]) => type === 'sensor_update')[2].data.metrics.process_temp).toBe(28.62);
});

test('cancelled permission and busy ports give actionable errors without automatic retries', async () => {
  const { serial, states } = setup();
  serial.requestPort.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'NotFoundError' }));
  await session.connect(); expect(states.at(-1).error).toContain('No USB port selected');
  const port = fakePort(); port.open.mockRejectedValueOnce(new Error('Access denied'));
  serial.requestPort.mockResolvedValueOnce(port);
  await session.connect(); expect(states.at(-1).error).toContain('Close serial monitors');
  jest.advanceTimersByTime(10000); expect(serial.requestPort).toHaveBeenCalledTimes(2);
});

test('oversized lines are discarded and recovery waits for a complete new block', async () => {
  const { port, messages } = setup(); await session.connect();
  port.feed('================ SENSOR READINGS ================\n' + 'x'.repeat(5000));
  port.feed('SHT30 RH: 99 %RH\n'); port.feed(sensorBlock); await flush();
  expect(messages.filter(([, type]) => type === 'sensor_update')).toHaveLength(1);
  expect(messages.some(([, type, payload]) => type === 'ERROR' && payload.text.includes('Oversized'))).toBe(true);
});

test('RESUME requires fresh matching state and HMI; only an exact firmware ACK confirms it', async () => {
  const { port, messages } = setup(); await session.connect();
  expect(session.command('RESUME', { bootId: 42, revision: 2 })).toBe(false);
  session.receiveMixer({ type: 'STATUS', data: status() });
  expect(session.command('RESUME', { bootId: 41, revision: 2 })).toBe(false);
  expect(session.command('RESUME', { bootId: 42, revision: 1 })).toBe(false);
  expect(session.command('RESUME', { bootId: 42, revision: 2 })).toBe(true);
  await flush(); expect(port.writes).toEqual(['MIXER 100 RESUME 42 2 13000\n']);
  expect(messages.some(([, type]) => type === 'mixer_command_result')).toBe(false);
  session.receiveMixer({ type: 'ACK', data: { id: 999, ok: true, reason: 'APPLIED' } }); expect(session.pending).not.toBeNull();
  session.receiveMixer({ type: 'ACK', data: { id: 100, ok: true, reason: 'APPLIED' } });
  expect(messages.at(-1)[2]).toMatchObject({ ok: true, detail: 'Confirmed by ESP32.' });
  jest.advanceTimersByTime(2500); expect(session.command('RESUME', { bootId: 42, revision: 2 })).toBe(false);
  session.receiveMixer({ type: 'STATUS', data: status({ hmi_connected: false }) });
  expect(session.command('RESUME', { bootId: 42, revision: 2 })).toBe(false);
});

test('STOP supersedes RESUME, late ACKs cannot override it, and timeouts never retry', async () => {
  const { port, messages } = setup(); await session.connect();
  session.receiveMixer({ type: 'STATUS', data: status() });
  session.command('RESUME', { bootId: 42, revision: 2 });
  expect(session.command('STOP')).toBe(true); expect(session.command('STOP')).toBe(false);
  session.receiveMixer({ type: 'ACK', data: { id: 100, ok: true, reason: 'APPLIED' } });
  expect(session.pending.action).toBe('STOP');
  jest.advanceTimersByTime(4000); await flush();
  expect(messages.at(-1)[2]).toMatchObject({ action: 'STOP', ok: false });
  expect(messages.at(-1)[2].detail).toContain('Result unknown');
  expect(port.writes).toHaveLength(2);
  expect(session.command('STOP')).toBe(true); // STOP remains available with stale data.
});

test('unplug clears pending state, releases stream locks and does not replay on reconnect', async () => {
  const { port, serial, messages, states } = setup(); await session.connect();
  session.receiveMixer({ type: 'STATUS', data: status() }); session.command('RESUME', { bootId: 42, revision: 2 });
  port.controller.error(new Error('device removed')); await flush();
  expect(states.at(-1).status).toBe('DISCONNECTED'); expect(session.latest).toBeNull(); expect(session.pending).toBeNull();
  expect(messages.some(([, type, payload]) => type === 'mixer_command_result' && payload.ok === false)).toBe(true);
  const next = fakePort(); serial.requestPort.mockResolvedValueOnce(next); await session.connect();
  expect(next.writes).toEqual([]); expect(session.command('RESUME', { bootId: 42, revision: 2 })).toBe(false);
});

test('reboot, malformed status, non-local origins and unmount while choosing fail closed', async () => {
  const { messages } = setup(); await session.connect();
  session.receiveMixer({ type: 'STATUS', data: status() }); session.command('RESUME', { bootId: 42, revision: 2 });
  session.receiveMixer({ type: 'STATUS', data: status({ boot_id: 43 }) });
  expect(messages.some(([, type, payload]) => type === 'mixer_command_result' && payload.detail.includes('restarted'))).toBe(true);
  session.receiveMixer({ type: 'STATUS', data: { version: 1 } }); expect(session.latest).toBeNull();
  session.canControl = () => false; expect(session.command('STOP')).toBe(false);
  await session.disconnect();
  let choose; const port = fakePort(); session.serial.requestPort.mockImplementationOnce(() => new Promise((resolve) => { choose = resolve; }));
  const connecting = session.connect(); session.dispose(); choose(port); await connecting;
  expect(port.open).not.toHaveBeenCalled();
});

test('failed USB writes report failure instead of success and no later retry is scheduled', async () => {
  const { messages } = setup(); await session.connect();
  session.connection.writer.write = jest.fn().mockRejectedValue(new Error('device removed'));
  const write = session.connection.writer.write;
  expect(session.command('STOP')).toBe(true); await flush();
  expect(messages.at(-1)[2]).toMatchObject({ action: 'STOP', ok: false });
  expect(messages.at(-1)[2].detail).toContain('USB write failed');
  jest.advanceTimersByTime(10000); expect(write).toHaveBeenCalledTimes(1);
});

test('chosen baud is applied only on explicit refresh, reusing the port with unlocked streams and no commands', async () => {
  const { port, serial, messages, states, stats } = setup();
  await session.connect(9600);
  expect(port.open).toHaveBeenCalledWith(expect.objectContaining({ baudRate: 9600 }));
  port.feed(sensorBlock); await flush();
  expect(stats.at(-1).frames).toBe(1);
  port.feed('================ SENSOR READINGS ================\nDS18B20 : 99 C\n'); await flush();
  const reader = port.readable, writer = port.writable;
  const refreshing = session.reconnect(57600);
  expect(session.status).toBe('RECONNECTING');
  expect(session.command('STOP')).toBe(false);
  await session.reconnect(230400); await session.connect(230400); // Ignore double clicks during close/open.
  expect(await refreshing).toBe(true);
  expect(serial.requestPort).toHaveBeenCalledTimes(1);
  expect(port.close).toHaveBeenCalledTimes(1);
  expect(reader.locked).toBe(false); expect(writer.locked).toBe(false);
  expect(port.open).toHaveBeenCalledTimes(2);
  expect(port.open).toHaveBeenLastCalledWith(expect.objectContaining({ baudRate: 57600 }));
  expect(stats.at(-1)).toMatchObject({ bytes: 0, frames: 0, baudRate: 57600 });
  expect(states.at(-1)).toEqual({ status: 'CONNECTED', error: null });
  port.feed('SHT30 RH : 10 %RH\n'); await flush();
  expect(stats.at(-1).frames).toBe(0); // Never complete an old partial frame across baud changes.
  port.feed(sensorBlock); await flush();
  expect(stats.at(-1).frames).toBe(1);
  expect(messages.filter(([, type]) => type === 'sensor_update')).toHaveLength(2);
  expect(port.writes).toEqual([]);
  await session.reconnect(57600); // Refresh is useful even when the rate is unchanged.
  expect(port.open).toHaveBeenCalledTimes(3);
});

test('unsupported baud rates never touch the port, including on an existing connection', async () => {
  const { serial, port, states } = setup();
  for (const baud of [0, -9600, 12.5, NaN, '9600', {}, 12345]) await session.connect(baud);
  expect(serial.requestPort).not.toHaveBeenCalled();
  await session.connect(); await session.reconnect(12345);
  expect(port.close).not.toHaveBeenCalled();
  expect(port.open).toHaveBeenCalledTimes(1);
  expect(states.at(-1)).toMatchObject({ status: 'CONNECTED', error: expect.stringContaining('supported baud rate') });
});

test('failed re-open stays disconnected with an error and does not retry or replay motor commands', async () => {
  const { port, states, messages, serial } = setup(); await session.connect();
  session.receiveMixer({ type: 'STATUS', data: status() }); session.command('STOP'); await flush();
  port.open.mockRejectedValueOnce(new Error('Unsupported driver baud rate'));
  expect(await session.reconnect(230400)).toBe(false);
  expect(states.at(-1)).toMatchObject({ status: 'DISCONNECTED', error: expect.stringContaining('Unsupported driver baud rate') });
  expect(session.latest).toBeNull(); expect(session.pending).toBeNull();
  expect(messages.some(([, type, payload]) => type === 'mixer_command_result' && payload.ok === false)).toBe(true);
  jest.advanceTimersByTime(10000); await flush();
  expect(port.open).toHaveBeenCalledTimes(2); expect(serial.requestPort).toHaveBeenCalledTimes(1);
  expect(port.writes).toHaveLength(1);
});

test('failed close prevents reopening and disposal during close cancels refresh', async () => {
  const { port, states } = setup(); await session.connect();
  port.close.mockRejectedValueOnce(new Error('Port busy'));
  expect(await session.reconnect(9600)).toBe(false);
  expect(states.at(-1).error).toContain('Cannot release USB port');
  expect(port.open).toHaveBeenCalledTimes(1);
  await session.connect();
  let release;
  port.close.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const refreshing = session.reconnect(57600); await flush();
  session.dispose(); release(); await refreshing; await flush();
  expect(port.open).toHaveBeenCalledTimes(2);
  expect(session.connection).toBeNull();
});

test('disconnect while opening a new baud releases that port instead of adopting a late connection', async () => {
  const { port, states } = setup(); await session.connect();
  let finishOpen;
  port.open.mockImplementationOnce(() => new Promise((resolve) => { finishOpen = resolve; }));
  const refreshing = session.reconnect(57600); await flush();
  await session.disconnect(); finishOpen(); await refreshing;
  expect(states.at(-1).status).toBe('DISCONNECTED');
  expect(session.connection).toBeNull();
  expect(port.close).toHaveBeenCalledTimes(2);
});

test('fragmented user-reported headerless/CSV cycles reach the same telemetry event as Rust blocks', async () => {
  const reported = require('./shared/fixtures/reported-cycle.json');
  const { port, messages, stats } = setup(); await session.connect();
  const capture = reported.csv + '\r\n' + reported.lines.join('\r\n') + '\r\n';
  for (let i = 0; i < capture.length; i += 13) port.feed(capture.slice(i, i + 13));
  for (let i = 0; i < 50; i++) await flush();
  const frames = messages.filter(([, type]) => type === 'sensor_update');
  expect(stats.at(-1).frames).toBe(2);
  expect(frames[1][2].data.metrics).toMatchObject({ ph: 6.38, pressure: 2.280, o2: 21.57, co2: 0, sht_temp: 24.89, scd_temp: 25.28 });
  expect(frames[1][2].data.raw).toEqual({ ph_mv: 1609.5, pressure_v: 1.260 });
  expect(port.writes).toEqual([]);
});
