// src/components/ApiDataViewer.jsx
import React, { useState } from 'react';

export const ApiDataViewer = ({ records, loading, onRefresh, onPostData }) => {
  const [formData, setFormData] = useState({
    user_id: 'FERM_OPERATOR',
    device_id: 'FERM_ESP32_01',
    ph_reading: '6.85',
    temperature_reading: '29.2',
    moisture_percentage: '62.5'
  });
  const [postStatus, setPostStatus] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setPostStatus({ type: 'info', msg: 'Posting to /api/sensor-data...' });
    const res = await onPostData({
      user_id: formData.user_id,
      device_id: formData.device_id,
      ph_reading: parseFloat(formData.ph_reading),
      temperature_reading: parseFloat(formData.temperature_reading),
      moisture_percentage: parseFloat(formData.moisture_percentage)
    });

    if (res.success) {
      setPostStatus({ type: 'success', msg: res.message });
    } else {
      setPostStatus({ type: 'error', msg: res.error });
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '24px' }}>
      
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            🗄️ REST API & Database Explorer
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Endpoints: GET /api/sensor-data & POST /api/sensor-data
          </p>
        </div>

        <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>
          {loading ? '🔄 Loading...' : '🔄 Refresh API Data'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        
        {/* Left Column: Data Records Table */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            📋 Recent Sensor Database Records ({records.length})
          </label>

          <div style={{
            maxHeight: '300px',
            overflowY: 'auto',
            background: 'var(--bg-input)',
            borderRadius: '10px',
            border: '1px solid var(--border-color)'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '8px 12px' }}>Device</th>
                  <th style={{ padding: '8px 12px' }}>Temp (°C)</th>
                  <th style={{ padding: '8px 12px' }}>pH</th>
                  <th style={{ padding: '8px 12px' }}>Moisture</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr>
                    <td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No records found in API endpoint.
                    </td>
                  </tr>
                ) : (
                  records.map((r, i) => (
                    <tr key={r.id || i} style={{ borderTop: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: '600', color: 'var(--accent-cyan)' }}>
                        {r.device_id || 'ESP32'}
                      </td>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>
                        {r.temperature_reading}
                      </td>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>
                        {r.ph_reading}
                      </td>
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>
                        {r.moisture_percentage}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Ingest Form via REST API */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            ➕ Post New Reading via REST API
          </label>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>User ID</span>
                <input
                  type="text"
                  className="input-field"
                  value={formData.user_id}
                  onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Device ID</span>
                <input
                  type="text"
                  className="input-field"
                  value={formData.device_id}
                  onChange={(e) => setFormData({ ...formData, device_id: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Temp (°C)</span>
                <input
                  type="number"
                  step="0.1"
                  className="input-field"
                  value={formData.temperature_reading}
                  onChange={(e) => setFormData({ ...formData, temperature_reading: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>pH Reading</span>
                <input
                  type="number"
                  step="0.01"
                  className="input-field"
                  value={formData.ph_reading}
                  onChange={(e) => setFormData({ ...formData, ph_reading: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Moisture %</span>
                <input
                  type="number"
                  step="0.1"
                  className="input-field"
                  value={formData.moisture_percentage}
                  onChange={(e) => setFormData({ ...formData, moisture_percentage: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ marginTop: '6px' }}>
              📤 Send REST API POST Request
            </button>

            {postStatus && (
              <div style={{
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.78rem',
                fontWeight: '600',
                background: postStatus.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                color: postStatus.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)'
              }}>
                {postStatus.msg}
              </div>
            )}
          </form>
        </div>

      </div>

    </div>
  );
};
