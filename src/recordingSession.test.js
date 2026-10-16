import { RecordingSession } from './recordingSession';

let calls, stream, track, session;
class FakeRecorder {
  static isTypeSupported = () => true;
  constructor(_stream, { mimeType }) { this.mimeType = mimeType; this.state = 'inactive'; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    Promise.resolve().then(() => { this.ondataavailable({ data: new Blob(['final-video']) }); this.onstop(); });
  }
}
const sensor = { type: 'sensor_update', data: { timestamp: '2026-10-16T00:00:00Z', metrics: { ph: 7 }, status: { ph: 'OK' } } };
beforeEach(() => {
  calls = []; track = { readyState: 'live', stop: jest.fn() };
  stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: jest.fn(async () => stream) } });
  global.MediaRecorder = FakeRecorder;
  global.fetch = jest.fn(async (url, options) => {
    calls.push({ url, body: options.headers['Content-Type'] === 'application/json' ? JSON.parse(options.body) : options.body });
    const result = { success: true, sessionId: 'test-id', videoBytes: 11, state: 'complete', csvUrl: '/csv', videoUrl: '/video' };
    return { ok: true, json: async () => result };
  });
  session = new RecordingSession(jest.fn());
});
afterEach(async () => { if (session.status === 'recording') await session.stop(); session.dispose(); });

test('start requests dashboard with no audio; capture all frames, not cached placeholders; stop waits for final video', async () => {
  session.capture('IN', 'sensor_update', sensor); expect(session.events.length).toBe(0);
  await session.start(true);
  expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false, preferCurrentTab: true }));
  session.capture('IN', 'sensor_update', sensor);
  session.capture('IN', 'sensor_update', sensor); // even frames with identical timestamps are retained
  session.capture('IN', 'mixer_status', { type: 'mixer_status', data: { state: 'AUTO WAIT', output_pwm: 0 } });
  session.capture('OUT', 'mixer_command', { action: 'STOP' });
  session.capture('SYS', 'DISCONNECTED', 'USB/WebSocket lost');
  session.capture('OUT', 'auth', { token: 'do-not-record' });
  const stopped = session.stop(); expect(session.stop()).toBe(stopped); await stopped;
  expect(session.state.sampleCount).toBe(2);
  expect(calls.some((c) => c.url.includes('/video/0'))).toBe(true);
  expect(calls.at(-1).url).toMatch(/\/stop$/);
  expect(calls.at(-1).body.videoParts).toBe(1);
  expect(JSON.stringify(calls)).not.toContain('do-not-record');
  expect(track.stop).toHaveBeenCalled(); expect(session.status).toBe('done');
});

test('screen-picker cancellation creates no server session and no CSV-only fallback', async () => {
  navigator.mediaDevices.getDisplayMedia.mockRejectedValue(Object.assign(new Error('Denied'), { name: 'NotAllowedError' }));
  await session.start(true);
  expect(session.status).toBe('error'); expect(calls.length).toBe(0); expect(session.state.error).toContain('Nothing was recorded');
});

test('CSV only works without MediaRecorder, and screen sharing ending stops both outputs', async () => {
  delete global.MediaRecorder;
  await session.start(false); session.capture('IN', 'sensor_update', sensor); await session.stop();
  expect(navigator.mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
  expect(calls[0].body.videoMime).toBeNull();
  global.MediaRecorder = FakeRecorder; await session.start(true);
  track.onended(); await session.stopPromise;
  expect(session.status).toBe('done');
});

test('upload failures retain partial files and report error, never saved success', async () => {
  await session.start(true);
  const normalFetch = global.fetch;
  global.fetch = jest.fn((url, options) => {
    if (url.includes('/video/')) return Promise.reject(new Error('Disk unavailable'));
    if (url.endsWith('/stop')) return Promise.resolve({ ok: true, json: async () => ({ success: true, state: 'incomplete', error: 'Disk unavailable' }) });
    return normalFetch(url, options);
  });
  await session.stop(); expect(session.status).toBe('error'); expect(track.stop).toHaveBeenCalled();
  expect(session.state.error).toContain('Disk unavailable');
});

test('disposed pending permission never starts a server session', async () => {
  let approve;
  navigator.mediaDevices.getDisplayMedia.mockImplementation(() => new Promise((resolve) => { approve = resolve; }));
  const pending = session.start(true); session.dispose(); approve(stream); await pending;
  expect(calls.length).toBe(0); expect(track.stop).toHaveBeenCalled();
});
