const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { RecordingStore, FIELDS, row, cell } = require('../lib/recordingStore');
const event = (type, data) => ({ type, timestamp: '2026-10-16T00:00:00Z', elapsed_ms: 1234, message: { type, data } });
const rig = async () => new RecordingStore(await fs.mkdtemp(path.join(os.tmpdir(), 'fermentor-recording-test-')));

test('CSV contains every metric, status, raw voltage and mixer field without inventing readings', () => {
    for (const key of ['ph', 'pressure', 'o2', 'scd_temp', 'sht_rh']) assert.ok(FIELDS.includes(key));
    assert.ok(FIELDS.includes('o2_status')); assert.ok(FIELDS.includes('ph_mv'));
    assert.ok(FIELDS.includes('mixer_output_pwm')); assert.ok(FIELDS.includes('mixer_measured_rpm'));
    const csv = row(event('sensor', { metrics: { ph: 4.01, o2: 99 }, status: { ph: 'OK', o2: 'ERROR' }, raw: { ph_mv: 2031 } }));
    const cells = csv.split(',');
    assert.equal(cells[FIELDS.indexOf('ph')], '4.01'); assert.equal(cells[FIELDS.indexOf('o2')], '');
    assert.equal(cells[FIELDS.indexOf('o2_status')], 'ERROR'); assert.equal(cells[FIELDS.indexOf('ph_mv')], '2031');
    assert.equal(cells[FIELDS.indexOf('mixer_output_pwm')], '');
    const mixer = row(event('mixer', { state: 'AUTO FWD', output_pwm: 64, measured_rpm: null })).split(',');
    assert.equal(mixer[FIELDS.indexOf('ph')], ''); assert.equal(mixer[FIELDS.indexOf('mixer_output_pwm')], '64');
    assert.equal(mixer[FIELDS.indexOf('mixer_measured_rpm')], '');
    assert.equal(cell('=HYPERLINK("unsafe")').startsWith('"\''), true);
    assert.equal(cell(-1.5), '-1.5'); assert.equal(cell('a\rb'), '"a\rb"');
});

test('append files during recording, preserve chunk order, deduplicate exact retries, finish with matching counts', async () => {
    const store = await rig(); const start = await store.start({ videoMime: 'video/webm;codecs=vp8' });
    const id = start.sessionId;
    const events = [event('sensor', { metrics: { ph: 7 }, status: { ph: 'OK' } }), event('mixer', { output_pwm: 0 })];
    await store.append(id, 'events', 0, events);
    const csv = await fs.readFile(path.join(store.directory, id, 'session.csv'), 'utf8');
    assert.equal(csv.split('\r\n').length, 4);
    await store.append(id, 'events', 0, events); // exact retry, not two rows again
    assert.equal(await fs.readFile(path.join(store.directory, id, 'session.csv'), 'utf8'), csv);
    await assert.rejects(store.append(id, 'events', 0, [event('sensor', {})]), /Out-of-order/);
    await assert.rejects(store.append(id, 'video', 2, Buffer.from('bad')), /Out-of-order/);
    await Promise.all([store.append(id, 'video', 0, Buffer.from('first')), store.append(id, 'video', 1, Buffer.from('last'))]);
    assert.equal(await fs.readFile(path.join(store.directory, id, 'dashboard.webm'), 'utf8'), 'firstlast');
    const result = await store.finish(id, { batches: 1, videoParts: 2 });
    assert.equal(result.state, 'complete'); assert.equal(result.sampleCount, 1); assert.equal(result.eventCount, 2);
    assert.equal(result.videoBytes, 9); assert.match(result.videoUrl, /dashboard.webm$/);
    await assert.rejects(store.append(id, 'video', 2, Buffer.from('later')), /no longer active/);
});

test('missing video or missing chunks are marked incomplete; zero-sensor CSV-only session remains usable', async () => {
    const store = await rig(); let start = await store.start({ videoMime: 'video/mp4' });
    const result = await store.finish(start.sessionId, { batches: 0, videoParts: 0 });
    assert.equal(result.state, 'incomplete'); assert.equal(result.videoUrl, null);
    start = await store.start();
    await store.append(start.sessionId, 'events', 0, [event('connection', { text: 'OFFLINE' })]);
    const partial = await store.finish(start.sessionId, { batches: 2, videoParts: 0 });
    assert.equal(partial.state, 'incomplete'); assert.equal(partial.sampleCount, 0);
    start = await store.start();
    assert.equal((await store.finish(start.sessionId, { batches: 0, videoParts: 0 })).state, 'complete');
});

test('path traversal, oversized chunks, invalid events and invalid mime types are rejected', async () => {
    const store = await rig(); const start = await store.start({ videoMime: 'video/webm' });
    await assert.rejects(store.start({ videoMime: '../../outside' }), /Unsupported/);
    await assert.rejects(store.append('../outside', 'video', 0, Buffer.from('x')), /Invalid session/);
    await assert.rejects(store.append(start.sessionId, 'video', 0, Buffer.alloc(2 * 1024 * 1024 + 1)), /Invalid video/);
    await assert.rejects(store.append(start.sessionId, 'events', 0, [null]), /Invalid event/);
    await assert.rejects(store.append(start.sessionId, 'events', 0, Array(101).fill(event('sensor', {}))), /1–100/);
});
