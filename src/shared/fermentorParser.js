// Shared USB console parser used by the browser and the optional Node bridge.
// Parses the human-readable USB console output of the Fermentor Kopi ESP32-S3
// firmware (IO-Fermentor-Kopi/Fermentor Rust build and the _legacy_platformio
// C++ build), plus the headerless DS18B20...siklus selesai cycles observed on USB.
//
// The original firmware does not emit JSON. Original sample blocks start with
//   ================ SENSOR READINGS ================
// followed by "<NAME padded to 10>: <value> <unit>" or "<NAME>: WAIT|OFFLINE|ERROR".
//
// Rust (src/main.rs):            C++ legacy (src/main.cpp):
//   DS18B20   : 25.12 C            DS18B20   : 25.12 C
//   pH input  : 1500.0 mV          pH        : 7.00 (1500.0 mV)
//   pH/ADS    : 7.00 pH            Pressure  : 12.3 kPa = 0.123 bar (0.541 V)
//   Pressure in: 0.541 V           O2        : 20.90 %Vol
//   Pressure  : 0.123 bar          SCD41     : CO2 612 ppm, 26.10 C, 55.2 %RH
//   O2        : 20.90 %Vol         SHT30     : 26.00 C, 54.1 %RH
//   CO2       : 612.00 ppm
//   SCD41 T   : 26.10 C
//   SCD41 RH  : 55.20 %RH
//   SHT30 T   : 26.00 C
//   SHT30 RH  : 54.10 %RH

const METRIC_KEYS = [
    'process_temp', 'ph', 'pressure', 'o2', 'co2',
    'scd_temp', 'scd_rh', 'sht_temp', 'sht_rh'
];

const STATUS_WORDS = ['WAIT', 'OFFLINE', 'ERROR'];

const BLOCK_HEADER = /=+\s*SENSOR READINGS\s*=+/;
const CYCLE_END = /^-+\s*siklus selesai\s*-+$/i;
const LINE = /^([A-Za-z0-9/ ]+?)\s*:\s*(.*)$/;
const NUMBER = /-?\d+(?:\.\d+)?/g;
const CSV_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
// Confirmed by the user's complete DATA row and labelled sensor output.
// DATA,<counter>,<these nine measurements>,<metadata>. Counter/metadata are
// deliberately NOT interpreted as sensor values or motor-control status.
const CSV_KEYS = ['process_temp', 'ph', 'pressure', 'o2', 'co2', 'scd_temp', 'scd_rh', 'sht_temp', 'sht_rh'];

function emptyFrame() {
    const metrics = {};
    const status = {};
    for (const key of METRIC_KEYS) {
        metrics[key] = null;
        status[key] = 'WAIT';
    }
    return { metrics, status, raw: { ph_mv: null, pressure_v: null } };
}

function statusOf(text) {
    const word = text.trim().split(/\s+/)[0].toUpperCase();
    return STATUS_WORDS.includes(word) ? word : null;
}

function numbers(text) {
    return (text.match(NUMBER) || []).map(Number);
}

class FermentorParser {
    constructor({ deviceId = 'FERMENTOR_KOPI_ESP32S3', onFrame, onEvent, onMixer } = {}) {
        this.deviceId = deviceId;
        this.onFrame = onFrame || (() => {});
        this.onEvent = onEvent || (() => {});
        this.onMixer = onMixer || (() => {});
        this.reset();
    }

    reset() {
        this.frame = null;
        this.seen = new Set();
        this.explicitBlock = false;
        this.awaitingCsv = null;
    }

    _start(explicitBlock = false) {
        this.frame = emptyFrame();
        this.seen = new Set();
        this.explicitBlock = explicitBlock;
        this.awaitingCsv = null;
    }

