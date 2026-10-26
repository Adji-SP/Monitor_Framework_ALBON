import React, { useEffect, useState } from 'react';
import { emptySerialStats } from '../usbSerialSession';
import { BAUD_RATES, DEFAULT_BAUD_RATE } from '../serialSettings';

export function serialHint(status, stats, now) {
  if (status === 'CONNECTING') return 'Choose the ESP32 in the browser port picker.';
  if (status === 'RECONNECTING') return 'Applying the selected baud rate and reopening the same USB port. Waiting for new readings.';
  if (status === 'DISCONNECTING') return 'Releasing the USB port.';
  if (status !== 'CONNECTED') return 'Use Connect USB above to read the ESP32. Close other serial monitors and dashboard tabs first.';
  if (!stats.bytes) return now - (stats.connectedAt ?? now) >= 10000
    ? 'Port open, but no bytes received. Check the selected port, data cable and firmware. This Rust firmware prints on native USB Serial/JTAG, not a USB-to-UART adapter.'
    : `Port open with ${stats.baudRate || DEFAULT_BAUD_RATE} baud selected; waiting for the first serial bytes.`;
  if (now - stats.lastByteAt >= 15000) return 'Serial traffic has stopped. Check the board and USB connection; old readings are not live.';
  if (!stats.lines) return 'Bytes are arriving, but no complete text lines yet. Check for newline-terminated text; UART baud rates must match the firmware. Native USB Serial/JTAG ignores baud rate.';
  if (!stats.frames) return 'Serial text is arriving, but no sensor block has been parsed yet. Look for a SENSOR READINGS block, a DS18B20 sensor cycle, or a complete DATA,... row.';
  if (now - stats.lastFrameAt >= 15000) return 'Serial text is arriving, but sensor frames are stale. Inspect the firmware output below.';
  return 'Receiving sensor frames directly from USB. No WebSocket connection is needed.';
}

function lineOf(message) {
  try {
    const payload = JSON.parse(message.payload);
    return message.type === 'device_log' ? payload.data.line : payload.text || message.payload;
  } catch { return message.payload; }
}

export function SerialMonitor({ messages, status, stats = emptySerialStats(), serial }) {
  const [snapshot, setSnapshot] = useState(null);
  const [clearedThrough, setClearedThrough] = useState(0);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const paused = snapshot !== null;
  const busy = ['CONNECTING', 'RECONNECTING', 'DISCONNECTING'].includes(status);
  const live = messages.filter((message) => message.id > clearedThrough && (message.type === 'device_log' || message.direction === 'SYS'));
  const shown = paused ? snapshot : live;
  const clear = () => {
    setClearedThrough(messages.reduce((id, message) => Math.max(id, message.id), clearedThrough));
    if (paused) setSnapshot([]);
  };

  return (
    <section className="card serial-monitor" aria-labelledby="serial-monitor-title">
      <div className="card-header">
        <span id="serial-monitor-title">Serial monitor</span>
        <div className="serial-monitor-actions">
          <span className="muted">{paused ? 'Display paused' : 'Newest first'}</span>
          <button type="button" className="btn-sm" aria-pressed={paused} onClick={() => setSnapshot(paused ? null : live)}>{paused ? 'Resume display' : 'Pause display'}</button>
          <button type="button" className="btn-sm" onClick={clear}>Clear view</button>
          <a className="btn-sm" href="#console">Full console</a>
        </div>
      </div>
      {serial && <div className="serial-monitor-settings">
        <div className="serial-settings-controls">
          <label htmlFor="serial-baud-rate">Baud rate
            <select id="serial-baud-rate" className="pg-input" value={serial.baudRate}
              disabled={busy || !serial.supported} aria-describedby="serial-baud-help"
              onChange={(event) => serial.selectBaudRate(Number(event.target.value))}>
              {BAUD_RATES.map((rate) => <option key={rate} value={rate}>{rate}</option>)}
            </select>
          </label>
          <button type="button" className="btn-sm" onClick={serial.refresh}
            disabled={status !== 'CONNECTED' || !serial.supported || serial.mixerCommand?.pending}>
            {status === 'RECONNECTING' ? 'Reconnecting…' : 'Apply & refresh'}
          </button>
        </div>
        <p id="serial-baud-help" className="serial-settings-help">
          {status === 'CONNECTED'
            ? serial.baudRate !== stats.baudRate ? `Port is still set to ${stats.baudRate} baud. Apply to use ${serial.baudRate}.` : 'Refresh reopens this port without reloading the page.'
            : busy ? 'Wait for the port operation to finish.' : 'Choose a rate, then click Connect USB above.'}
          {' '}Reopening briefly pauses readings, not recording or the mixer.
        </p>
        {serial.mixerCommand?.pending && <p className="serial-settings-help">Wait for the motor command result before refreshing USB.</p>}
        <p className="serial-settings-help">Native USB Serial/JTAG ignores baud rate. UART devices must match their firmware.</p>
        {serial.error && <p className="serial-settings-error" role="alert">{serial.error}</p>}
      </div>}
      <div className="serial-monitor-stats" aria-label="USB receive counters">
        <span>{stats.device || 'No port selected'} · {status === 'CONNECTED' ? `${stats.baudRate || DEFAULT_BAUD_RATE} baud selected` : 'No active connection'}</span>
        <span>{stats.bytes.toLocaleString()} bytes · {stats.lines.toLocaleString()} lines · {stats.frames.toLocaleString()} frames</span>
      </div>
      <div className="console-screen" role="region" aria-label="Raw USB serial output, newest first" tabIndex={0}>
        {shown.length ? shown.map((message) => (
          <div className="console-line" key={message.id}>
            <span className="console-time">{message.timestamp}</span>
            <span className="serial-monitor-direction" data-direction={message.direction}>{message.direction}</span>
            <span className="serial-monitor-line">{lineOf(message)}</span>
          </div>
        )) : <div className="console-empty"><strong>{clearedThrough ? 'View cleared' : 'No serial output yet'}</strong><span className="serial-monitor-empty-hint">{paused ? 'Resume display to see incoming lines.' : 'Incoming firmware lines will appear here.'}</span></div>}
      </div>
      <p className="serial-monitor-hint" role="status">{serialHint(status, stats, now)}</p>
      {paused && <p className="serial-monitor-hint">Only this display is paused. USB reading, gauges and recording continue.</p>}
    </section>
  );
}
