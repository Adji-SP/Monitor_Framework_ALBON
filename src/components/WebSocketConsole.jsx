// src/components/WebSocketConsole.jsx - Remote console (dark screen) + test frame sender
import React, { useState } from 'react';

const SAMPLE_FRAME = {
  type: 'sensor_update',
  data: {
    device_id: 'FERMENTOR_KOPI_ESP32S3',
    metrics: {
      process_temp: 28.5, o2: 20.9, ph: 6.85, co2: 850, scd_temp: 27.1,
      scd_rh: 55.2, sht_temp: 27.0, sht_rh: 54.8, pressure: 0.12
    },
    status: {
      process_temp: 'OK', o2: 'OK', ph: 'OK', co2: 'OK', scd_temp: 'OK',
      scd_rh: 'OK', sht_temp: 'OK', sht_rh: 'OK', pressure: 'OK'
    }
  }
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'device', label: 'Device log' },
  { id: 'frames', label: 'Sensor frames' },
  { id: 'sys', label: 'System' }
];

const matches = (m, filter) => {
  if (filter === 'device') return m.type === 'device_log';
  if (filter === 'frames') return m.type === 'sensor_update';
  if (filter === 'sys') return m.direction === 'SYS';
  return true;
};

// Show the firmware's own console line for device_log frames.
const lineOf = (m) => {
  if (m.type === 'device_log') {
    try { return JSON.parse(m.payload).data.line; } catch (e) { /* fall through */ }
  }
  return m.payload;
};

export const WebSocketConsole = ({ messages, onSendMessage, directSerial = false }) => {
  const [filter, setFilter] = useState('all');
  const [userMsg, setUserMsg] = useState(JSON.stringify(SAMPLE_FRAME, null, 2));
  const [sendError, setSendError] = useState('');

  const shown = messages.filter((m) => matches(m, filter));

  const handleSend = () => {
    try {
      onSendMessage(JSON.parse(userMsg));
      setSendError('');
    } catch (e) {
      setSendError('Invalid JSON: ' + e.message);
    }
  };

  return (
    <div className="grid-split" data-direct-serial={directSerial}>
      <div className="card">
        <div className="card-header">
          <span>Output</span>
          <span className="muted">{shown.length} of {messages.length} lines · newest first</span>
        </div>
        <div className="tabs" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`tab${filter === f.id ? ' active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="console-screen" aria-live="polite">
          {shown.length === 0 ? (
            <div className="console-empty">
              <span>&gt;_</span>
              <strong>No lines yet</strong>
              <p>{directSerial ? 'Click Connect USB to read the ESP32-S3 console directly.' : 'Frames appear when the backend relays the ESP32-S3 USB console.'}</p>
            </div>
          ) : (
            shown.map((m) => (
              <div key={m.id} className="console-line">
                <span className="console-time">{m.timestamp}</span>
                <span className={`console-dir ${m.direction.toLowerCase()}`}>{m.direction}</span>
                <span>{lineOf(m)}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {!directSerial && <div className="card">
        <div className="card-header">Send test frame</div>
        <div className="card-body">
          <label className="field">
            JSON payload
            <textarea className="pg-input" rows="16" value={userMsg} onChange={(e) => setUserMsg(e.target.value)} />
          </label>
          {sendError && <div className="notice is-error">{sendError}</div>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn-primary" type="button" onClick={handleSend}>Send to WebSocket</button>
            <button className="btn-sm" type="button" onClick={() => setUserMsg(JSON.stringify(SAMPLE_FRAME, null, 2))}>Reset</button>
          </div>
          <div className="help-note">
            Same shape the backend builds from the firmware's <strong>SENSOR READINGS</strong> block. The board itself cannot receive commands over USB.
          </div>
        </div>
      </div>}
    </div>
  );
};
