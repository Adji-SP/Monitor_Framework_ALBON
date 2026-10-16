// App/Http/Controllers/recordsController.js - Fermentation session recorder (CSV + python plot)
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const RECORDS_DIR = path.join(__dirname, '../../../records');
const PLOT_SCRIPT = path.join(__dirname, '../../../scripts/plot_session.py');
const PYTHON_BIN = process.env.PYTHON_BIN || 'py';
const { RecordingStore } = require('../../../lib/recordingStore');
const recordingStore = new RecordingStore(RECORDS_DIR);

// Matches the Fermentor Kopi firmware sensor set (src/fermentorMetrics.js); empty cell = sensor not OK.
const FIELDS = [
    'timestamp', 'process_temp', 'o2', 'ph', 'co2', 'scd_temp', 'scd_rh',
    'sht_temp', 'sht_rh', 'pressure', 'ph_mv', 'pressure_v', 'device_id'
];

function toCsvValue(v) {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function runPlotScript(csvPath, pngPath) {
    return new Promise((resolve, reject) => {
        const proc = spawn(PYTHON_BIN, [PLOT_SCRIPT, csvPath, pngPath], { windowsHide: true });
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(stderr.trim() || `plot script exited with code ${code}`));
        });
    });
}

async function createRecord(req, res) {
    const { samples, startedAt, stoppedAt } = req.body;

    if (!Array.isArray(samples) || samples.length === 0) {
        return res.status(400).json({ success: false, error: 'No samples provided.' });
    }

    const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionDir = path.join(RECORDS_DIR, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    const csvPath = path.join(sessionDir, 'session.csv');
    const pngPath = path.join(sessionDir, 'plot.png');

    const lines = [FIELDS.join(',')];
    for (const s of samples) {
        const row = { ...s, ...(s.raw || {}) };
        lines.push(FIELDS.map((f) => toCsvValue(row[f])).join(','));
    }
    fs.writeFileSync(csvPath, lines.join('\n'), 'utf-8');

    const meta = { sessionId, startedAt, stoppedAt, sampleCount: samples.length };
    fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2));

    try {
        await runPlotScript(csvPath, pngPath);
        return res.json({
            success: true,
            sessionId,
            sampleCount: samples.length,
            csvUrl: `/records/${sessionId}/session.csv`,
            plotUrl: `/records/${sessionId}/plot.png`
        });
    } catch (err) {
        console.error('Plot script failed:', err.message);
        return res.json({
            success: true,
            sessionId,
            sampleCount: samples.length,
            csvUrl: `/records/${sessionId}/session.csv`,
            plotUrl: null,
            plotError: err.message
        });
    }
}

function listRecords(req, res) {
    if (!fs.existsSync(RECORDS_DIR)) return res.json({ success: true, sessions: [] });

    const sessions = fs.readdirSync(RECORDS_DIR)
        .filter((name) => fs.statSync(path.join(RECORDS_DIR, name)).isDirectory())
        .sort()
        .reverse()
        .map((sessionId) => {
            const metaPath = path.join(RECORDS_DIR, sessionId, 'meta.json');
            let meta = {};
            try { if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); }
            catch { meta = { state: 'incomplete', error: 'Session metadata could not be read.' }; }
            const activeSession = recordingStore.sessions.get(sessionId);
            if (meta.state === 'recording' && (!activeSession || Date.now() - activeSession.lastActivity > 300000)) meta.state = 'interrupted';
            const videoFile = ['dashboard.webm', 'dashboard.mp4'].find((name) => fs.existsSync(path.join(RECORDS_DIR, sessionId, name)));
            const hasPlot = fs.existsSync(path.join(RECORDS_DIR, sessionId, 'plot.png'));
            return {
                sessionId,
                ...meta,
                csvUrl: `/records/${sessionId}/session.csv`,
                plotUrl: hasPlot ? `/records/${sessionId}/plot.png` : null,
                videoUrl: videoFile ? `/records/${sessionId}/${videoFile}` : null
            };
        });

    res.json({ success: true, sessions });
}

module.exports = {
    createRecord,
    listRecords,
    recordingStore,
    async generatePlot(req, res) {
        const id = req.params.id;
        if (!/^[a-f0-9-]{36}$/.test(id) || recordingStore.sessions.has(id)) {
            return res.status(400).json({ success: false, error: 'Stop a valid session before plotting.' });
        }
        try {
            await runPlotScript(path.join(RECORDS_DIR, id, 'session.csv'), path.join(RECORDS_DIR, id, 'plot.png'));
            res.json({ success: true, plotUrl: `/records/${id}/plot.png` });
        } catch (error) { res.status(500).json({ success: false, error: `Plot generation failed: ${error.message}` }); }
    },
    // New filesystem writes are only accepted from the local dashboard.
    localRecorder(req, res, next) {
        const origins = (process.env.RECORDING_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map((v) => v.trim());
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !origins.includes(req.headers.origin)) {
            return res.status(403).json({ success: false, error: 'Recording writes require the local dashboard origin.' });
        }
        next();
    },
    recordingAction(action) {
        return async (req, res) => {
            try { res.json(await action(req)); }
            catch (error) { res.status(error.status || 500).json({ success: false, error: error.status ? error.message : 'Could not save recording to disk.' }); }
        };
    }
};