    _set(key, text, pick = 0) {
        this.seen.add(key);
        const status = statusOf(text);
        if (status) {
            this.frame.metrics[key] = null;
            this.frame.status[key] = status;
            return;
        }
        const value = numbers(text)[pick];
        if (Number.isFinite(value)) {
            this.frame.metrics[key] = value;
            this.frame.status[key] = 'OK';
        } else {
            this.frame.metrics[key] = null;
            this.frame.status[key] = 'ERROR';
        }
    }

    _setGroup(keys, text, picks) {
        const status = statusOf(text);
        const values = numbers(text);
        keys.forEach((key, i) => {
            this.seen.add(key);
            if (status) {
                this.frame.metrics[key] = null;
                this.frame.status[key] = status;
            } else if (Number.isFinite(values[picks[i]])) {
                this.frame.metrics[key] = values[picks[i]];
                this.frame.status[key] = 'OK';
            } else {
                this.frame.metrics[key] = null;
                this.frame.status[key] = 'ERROR';
            }
        });
    }

    _emit(fromText = true) {
        if (!this.frame || !this.seen.size) return;
        // Object.assign keeps this dual-use CommonJS module free of Babel's
        // ESM object-spread helper when compiled by Create React App.
        const frame = Object.assign({
            device_id: this.deviceId,
            source: 'fermentor-usb-console',
            timestamp: new Date().toISOString()
        }, this.frame);
        this.awaitingCsv = fromText && this.seen.size === METRIC_KEYS.length ? frame : null;
        this.frame = null;
        this.onFrame(frame);
    }

    _csv(line) {
        const cells = line.split(',').map((cell) => cell.trim());
        if (cells.length !== 12 || !/^\d+$/.test(cells[1]) || !/^\d+$/.test(cells[11])) {
            this.onEvent({ line: 'Unsupported DATA row layout; expected counter, nine measurements and metadata.', timestamp: new Date().toISOString() });
            return;
        }
        const candidate = emptyFrame();
        CSV_KEYS.forEach((key, i) => {
            const cell = cells[i + 2];
            const value = CSV_NUMBER.test(cell) ? Number(cell) : NaN;
            candidate.metrics[key] = Number.isFinite(value) ? value : null;
            candidate.status[key] = Number.isFinite(value) ? 'OK' : STATUS_WORDS.includes(cell.toUpperCase()) ? cell.toUpperCase() : 'ERROR';
        });
        // Firmware prints both representations of one sample. Retain the text
        // frame (including ADC voltages/statuses) instead of appending it twice.
        const previous = this.awaitingCsv;
        this.awaitingCsv = null;
        if (previous && CSV_KEYS.every((key) => previous.status[key] !== 'OK'
            || candidate.metrics[key] === previous.metrics[key])) return;

        // If attached mid-cycle, the self-contained CSV can still recover all
        // values. Preserve raw inputs from any labelled lines already received.
        if (this.frame) {
            candidate.raw = this.frame.raw;
            for (const key of this.seen) {
                if (this.frame.status[key] !== 'OK') {
                    candidate.metrics[key] = null;
                    candidate.status[key] = this.frame.status[key];
                }
            }
        }
        this.frame = candidate;
        this.seen = new Set(CSV_KEYS);
        this._emit(false);
    }

