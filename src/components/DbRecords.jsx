// src/components/DbRecords.jsx - REST API sensor-data rows (GET/POST /api/sensor-data)
import React, { useState } from 'react';
import { IconRefresh } from './Icons';

export const DbRecords = ({ sensorRecords, onPostData, onRefreshApi }) => {
  const [form, setForm] = useState({
    user_id: 'FERM_OPERATOR',
    device_id: 'FERMENTOR_KOPI_ESP32S3',
    ph_reading: '6.85',
    temperature_reading: '28.50',
    moisture_percentage: '60.00'
  });
  const [postResult, setPostResult] = useState(null);

  const handlePost = async (e) => {
    e.preventDefault();
    setPostResult({ ok: null, text: 'Posting to /api/sensor-data…' });
    const res = await onPostData({
      user_id: form.user_id,
      device_id: form.device_id,
      ph_reading: parseFloat(form.ph_reading),
      temperature_reading: parseFloat(form.temperature_reading),
      moisture_percentage: parseFloat(form.moisture_percentage)
    });
    setPostResult(res.success ? { ok: true, text: 'Saved to database via REST API' } : { ok: false, text: `Error: ${res.error}` });
  };

  const field = (key, label, step) => (
    <label className="field">
      {label}
      <input className="pg-input" type="number" step={step} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );

  return (
    <div className="grid-split">
      <div className="card">
        <div className="card-header">
          <span>GET /api/sensor-data <span className="muted">({sensorRecords.length})</span></span>
          <button className="btn-sm" type="button" onClick={onRefreshApi}>
            <IconRefresh size={12} /> Refresh
          </button>
        </div>
        <div className="table-scroll" style={{ maxHeight: '480px' }}>
          <table className="table">
            <thead>
              <tr><th>Device</th><th>Temp (°C)</th><th>pH</th><th>Moisture</th></tr>
            </thead>
            <tbody>
              {sensorRecords.length === 0 ? (
                <tr><td colSpan="4" className="table-empty">No records</td></tr>
              ) : (
                sensorRecords.map((r, i) => (
                  <tr key={i}>
                    <td><span className="mono-chip">{r.device_id || 'ESP32'}</span></td>
                    <td>{r.temperature_reading}</td>
                    <td>{r.ph_reading}</td>
                    <td>{r.moisture_percentage}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header">POST ingest frame</div>
        <form className="card-body" onSubmit={handlePost}>
          {field('temperature_reading', 'Temperature', '0.1')}
          {field('ph_reading', 'pH', '0.01')}
          {field('moisture_percentage', 'Moisture', '0.1')}
          <button type="submit" className="btn-primary">Post REST API request</button>
          {postResult && (
            <div className={`notice${postResult.ok === true ? ' is-ok' : postResult.ok === false ? ' is-error' : ''}`}>{postResult.text}</div>
          )}
        </form>
      </div>
    </div>
  );
};
