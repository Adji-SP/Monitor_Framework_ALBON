// lib/com/fermentorParser.js
// Parses the human-readable USB console output of the Fermentor Kopi ESP32-S3
// firmware (IO-Fermentor-Kopi/Fermentor Rust build and the _legacy_platformio
// C++ build) into one telemetry frame per 5-second sampling block.
//
// The firmware does not emit JSON. Every sample block starts with
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
const LINE = /^([A-Za-z0-9/ ]+?)\s*:\s*(.*)$/;
const NUMBER = /-?\d+(?:\.\d+)?/g;

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
        this.frame = null;
    }

    _set(key, text, pick = 0) {
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

    _emit() {
        if (!this.frame) return;
        const frame = {
            device_id: this.deviceId,
            source: 'fermentor-usb-console',
            timestamp: new Date().toISOString(),
            ...this.frame
        };
        this.frame = null;
        this.onFrame(frame);
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

        if (BLOCK_HEADER.test(line)) {
            // A new block before the last one finished: publish what we have.
            this._emit();
            this.frame = emptyFrame();
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
        if (!this.frame) {
            // Boot lines such as "SCD41 periodic start: OK" arrive before any block.
            this.onEvent({ line, timestamp: new Date().toISOString() });
            return;
        }

        const name = match[1].trim().toUpperCase();
        const text = match[2];

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
                this._emit(); // last line of a Rust block
                break;
            case 'SHT30': // C++: "26.00 C, 54.1 %RH" — last line of a C++ block
                this._setGroup(['sht_temp', 'sht_rh'], text, [0, 1]);
                this._emit();
                break;
            default:
                this.onEvent({ line, timestamp: new Date().toISOString() });
        }
    }
}

FermentorParser.METRIC_KEYS = METRIC_KEYS;
module.exports = FermentorParser;