    // Feed one console line (without delimiter).
    push(rawLine) {
        const line = String(rawLine).replace(/\r/g, '').trim();
        if (!line) return;

        // Mixer messages may arrive between sensor lines. Their countdowns/PWM
        // are never sensor readings and must not finish a sensor frame.
        const mixer = /^\[MIXER_(STATUS|ACK)\] (\{.*\})$/.exec(line);
        if (mixer) {
            try { this.onMixer({ type: mixer[1], data: JSON.parse(mixer[2]) }); }
            catch { this.onEvent({ line: 'Invalid mixer USB message', timestamp: new Date().toISOString() }); }
            return;
        }

        if (line.startsWith('DATA,')) { this._csv(line); return; }
        if (CYCLE_END.test(line)) { this._emit(); return; }

        if (BLOCK_HEADER.test(line)) {
            // A new block before the last one finished: publish what we have.
            this._emit();
            this._start(true);
            return;
        }

        // Diagnostics outside the reading lines, e.g. "[MOTOR] STOP: Nextion keepalive timeout",
        // "[O2] Bus(NoAcknowledge(Address))", "[OK] ADS1115 0x48", "=== Fermentor Kopi ... ===".
        if (line.startsWith('[') || line.startsWith('===')) {
            this.onEvent({ line, timestamp: new Date().toISOString() });
            return;
        }

        const match = LINE.exec(line);
        if (!match) {
            this.onEvent({ line, timestamp: new Date().toISOString() });
            return;
        }
        const name = match[1].trim().toUpperCase();
        const text = match[2];
        // A real DS18B20 reading/status is also a cycle boundary. Do not start
        // from boot diagnostics such as "DS18B20: initialized on GPIO12".
        const cycleStart = name === 'DS18B20' && (statusOf(text)
            || /^\s*-?\d+(?:\.\d+)?\s*°?C\b/i.test(text));
        if (cycleStart && (!this.frame || this.seen.has('process_temp'))) {
            this._emit();
            this._start();
        }
        if (!this.frame) {
            // Boot lines such as "SCD41 periodic start: OK" arrive before any block.
            this.onEvent({ line, timestamp: new Date().toISOString() });
            return;
        }

        switch (name) {
            case 'DS18B20':
                this._set('process_temp', text);
                break;
            case 'PH INPUT': // Rust: raw millivolts
                this.frame.raw.ph_mv = numbers(text)[0] ?? null;
                break;
            case 'PH/ADS': // Rust pH value, or C++ "pH/ADS : OFFLINE (0x48)" for pH + pressure
                this._set('ph', text);
                if (statusOf(text) === 'OFFLINE') this._set('pressure', text);
                break;
            case 'PH': // C++: "7.00 (1500.0 mV)"
                this._set('ph', text);
                if (!statusOf(text)) this.frame.raw.ph_mv = numbers(text)[1] ?? null;
                break;
            case 'PRESSURE IN': // Rust: raw volts
                this.frame.raw.pressure_v = numbers(text)[0] ?? null;
                break;
            case 'PRESSURE':
                if (/kPa/.test(text)) {
                    // C++: "12.3 kPa = 0.123 bar (0.541 V)"
                    this._set('pressure', text, 1);
                    this.frame.raw.pressure_v = numbers(text)[2] ?? null;
                } else {
                    this._set('pressure', text);
                    const voltage = /\(\s*(-?\d+(?:\.\d+)?)\s*V\s*\)/i.exec(text);
                    if (voltage) this.frame.raw.pressure_v = Number(voltage[1]);
                }
                break;
            case 'O2':
                this._set('o2', text);
                break;
            case 'CO2':
                this._set('co2', text);
                break;
            case 'SCD41 T':
                this._set('scd_temp', text);
                break;
            case 'SCD41 RH':
                this._set('scd_rh', text);
                break;
            case 'SCD41': // C++: "CO2 612 ppm, 26.10 C, 55.2 %RH" — drop the "CO2" word so its 2 is not a value
                this._setGroup(['co2', 'scd_temp', 'scd_rh'], text.replace(/^\s*CO2\s*/i, ''), [0, 1, 2]);
                break;
            case 'SHT30 T':
                this._set('sht_temp', text);
                break;
            case 'SHT30 RH':
                this._set('sht_rh', text);
                if (this.explicitBlock) this._emit(); // last line of the original Rust block
                break;
            case 'SHT30': // Some C++ cycles print SCD41 AFTER this line.
                this._setGroup(['sht_temp', 'sht_rh'], text, [0, 1]);
                break;
            default:
                this.onEvent({ line, timestamp: new Date().toISOString() });
        }
        if (this.frame && this.seen.size === METRIC_KEYS.length) this._emit();
    }
}

FermentorParser.METRIC_KEYS = METRIC_KEYS;
module.exports = FermentorParser;
