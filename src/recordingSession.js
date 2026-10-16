// Upload small CSV batches and video chunks while recording, not hours of RAM.
const API = 'http://localhost:3001';
const MIME_TYPES = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

export class RecordingSession {
  constructor(onChange) {
    this.onChange = onChange;
    this.status = 'idle';
    this.stream = null; this.media = null; this.stopPromise = null;
    this.events = []; this.tail = Promise.resolve();
    this.state = { sampleCount: 0, eventCount: 0, videoBytes: 0, startedAt: null, error: null, result: null };
  }
  update(extra = {}) {
    this.state = { ...this.state, ...extra };
    this.onChange({ ...this.state, status: this.status, isRecording: this.status === 'recording' });
  }
  async request(route, body, binary = false) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(`${API}/api/recordings${route}`, { method: 'POST', signal: abort.signal,
        headers: { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' },
        body: binary ? body : JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `Recording server returned ${response.status}`);
      return data;
    } finally { clearTimeout(timeout); }
  }
  async start(withVideo = true) {
    if (['starting', 'recording', 'stopping'].includes(this.status)) return;
    this.status = 'starting';
    this.failure = null; this.stopPromise = null; this.session = null;
    this.mediaFinished = null; this.mediaStarted = false;
    this.batches = 0; this.videoParts = 0; this.buffered = 0;
    this.events = []; this.tail = Promise.resolve();
    this.update({ sampleCount: 0, eventCount: 0, videoBytes: 0, startedAt: null, error: null, result: null, videoEnabled: withVideo });
    try {
      let mime = null;
      if (withVideo) {
        if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
          throw new Error('Dashboard video is unavailable in this browser. Use desktop Chrome/Edge on localhost or choose CSV only.');
        }
        mime = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
        if (!mime) throw new Error('No supported video encoder. Choose CSV only or another browser.');
        // Must happen from the button gesture, before any network await.
        this.stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 10, max: 15 }, width: { max: 1280 }, height: { max: 720 } },
          audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', monitorTypeSurfaces: 'exclude'
        });
        if (this.disposed) throw new Error('Recording cancelled because the dashboard closed.');
        this.media = new MediaRecorder(this.stream, { mimeType: mime, videoBitsPerSecond: 1000000 });
        mime = this.media.mimeType || mime;
      }
      this.session = await this.request('', { videoMime: mime });
      if (this.disposed) throw new Error('Recording cancelled because the dashboard closed.');
      this.startClock = performance.now();
      this.status = 'recording';
      this.update({ startedAt: new Date().toISOString() });
      if (this.media) {
        const track = this.stream.getVideoTracks()[0];
        if (!track || track.readyState === 'ended') throw new Error('Screen sharing ended before recording started.');
        this.media.ondataavailable = (event) => this.addVideo(event.data);
        this.media.onerror = () => this.fail('The browser video recorder failed. Earlier saved data is retained.');
        this.mediaFinished = new Promise((resolve) => { this.mediaStopped = resolve; });
        this.media.onstop = () => {
          this.mediaStopped?.();
          if (this.status === 'recording') void this.stop();
        };
        track.onended = () => { void this.stop(); };
        this.media.start(2000);
        this.mediaStarted = true;
      }
      this.capture('SYS', 'SESSION_START', { video: withVideo });
      this.flushTimer = setInterval(() => this.flush(), 1000);
    } catch (error) {
      if (this.session) { this.failure = error.message; await this.stop(); }
      else {
        this.release(); this.status = 'error';
        this.update({ error: error.name === 'NotAllowedError' ? 'Screen sharing was cancelled or denied. Nothing was recorded.' : error.message });
      }
    }
  }
  capture(direction, type, message) {
    if (this.status !== 'recording') return;
    let kind;
    if (direction === 'IN' && ['sensor_update', 'telemetry', 'sensor_data', 'data'].includes(type)
        && (message?.data?.metrics || message?.payload?.metrics || message?.metrics)) kind = 'sensor';
    else if (direction === 'IN' && type === 'mixer_status') kind = 'mixer';
    else if (type === 'mixer_command' || type === 'mixer_command_result') kind = 'command';
    else if (direction === 'IN' && type === 'device_log') kind = 'log';
    else if (direction === 'SYS') kind = type.startsWith('SESSION_') ? 'session' : 'connection';
    else return; // Never record handshake/authentication secrets.
    const event = { type: kind, timestamp: new Date().toISOString(), elapsed_ms: Math.max(0, performance.now() - this.startClock),
      message: { direction, type, ...(typeof message === 'object' && message !== null ? message : { text: message }) } };
    this.events.push(event);
    this.update({ eventCount: this.state.eventCount + 1, sampleCount: this.state.sampleCount + (kind === 'sensor' ? 1 : 0) });
    if (this.events.length >= 100) this.flush();
  }
  enqueue(route, body, binary = false) {
    if (this.failure) return;
    const size = binary ? body.size : JSON.stringify(body).length * 2;
    this.buffered += size;
    if (this.buffered > 32 * 1024 * 1024) { this.fail('Saving is too slow: recording stopped at the 32 MiB upload buffer limit.'); return; }
    this.tail = this.tail.then(async () => {
      if (this.failure) return;
      const saved = await this.request(`/${this.session.sessionId}${route}`, body, binary);
      this.update({ videoBytes: saved.videoBytes });
    }).catch((error) => this.fail(`Recording stopped: ${error.message}. Previously saved files remain in Run history.`))
      .finally(() => { this.buffered -= size; });
  }
  flush() {
    if (!this.events.length || !this.session) return;
    const events = this.events.splice(0, 100);
    this.enqueue(`/events/${this.batches++}`, { events });
  }
  addVideo(blob) {
    if (!blob?.size || this.failure) return;
    // Browsers can produce a large final chunk after sleep/backgrounding.
    if (blob.size + this.buffered > 32 * 1024 * 1024) { this.fail('Video capture stalled and exceeded the upload buffer. Saved files are retained.'); return; }
    for (let offset = 0; offset < blob.size; offset += 512 * 1024) {
      this.enqueue(`/video/${this.videoParts++}`, blob.slice(offset, offset + 512 * 1024), true);
    }
  }
  fail(message) {
    if (!this.failure) this.failure = message;
    this.update({ error: this.failure });
    void this.stop();
  }
  stop() {
    if (this.stopPromise) return this.stopPromise;
    if (!this.session) return Promise.resolve();
    this.capture('SYS', 'SESSION_STOP', { reason: this.failure || 'Operator stopped recording or screen sharing.' });
    this.status = 'stopping'; this.update(); clearInterval(this.flushTimer);
    this.stopPromise = (async () => {
      if (this.media && this.mediaStarted) {
        let timeout;
        try {
          if (this.media.state !== 'inactive') this.media.stop();
          await Promise.race([this.mediaFinished, new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Video finalization timed out; video may be incomplete.')), 5000);
          })]);
        } catch (error) { this.failure ||= error.message; }
        finally { clearTimeout(timeout); }
      }
      this.release();
      while (this.events.length) this.flush();
      await this.tail; // Includes the final video chunk, before /stop.
      try {
        const result = await this.request(`/${this.session.sessionId}/stop`, {
          batches: this.batches, videoParts: this.videoParts, error: this.failure
        });
        this.status = result.state === 'complete' ? 'done' : 'error';
        this.update({ result, error: result.error || this.failure });
      } catch (error) {
        this.status = 'error';
        this.update({ error: `Finalization failed: ${error.message}. Check Run history for partial files.` });
      }
    })();
    return this.stopPromise;
  }
  release() {
    if (this.stream) for (const track of this.stream.getTracks()) { track.onended = null; track.stop(); }
    this.stream = null; this.media = null;
  }
  dispose() {
    this.disposed = true; this.onChange = () => {};
    clearInterval(this.flushTimer);
    if (this.session && ['recording', 'stopping'].includes(this.status)) void this.stop();
    else this.release();
  }
}
