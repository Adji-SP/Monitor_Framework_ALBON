// Physical controls only accept local dashboard origins/peers. No arbitrary
// USB passthrough, automatic retries, persisted commands or simulated ACKs.
const { randomInt } = require('node:crypto');
const uint = (n, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const u32 = (n) => uint(n, 0xffffffff);
const isStatus = (s) => s && s.version === 1 && s.driver === 'BTS7960'
    && u32(s.boot_id) && u32(s.revision) && uint(s.uptime_ms)
    && ['AUTO PAUSED', 'AUTO WAIT', 'AUTO FWD'].includes(s.state)
    && typeof s.armed === 'boolean' && typeof s.hmi_connected === 'boolean'
    && uint(s.output_pwm, 255) && uint(s.configured_pwm, 255)
    && uint(s.target_rpm, 255) && s.measured_rpm === null
    && ['next_start_in_ms', 'run_remaining_ms', 'start_delay_ms', 'run_duration_ms', 'interval_ms'].every((k) => uint(s[k]));

class MixerBridge {
    constructor({ getSerial, broadcast, now = Date.now, ackTimeout = 4000,
        origins = process.env.MIXER_CONTROL_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000' }) {
        this.getSerial = getSerial;
        this.broadcast = broadcast;
        this.now = now;
        this.ackTimeout = ackTimeout;
        this.origins = new Set(origins.split(',').map((s) => s.trim()));
        this.latest = null;
        this.pending = new Map();
    }
    canControl(client) {
        return client.isAuthenticated && client.clientType === 'application'
            && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(client.ip)
            && this.origins.has(client.origin);
    }
    connectionChanged(state) {
        if (state === 'connected') return;
        this.latest = null;
        for (const pending of this.pending.values()) pending.finish(false, 'Serial link lost; result unknown. Check the machine.');
        this.broadcast({ type: 'mixer_status', data: null });
    }
    receive({ type, data }) {
        if (type === 'STATUS' && isStatus(data)) {
            if (this.latest && this.latest.data.boot_id !== data.boot_id) {
                for (const pending of this.pending.values()) pending.finish(false, 'ESP32 restarted; result unknown.');
            }
            this.latest = { data, receivedAt: this.now() };
            this.broadcast({ type: 'mixer_status', data });
        } else if (type === 'ACK' && u32(data?.id) && typeof data.ok === 'boolean') {
            this.pending.get(data.id)?.finish(data.ok, data.reason === 'APPLIED'
                ? 'Confirmed by ESP32.' : `ESP32 rejected command: ${String(data.reason).slice(0, 80)}`);
        }
    }
    async command(message, client, reply) {
        const { requestId, action } = message;
        const respond = (ok, detail) => reply({ type: 'mixer_command_result', requestId, action, ok, detail });
        if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(requestId)) {
            respond(false, 'Invalid request ID.'); return;
        }
        if (!this.canControl(client)) {
            respond(false, 'Controls require an authenticated local dashboard with an allowed origin.'); return;
        }
        if (!['STOP', 'RESUME'].includes(action)) {
            respond(false, 'Only STOP and RESUME are supported.'); return;
        }
        const serial = this.getSerial();
        if (!serial?.isConnected()) { respond(false, 'ESP32 serial port is disconnected.'); return; }
        const status = this.latest?.data;
        if (action === 'RESUME') {
            if (!status || this.now() - this.latest.receivedAt > 2000) {
                respond(false, 'Fresh mixer telemetry required. Flash the web-control firmware and check USB.'); return;
            }
            if (message.bootId !== status.boot_id || message.revision !== status.revision) {
                respond(false, 'Mixer state changed. Review the live state and try again.'); return;
            }
            if (!status.hmi_connected || status.armed) {
                respond(false, status.armed ? 'Automatic schedule is already armed.' : 'Nextion is offline. Resume is blocked.'); return;
            }
            if (this.pending.size) { respond(false, 'Wait for the previous command result.'); return; }
        } else {
            // STOP preempts resume; late ACKs cannot supersede the newer STOP.
            for (const pending of this.pending.values()) pending.finish(false, 'Superseded by STOP; check live status.');
        }
        let id;
        do { id = randomInt(1, 0x100000000); } while (this.pending.has(id));
        const expires = status ? status.uptime_ms + 3000 : 0;
        const line = `MIXER ${id} ${action} ${status?.boot_id || 0} ${status?.revision || 0} ${expires}`;
        const pending = { finish: (ok, detail) => {
            if (!this.pending.delete(id)) return;
            clearTimeout(pending.timer);
            respond(ok, detail);
        } };
        this.pending.set(id, pending);
        pending.timer = setTimeout(() => pending.finish(false,
            'No ESP32 acknowledgement. Result unknown; check the machine or use its local STOP.'), this.ackTimeout);
        try { await serial.writeMixerCommand(line); }
        catch (error) { pending.finish(false, `USB write failed: ${error.message}`); }
    }
}
module.exports = MixerBridge;
