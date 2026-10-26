import React, { useEffect, useState } from 'react';

const countdown = (ms) => {
  if (!Number.isFinite(ms)) return '--:--';
  const seconds = Math.ceil(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  return [hours, Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((v) => String(v).padStart(2, '0')).join(':');
};

export const MixerControl = ({ mixer, wsStatus, connectionStatus = wsStatus, controlAvailable, command, onCommand, compact = false }) => {
  const [now, setNow] = useState(Date.now);
  const [confirmedState, setConfirmedState] = useState(null);
  // Expire displayed state even if USB stops while the WebSocket stays open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const connected = connectionStatus === 'CONNECTED';
  const fresh = connected && mixer && now - mixer.receivedAt <= 2000;
  const canResume = fresh && controlAvailable && mixer.hmi_connected && !mixer.armed && !command?.pending;
  useEffect(() => {
    // Losing eligibility invalidates the operator's earlier clearance.
    if (!canResume) setConfirmedState(null);
  }, [canResume]);
  const identity = mixer ? `${mixer.boot_id}:${mixer.revision}` : '';
  const confirmed = Boolean(canResume && confirmedState === identity);
  const state = !fresh ? 'Status unavailable' : {
    'AUTO PAUSED': 'Paused', 'AUTO WAIT': 'Waiting for next run', 'AUTO FWD': 'Forward output active'
  }[mixer.state];
  const schedule = (
    <p className="mixer-description">
      {fresh ? `${mixer.start_delay_ms / 1000} s start delay · ${mixer.run_duration_ms / 60000} min run · every ${mixer.interval_ms / 3600000} h · forward only.`
        : 'Connect the ESP32 with the web-control firmware to see its live schedule.'}
      {' '}Configured PWM: {fresh ? `${mixer.configured_pwm}/255` : '—'}. Target: {fresh ? mixer.target_rpm : '—'} RPM; actual shaft speed is not measured.
    </p>
  );

  return (
    <section className="card mixer-panel" data-compact={compact} aria-labelledby="mixer-title">
      <div className="card-header">
        <h2 id="mixer-title">Mixer · BTS7960</h2>
        <span className="status-badge">{fresh ? 'Live · USB' : 'Offline / stale'}</span>
      </div>
      <div className="card-body">
        <div className="mixer-overview">
          <div><span className="mixer-label">Firmware state</span><strong>{state}</strong></div>
          <div><span className="mixer-label">Applied PWM</span><strong>{fresh ? `${mixer.output_pwm} / 255` : '—'}</strong></div>
          <div><span className="mixer-label">Nextion interlock</span><strong>{fresh ? (mixer.hmi_connected ? 'Connected' : 'Offline · blocked') : '—'}</strong></div>
          <div><span className="mixer-label">{fresh && mixer.run_remaining_ms > 0 ? 'Run remaining' : 'Next start in'}</span>
            <strong>{fresh && mixer.armed ? countdown(mixer.run_remaining_ms > 0 ? mixer.run_remaining_ms : mixer.next_start_in_ms) : '—'}</strong></div>
        </div>
        {!compact && schedule}
        <div className="mixer-actions">
          <button type="button" className="btn-danger-sm" disabled={!connected || !controlAvailable || (command?.pending && command.action === 'STOP')}
            onClick={() => { setConfirmedState(null); onCommand('STOP'); }}>
            {compact ? 'Stop / pause' : 'Stop / pause auto'}
          </button>
          <button type="button" className="btn-primary" disabled={!confirmed}
            onClick={() => { setConfirmedState(null); onCommand('RESUME'); }}>
            {compact ? 'Resume · 30 s' : 'Resume auto · 30 s delay'}
          </button>
          <label className="mixer-confirm">
            <input type="checkbox" checked={confirmed} disabled={!canResume}
              onChange={(e) => setConfirmedState(e.target.checked ? identity : null)} />
            {compact ? 'Mixer clear; allow scheduled motion' : 'Mixer is clear; allow scheduled motion'}
          </label>
        </div>
        {!controlAvailable && <p className="notice">{compact ? 'Connect USB from this computer’s localhost dashboard to control the mixer.' : 'Controls are available from the local dashboard on the USB-connected computer.'}</p>}
        {controlAvailable && !fresh && <p className="notice is-warn">{compact ? 'Stale data: resume disabled. STOP requires a device acknowledgement.' : 'No fresh mixer data. Resume is disabled. STOP can still be attempted, but its result must be acknowledged.'}</p>}
        {fresh && !mixer.hmi_connected && <p className="notice is-warn">Restore the Nextion page-0 connection before resuming.</p>}
        <div role="status" aria-live="polite" className="mixer-result">
          {command && <p data-error={!command.pending && command.ok === false}>
            <strong>{command.action}: </strong>{command.detail}
          </p>}
        </div>
        {compact ? <>
          <details className="panel-details"><summary>Schedule &amp; safety</summary>
            {schedule}
            <p className="mixer-safety">STOP pauses future runs until an explicit resume.</p>
          </details>
          <p className="mixer-safety">Closing this page does not stop the mixer. Not a physical emergency stop.</p>
        </> : <p className="mixer-safety">The schedule runs on the ESP32 even if this website closes. STOP pauses future runs until an explicit resume. This software control is not a physical emergency stop.</p>}
      </div>
    </section>
  );
};
