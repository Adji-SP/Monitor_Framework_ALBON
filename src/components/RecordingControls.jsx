import React, { useEffect, useState } from 'react';
const API = 'http://localhost:3001';

export const RecordingControls = ({ recorder, compact = false, apiStatus }) => {
  const [video, setVideo] = useState(true);
  const [now, setNow] = useState(Date.now);
  const { status, isRecording, sampleCount, eventCount, videoBytes, startedAt, error, result, start, stop } = recorder;
  const busy = ['starting', 'recording', 'stopping'].includes(status);
  useEffect(() => {
    if (!isRecording) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isRecording]);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000)) : 0;
  const duration = [Math.floor(elapsed / 3600), Math.floor((elapsed % 3600) / 60), elapsed % 60].map((n) => String(n).padStart(2, '0')).join(':');
  const videoSize = videoBytes >= 1048576 ? `${(videoBytes / 1048576).toFixed(1)} MiB` : `${((videoBytes || 0) / 1024).toFixed(0)} KiB`;

  return (
    <section className="card recording-panel" data-compact={compact} aria-label="Session recording">
      <div className="card-header"><h2>Record session</h2><span className="status-badge">{status === 'done' ? 'Saved' : status}</span></div>
      <div className="card-body">
        {apiStatus === 'OFFLINE' && <p className="notice">USB readings work without the API. Start the storage API to save CSV/video.</p>}
        <div className="recording-actions">
          <button className="btn-primary" type="button" disabled={busy} onClick={() => start(video)}>Start recording</button>
          <button className="btn-danger-sm" type="button" disabled={!isRecording} onClick={stop}>{compact ? 'Stop & save' : 'Stop recording & save'}</button>
          <label className="recording-option"><input type="checkbox" checked={busy ? (recorder.videoEnabled ?? video) : video} disabled={busy} onChange={(e) => setVideo(e.target.checked)} /> Include dashboard video</label>
          <span className="recording-stats">{isRecording ? `${duration} · ` : ''}{sampleCount || 0} {compact ? 'frames' : 'sensor frames'} · {eventCount || 0} events · {videoSize} {compact ? 'saved' : 'video saved'}</span>
        </div>
        {compact ? <details className="panel-details"><summary>CSV &amp; video details</summary>
          <p>CSV includes all incoming sensor values, statuses, raw voltages, mixer updates and control events. For video, choose this dashboard tab in the sharing prompt. No audio is recorded. Recording does not start or stop the mixer.</p>
        </details> : <p>CSV includes all incoming sensor values, statuses, raw voltages, mixer updates and control events. For video, choose this dashboard tab in the sharing prompt. No audio is recorded.</p>}
        <div role="status" aria-live="polite">
          {status === 'starting' && <p className="notice">Select the dashboard tab and allow sharing to begin. Cancelling does not silently start a CSV-only session.</p>}
          {isRecording && <p className="notice">{compact ? 'Recording to disk. Keep this tab and backend open. Do not reload or let the computer sleep.' : 'Recording to disk. Keep this tab and the backend open; do not reload or let the computer sleep. Recording does not start or stop the mixer.'}</p>}
          {status === 'stopping' && <p className="notice">Saving final CSV/video chunks. Please keep this page open.</p>}
          {error && <p className="notice is-error">{error}</p>}
          {result && <p className="recording-files">
            <span>{result.state === 'complete' ? 'Saved:' : 'Partial files:'}</span>
            <a className="link" href={`${API}${result.csvUrl}?download=1`} download target="_blank" rel="noreferrer">Download CSV</a>
            {result.videoUrl && <a className="link" href={`${API}${result.videoUrl}?download=1`} download target="_blank" rel="noreferrer">Download video</a>}
            {!result.sampleCount && <span>No sensor frames arrived during this session.</span>}
          </p>}
        </div>
      </div>
    </section>
  );
};
