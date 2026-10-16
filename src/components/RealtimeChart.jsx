// src/components/RealtimeChart.jsx - Sensor trend line (last 25 firmware frames)
import React, { useState, useEffect } from 'react';
import { METRICS, METRIC_KEYS } from '../fermentorMetrics';

// Keeps the last 25 frames; call once in App so history survives page switches.
export const useTelemetryHistory = (telemetry) => {
  const [history, setHistory] = useState([]);

  // One point per firmware frame (every 5 s); null = sensor not OK, drawn as a gap.
  useEffect(() => {
    if (!telemetry || !telemetry.timestamp) return;
    const time = new Date(telemetry.timestamp).toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' });

    setHistory((prev) => {
      const point = { time, timestamp: new Date(telemetry.timestamp).getTime() };
      for (const key of METRIC_KEYS) point[key] = telemetry[key];
      return [...prev, point].slice(-25);
    });
  }, [telemetry]);

  return history;
};

export const RealtimeChart = ({ history }) => {
  const [metric, setMetric] = useState('process_temp');

  const cfg = METRICS[metric];
  const width = 1000;
  const height = 240;
  const pad = 38;

  const getX = (i) => history.length <= 1 ? pad : pad + (i / (history.length - 1)) * (width - pad * 2);
  const getY = (v) => {
    const clamped = Math.max(cfg.min, Math.min(cfg.max, v));
    const pct = (clamped - cfg.min) / (cfg.max - cfg.min);
    return height - pad - pct * (height - pad * 2);
  };

  let pathD = '';
  let penDown = false;
  history.forEach((point, i) => {
    const v = point[metric];
    if (!Number.isFinite(v)) {
      penDown = false;
      return;
    }
    pathD += ` ${penDown ? 'L' : 'M'} ${getX(i)} ${getY(v)}`;
    penDown = true;
  });

  const latest = history.length ? history[history.length - 1][metric] : null;

  return (
    <div className="card">
      <div className="card-header">
        <span>Telemetry stream</span>
        <span className="muted">
          {cfg.label} · {Number.isFinite(latest) ? `${latest.toFixed(cfg.decimals)} ${cfg.unit}` : 'no value'} · {history.length} frames
        </span>
      </div>

      <div className="tabs" role="tablist">
        {METRIC_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={metric === k}
            className={`tab${metric === k ? ' active' : ''}`}
            onClick={() => setMetric(k)}
          >
            {METRICS[k].label}
          </button>
        ))}
      </div>

      <div style={{ padding: '10px 14px 14px', overflowX: 'auto' }}>
        {history.length === 0 ? (
          <div className="empty-state">
            <h2>Waiting for the first frame</h2>
            <p>The ESP32-S3 prints a sensor block every 5 s.</p>
          </div>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', maxHeight: '300px', display: 'block' }}>
            {[0, 0.25, 0.5, 0.75, 1].map((r, idx) => {
              const y = pad + r * (height - pad * 2);
              const val = (cfg.max - r * (cfg.max - cfg.min)).toFixed(cfg.max >= 100 ? 0 : 1);
              return (
                <g key={idx}>
                  <line x1={pad} y1={y} x2={width - pad} y2={y} stroke="#e5e7eb" strokeDasharray={r === 1 ? undefined : '3 3'} />
                  <text x={pad - 8} y={y + 3} fill="#9ca3af" fontSize="10" textAnchor="end">{val}</text>
                </g>
              );
            })}

            {history.map((h, i) => {
              if (i % Math.ceil(history.length / 5) === 0 || i === history.length - 1) {
                return (
                  <text key={i} x={getX(i)} y={height - pad + 16} fill="#9ca3af" fontSize="10" textAnchor="middle">
                    {h.time}
                  </text>
                );
              }
              return null;
            })}

            <path d={pathD} fill="none" stroke={cfg.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

            {history.map((h, i) => Number.isFinite(h[metric]) && (
              <circle key={i} cx={getX(i)} cy={getY(h[metric])} r="3" fill="#fff" stroke={cfg.color} strokeWidth="1.8" />
            ))}
          </svg>
        )}
      </div>
    </div>
  );
};

// Table of the buffered frames, newest first; "--" = sensor not OK in that frame.
export const RecentFrames = ({ history }) => (
  <div className="card">
    <div className="card-header">
      <span>Recent frames</span>
      <span className="muted">{history.length} buffered</span>
    </div>
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Time</th>
            {METRIC_KEYS.map((k) => <th key={k}>{METRICS[k].label} ({METRICS[k].unit})</th>)}
          </tr>
        </thead>
        <tbody>
          {history.length === 0 ? (
            <tr><td colSpan={METRIC_KEYS.length + 1} className="table-empty">No frames yet</td></tr>
          ) : (
            [...history].reverse().map((h, i) => (
              <tr key={i}>
                <td><span className="mono-chip">{h.time}</span></td>
                {METRIC_KEYS.map((k) => (
                  <td key={k}>{Number.isFinite(h[k]) ? h[k].toFixed(METRICS[k].decimals) : '--'}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);
