// Incremental session files: bounded batches/chunks, no client-chosen paths.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const METRICS = ['process_temp', 'o2', 'ph', 'co2', 'scd_temp', 'scd_rh', 'sht_temp', 'sht_rh', 'pressure'];
const MIXER = ['state', 'armed', 'output_pwm', 'configured_pwm', 'target_rpm', 'measured_rpm', 'hmi_connected',
    'next_start_in_ms', 'run_remaining_ms', 'start_delay_ms', 'run_duration_ms', 'interval_ms', 'uptime_ms', 'boot_id', 'revision'];
const FIELDS = ['timestamp', 'elapsed_ms', 'record_type', 'source_timestamp', 'device_id', ...METRICS,
    ...METRICS.map((k) => `${k}_status`), 'ph_mv', 'pressure_v', ...MIXER.map((k) => `mixer_${k}`), 'event_json'];
const validId = (id) => /^[a-f0-9-]{36}$/.test(id);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function cell(value) {
    if (value == null) return '';
    let s = String(value);
    // Prevent spreadsheet formula execution without altering numeric negatives.
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(event) {
    const payload = event.message?.data || event.message?.payload || event.message || {};
    const values = { timestamp: event.timestamp, elapsed_ms: event.elapsed_ms,
        record_type: event.type, source_timestamp: payload.timestamp, device_id: payload.device_id,
        event_json: JSON.stringify(event.message) };
    if (event.type === 'sensor') {
        for (const key of METRICS) {
            values[`${key}_status`] = payload.status?.[key] || 'WAIT';
            values[key] = values[`${key}_status`] === 'OK' && Number.isFinite(payload.metrics?.[key]) ? payload.metrics[key] : null;
        }
        values.ph_mv = payload.raw?.ph_mv;
        values.pressure_v = payload.raw?.pressure_v;
    }
    if (event.type === 'mixer') for (const key of MIXER) values[`mixer_${key}`] = payload[key];
    return FIELDS.map((key) => cell(values[key])).join(',') + '\r\n';
}

class RecordingStore {
    constructor(directory) { this.directory = directory; this.sessions = new Map(); }
    async start({ videoMime = null } = {}) {
        if (videoMime !== null && (typeof videoMime !== 'string' || videoMime.length > 100 || !/^video\/(webm|mp4)(;.*)?$/.test(videoMime))) throw fail('Unsupported video type.');
        // A crashed/closed browser must not permanently consume an active slot.
        for (const [id, session] of this.sessions) {
            if (Date.now() - session.lastActivity > 300000) {
                await session.tail;
                session.meta.state = 'interrupted';
                session.meta.error = 'No upload activity for five minutes. Saved files may be partial.';
                await this.saveMeta(session);
                this.sessions.delete(id);
            }
        }
        if (this.sessions.size >= 8) throw fail('Too many active recordings. Stop an existing session first.', 409);
        const sessionId = randomUUID();
        const dir = path.join(this.directory, sessionId);
        await fs.mkdir(dir, { recursive: true });
        const meta = { sessionId, startedAt: new Date().toISOString(), state: 'recording', sampleCount: 0,
            eventCount: 0, videoBytes: 0, videoMime, videoFile: videoMime ? (videoMime.startsWith('video/mp4') ? 'dashboard.mp4' : 'dashboard.webm') : null,
            batches: 0, videoParts: 0 };
        const session = { dir, meta, tail: Promise.resolve(), last: {}, lastActivity: Date.now() };
        this.sessions.set(sessionId, session);
        try {
            await fs.writeFile(path.join(dir, 'session.csv'), FIELDS.join(',') + '\r\n', { flag: 'wx' });
            await this.saveMeta(session);
        } catch (error) { this.sessions.delete(sessionId); throw error; }
        return this.result(meta);
    }
    async saveMeta(session) {
        const file = path.join(session.dir, 'meta.json');
        await fs.writeFile(file + '.tmp', JSON.stringify(session.meta, null, 2));
        await fs.rename(file + '.tmp', file);
    }
    result(meta) {
        return { success: true, ...meta, csvUrl: `/records/${meta.sessionId}/session.csv`,
            videoUrl: meta.videoBytes > 0 ? `/records/${meta.sessionId}/${meta.videoFile}` : null };
    }
    withSession(id, action) {
        if (!validId(id)) return Promise.reject(fail('Invalid session ID.'));
        const session = this.sessions.get(id);
        if (!session) return Promise.reject(fail('Recording is no longer active. Saved files remain in history.', 409));
        const work = session.tail.then(() => {
            if (session.meta.state !== 'recording') throw fail('Session already stopped.', 409);
            session.lastActivity = Date.now();
            return action(session);
        });
        session.tail = work.catch(() => {});
        return work;
    }
    append(id, kind, sequence, body) {
        return this.withSession(id, async (session) => {
            if (!Number.isSafeInteger(sequence) || sequence < 0) throw fail('Invalid sequence.');
            const counter = kind === 'video' ? 'videoParts' : 'batches';
            let bytes;
            if (kind === 'video') {
                if (!session.meta.videoFile || !Buffer.isBuffer(body) || body.length === 0 || body.length > 2 * 1024 * 1024) throw fail('Invalid video chunk.');
                if (session.meta.videoBytes + body.length > 16 * 1024 ** 3) throw fail('16 GiB video session limit reached.', 413);
                bytes = body;
            } else {
                if (!Array.isArray(body) || !body.length || body.length > 100) throw fail('Expected 1–100 events.');
                for (const event of body) {
                    if (!event || !['sensor', 'mixer', 'command', 'connection', 'log', 'session'].includes(event.type)
                        || !Number.isFinite(Date.parse(event.timestamp)) || !Number.isFinite(event.elapsed_ms) || event.elapsed_ms < 0
                        || !event.message || JSON.stringify(event).length > 32768) throw fail('Invalid event.');
                }
                bytes = Buffer.from(body.map(row).join(''));
            }
            const hash = createHash('sha256').update(bytes).digest('hex');
            if (sequence === session.meta[counter] - 1 && session.last[kind] === hash) return this.result(session.meta);
            if (sequence !== session.meta[counter]) throw fail('Out-of-order recording chunk.', 409);
            await fs.appendFile(path.join(session.dir, kind === 'video' ? session.meta.videoFile : 'session.csv'), bytes);
            session.last[kind] = hash;
            session.meta[counter]++;
            if (kind === 'video') session.meta.videoBytes += bytes.length;
            else {
                session.meta.eventCount += body.length;
                session.meta.sampleCount += body.filter((event) => event.type === 'sensor').length;
            }
            await this.saveMeta(session);
            return this.result(session.meta);
        });
    }
    finish(id, { batches, videoParts, error = null } = {}) {
        return this.withSession(id, async (session) => {
            const meta = session.meta;
            meta.stoppedAt = new Date().toISOString();
            meta.error = error ? String(error).slice(0, 500) : null;
            if (batches !== meta.batches || videoParts !== meta.videoParts) meta.error ||= 'Some recording chunks were not saved.';
            if (meta.videoFile && !meta.videoBytes) meta.error ||= 'No video data received.';
            meta.state = meta.error ? 'incomplete' : 'complete';
            await this.saveMeta(session);
            this.sessions.delete(id);
            return this.result(meta);
        });
    }
}
module.exports = { RecordingStore, FIELDS, row, cell };
