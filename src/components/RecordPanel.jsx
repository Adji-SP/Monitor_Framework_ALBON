import React, { useState, useEffect, useCallback } from 'react';
import { IconRefresh } from './Icons';
import { RecordingControls } from './RecordingControls';

const API = 'http://localhost:3001';
export const RecordPanel = ({ recorder }) => {
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState(null);
  const [plot, setPlot] = useState(null);
  const [plotError, setPlotError] = useState(null);
  const [plotting, setPlotting] = useState(false);
  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/records`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Cannot load recording history.');
      setHistory(data.sessions || []); setHistoryError(null);
    } catch (error) { setHistoryError(error.message); }
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory, recorder.status]);
  const generatePlot = async () => {
    setPlotting(true); setPlotError(null);
    const sessionId = recorder.result.sessionId;
    try {
      const response = await fetch(`${API}/api/recordings/${sessionId}/plot`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Plot failed.');
      setPlot({ sessionId, url: data.plotUrl }); loadHistory();
    } catch (error) { setPlotError(error.message); }
    finally { setPlotting(false); }
  };
  const result = recorder.result;
  return (
    <div className="stack">
      <RecordingControls recorder={recorder} />
      {result && (
        <section className="card">
          <div className="card-header">Saved session</div>
          <div className="card-body">
            <p className="help-note">Files: records/{result.sessionId}/session.csv{result.videoFile ? ` + ${result.videoFile}` : ''}. CSV and video share this session ID.</p>
            {result.videoUrl && <video className="recording-video" controls preload="metadata" src={`${API}${result.videoUrl}`} aria-label="Recorded dashboard video" />}
            <div><button className="btn-sm" type="button" onClick={generatePlot} disabled={plotting || !result.sampleCount}>
              {plotting ? 'Generating plot…' : 'Generate sensor plot'}
            </button></div>
            {plotError && <p className="notice is-error" role="alert">{plotError}</p>}
            {plot?.sessionId === result.sessionId && <img className="plot-img" src={`${API}${plot.url}`} alt="Recorded sensor values" />}
          </div>
        </section>
      )}
      <section className="card">
        <div className="card-header">
          <span>Run history ({history.length})</span>
          <button className="btn-sm" type="button" onClick={loadHistory}><IconRefresh size={12} /> Refresh</button>
        </div>
        {historyError && <p className="notice is-error" role="alert">{historyError}</p>}
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th>Started / session</th><th>Status</th><th>Sensor frames / events</th><th>Files</th></tr></thead>
            <tbody>
              {!history.length ? <tr><td colSpan="4" className="table-empty">No recorded sessions. Use Start recording above.</td></tr> : history.map((s) => (
                <tr key={s.sessionId}>
                  <td title={s.sessionId}>{s.startedAt ? new Date(s.startedAt).toLocaleString() : s.sessionId}</td>
                  <td title={s.error || ''}>{s.state || 'saved'}</td>
                  <td>{s.sampleCount ?? '?'} / {s.eventCount ?? '—'}</td>
                  <td><span className="row-actions">
                    <a className="link" href={`${API}${s.csvUrl}?download=1`} download target="_blank" rel="noreferrer">CSV</a>
                    {s.videoUrl && <a className="link" href={`${API}${s.videoUrl}?download=1`} download target="_blank" rel="noreferrer">Video</a>}
                    {s.plotUrl && <a className="link" href={`${API}${s.plotUrl}`} target="_blank" rel="noreferrer">Plot</a>}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
