import { DEFAULT_BAUD_RATE, isBaudRate } from './serialSettings';

const FermentorParser = require('./shared/fermentorParser');
const { isMixerStatus, u32 } = require('./shared/mixerProtocol');

export const emptySerialStats = () => ({ bytes: 0, lines: 0, frames: 0, connectedAt: null, lastByteAt: null, lastFrameAt: null, device: null, baudRate: null });

// One explicitly chosen port. No automatic reconnect, reset, raw command input,
// queued/replayed control commands, or dependency on a WebSocket server.
export class UsbSerialSession {
  constructor({ serial, onState, onMessage, onStats = () => {}, now = Date.now, canControl = () => false }) {
    this.serial = serial;
    this.onState = onState;
    this.onMessage = onMessage;
    this.onStats = onStats;
    this.stats = emptySerialStats();
    this.now = now;
    this.canControl = canControl;
    this.generation = 0;
    this.status = 'DISCONNECTED';
    this.latest = null;
    this.pending = null;
  }
  state(status, error = null) {
    this.status = status;
    this.onState({ status, error });
  }
  log(type, text) { this.onMessage('SYS', type, { text }); }
  validBaudRate(baudRate) {
    if (isBaudRate(baudRate)) return true;
    const detail = 'Choose a supported baud rate from the serial monitor selector.';
    this.state(this.status, detail);
    this.log('ERROR', detail);
    return false;
  }
  async connect(baudRate = DEFAULT_BAUD_RATE) {
    if (this.disposed || this.status !== 'DISCONNECTED') return;
    if (!this.validBaudRate(baudRate)) return;
    if (!this.serial) { this.state('DISCONNECTED', 'USB serial needs desktop Chrome or Edge on localhost or HTTPS.'); return; }
    const generation = ++this.generation;
    this.state('CONNECTING');
    return this.openPort(baudRate, generation);
  }
  async openPort(baudRate, generation, selectedPort = null) {
    this.stats = emptySerialStats();
    this.onStats({ ...this.stats });
    let port, opened = false;
    try {
      // This call must remain directly in the user's click handler.
      // Let the user select the actual COM device. A hardcoded VID/PID filter
      // hid other USB interfaces/adapters and made a plugged-in board disappear.
      // Refresh reuses only the port the user already chose. Never pick another
      // device or request permission after an asynchronous close operation.
      port = selectedPort || await this.serial.requestPort();
      if (generation !== this.generation || this.disposed) return;
      await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 16384 });
      opened = true;
      if (generation !== this.generation || this.disposed) { await port.close(); return; }
      const session = { port, closing: false, reader: null, writer: port.writable?.getWriter(), buffer: '', discard: false };
      session.parser = new FermentorParser({
        onFrame: (data) => {
          this.stats.frames++;
          this.stats.lastFrameAt = this.now();
          this.onMessage('IN', 'sensor_update', { type: 'sensor_update', data: { ...data, source: 'browser-usb-serial' } });
        },
        onMixer: (message) => this.receiveMixer(message)
      });
      this.connection = session;
      this.latest = null;
      const info = port.getInfo?.() || {};
      const hex = (value) => Number.isInteger(value) ? value.toString(16).toUpperCase().padStart(4, '0') : '????';
      this.stats.connectedAt = this.now();
      this.stats.baudRate = baudRate;
      this.stats.device = info.usbVendorId != null ? `USB ${hex(info.usbVendorId)}:${hex(info.usbProductId)}` : 'Selected serial port';
      this.onStats({ ...this.stats });
      this.state('CONNECTED');
      this.log('CONNECTED', `Direct ESP32 USB serial opened with ${baudRate} baud selected. Native USB Serial/JTAG ignores baud rate; UART devices require matching firmware settings.`);
      session.task = this.read(session);
      return true;
    } catch (error) {
      if (opened) { try { await port.close(); } catch { /* already disconnected */ } }
      if (generation !== this.generation || this.disposed) return;
      const detail = error.name === 'NotFoundError' ? 'No USB port selected. Click Connect USB and choose the ESP32. If it is absent, check the data cable and Windows Device Manager.'
        : ['NotAllowedError', 'SecurityError'].includes(error.name) ? 'Serial permission blocked. Open the dashboard in its own desktop Chrome/Edge tab on localhost or HTTPS, allow Serial ports in site settings, and check the site serial Permissions Policy.'
          : `Cannot open USB serial (${error.name || 'Error'}): ${error.message}. Close serial monitors, other dashboard tabs, and any legacy backend using this port, then try Connect USB again.`;
      this.state('DISCONNECTED', detail);
      this.log('ERROR', detail);
      return false;
    }
  }
  async reconnect(baudRate = DEFAULT_BAUD_RATE) {
    const session = this.connection;
    if (this.disposed || this.status !== 'CONNECTED' || !session || session.closing) return false;
    if (!this.validBaudRate(baudRate)) return false;
    const generation = ++this.generation;
    this.state('RECONNECTING');
    this.log('RECONNECTING', `Applying ${baudRate} baud: releasing and reopening the same USB port. Readings briefly pause; recording stays active. This does not stop the mixer.`);
    session.reopening = true;
    await this.stopReading(session);
    if (generation !== this.generation || this.disposed) return false;
    if (session.closeError) {
      const detail = `Cannot release USB port: ${session.closeError.message}. Reconnect was cancelled; close other monitors and try Connect USB again.`;
      this.state('DISCONNECTED', detail);
      this.log('ERROR', detail);
      return false;
    }
    return this.openPort(baudRate, generation, session.port);
  }
  feed(session, text) {
    for (const piece of text.split(/(\n)/)) {
      if (piece === '\n') {
        if (!session.discard) {
          const line = session.buffer.replace(/\r/g, '').trim();
          if (line) {
            this.stats.lines++;
            this.onMessage('IN', 'device_log', { type: 'device_log', data: { line, timestamp: new Date().toISOString() } });
            session.parser.push(line);
          }
        }
        session.buffer = ''; session.discard = false;
      } else if (!session.discard) {
        if (session.buffer.length + piece.length > 4096) {
          session.buffer = ''; session.discard = true; session.parser.reset();
          this.log('ERROR', 'Oversized USB line discarded; waiting for the next complete sensor block.');
        } else session.buffer += piece;
      }
    }
  }
  async read(session) {
    let error = null;
    try {
      if (!session.port.readable) throw new Error('USB readable stream is unavailable');
      let recoveries = 0;
      while (!session.closing && session.port.readable) {
        const stream = session.port.readable;
        const decoder = new TextDecoder();
        session.reader = stream.getReader();
        try {
          while (!session.closing) {
            const { value, done } = await session.reader.read();
            if (done) break;
            if (this.connection === session && !session.closing && value?.byteLength) {
              recoveries = 0;
              this.stats.bytes += value.byteLength;
              this.stats.lastByteAt = this.now();
              this.feed(session, decoder.decode(value, { stream: true }));
              this.onStats({ ...this.stats });
            }
          }
          break;
        } catch (cause) {
          // Chrome supplies a NEW stream after recoverable framing/overflow
          // errors. Reuse the same open port, never reopen/reset the device.
          if (session.closing) break;
          if (!session.port.readable || session.port.readable === stream || ++recoveries > 3) throw cause;
          session.buffer = ''; session.discard = false; session.parser.reset();
          this.latest = null;
          this.onMessage('IN', 'mixer_status', { type: 'mixer_status', data: null });
          this.finish(false, 'Serial read interrupted; command result unknown.');
          this.log('ERROR', `Serial read interrupted (${cause.message}); reading the replacement stream. Partial sensor block discarded.`);
        } finally {
          session.reader.releaseLock();
          session.reader = null;
        }
      }
      if (!session.closing) error = 'USB connection ended. Reconnect the board and click Connect USB.';
    } catch (cause) {
      if (!session.closing) error = `USB read failed: ${cause.message}. Reconnect with Connect USB.`;
    } finally {
      session.closing = true;
      session.reader?.releaseLock();
      if (this.connection === session) {
        this.latest = null;
        this.finish(false, 'USB disconnected; command result unknown. Check the machine or use its local STOP.');
      }
      try { await session.writer?.abort(); } catch { /* device may already be gone */ }
      session.writer?.releaseLock();
      try { await session.port.close(); } catch (cause) { session.closeError = cause; }
      if (this.connection === session) {
        this.connection = null;
        if (!session.reopening) this.state('DISCONNECTED', error);
        this.log('DISCONNECTED', error || 'USB port released. Disconnecting the dashboard does not stop the mixer.');
      }
    }
  }
  async disconnect() {
    ++this.generation;
    const session = this.connection;
    if (!session) { this.state('DISCONNECTED'); return; }
    this.state('DISCONNECTING');
    session.reopening = false;
    await this.stopReading(session);
  }
  async stopReading(session) {
    session.closing = true;
    this.latest = null;
    this.finish(false, 'USB disconnected; command result unknown. Check the machine or use its local STOP.');
    try { await session.reader?.cancel(); } catch { /* unplugged */ }
    await session.task;
  }
  receiveMixer({ type, data }) {
    if (type === 'STATUS') {
      if (!isMixerStatus(data)) {
        this.latest = null;
        this.onMessage('IN', 'mixer_status', { type: 'mixer_status', data: null });
        return;
      }
      if (this.latest && this.latest.data.boot_id !== data.boot_id) this.finish(false, 'ESP32 restarted; command result unknown.');
      this.latest = { data, receivedAt: this.now() };
      this.onMessage('IN', 'mixer_status', { type: 'mixer_status', data });
    } else if (type === 'ACK' && u32(data?.id) && typeof data.ok === 'boolean' && this.pending?.id === data.id) {
      this.finish(data.ok, data.reason === 'APPLIED' ? 'Confirmed by ESP32.' : `ESP32 rejected command: ${String(data.reason).slice(0, 80)}`);
    }
  }
  finish(ok, detail) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    this.onMessage('IN', 'mixer_command_result', { type: 'mixer_command_result', requestId: String(pending.id), action: pending.action, ok, detail });
  }
  command(action, expected = {}) {
    const session = this.connection;
    if (!['STOP', 'RESUME'].includes(action) || this.status !== 'CONNECTED' || !session?.writer || !this.canControl()) return false;
    const data = this.latest?.data;
    if (action === 'RESUME') {
      if (!data || this.now() - this.latest.receivedAt > 2000 || !data.hmi_connected || data.armed || this.pending
        || expected.bootId !== data.boot_id || expected.revision !== data.revision) return false;
    } else {
      if (this.pending?.action === 'STOP') return false;
      this.finish(false, 'Superseded by STOP; check live status.');
    }
    const id = crypto.getRandomValues(new Uint32Array(1))[0];
    const message = { type: 'mixer_command', requestId: String(id), action, bootId: data?.boot_id, revision: data?.revision };
    this.pending = { id, action, timer: setTimeout(() => this.finish(false, 'No ESP32 acknowledgement. Result unknown; check the machine or use its local STOP.'), 4000) };
    this.onMessage('OUT', 'mixer_command', message);
    const line = `MIXER ${id} ${action} ${data?.boot_id || 0} ${data?.revision || 0} ${data ? data.uptime_ms + 3000 : 0}\n`;
    // The stream preserves write order. STOP supersedes pending RESUME results;
    // firmware expiry prevents a buffered RESUME being replayed later.
    session.writer.write(new TextEncoder().encode(line)).catch((error) => {
      if (this.pending?.id === id) this.finish(false, `USB write failed; result unknown: ${error.message}`);
    });
    return true;
  }
  dispose() {
    this.disposed = true;
    this.onState = () => {};
    this.onMessage = () => {};
    this.onStats = () => {};
    void this.disconnect();
  }
}
