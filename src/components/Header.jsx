// src/components/Header.jsx - Sidebar navigation and topbar (Data & Firmware console style)
import React, { useState, useEffect } from 'react';
import { IconGrid, IconTrend, IconRecord, IconDatabase, IconTerminal, IconRefresh, IconCpu } from './Icons';

export const PAGES = [
  { id: 'dashboard', label: 'Dashboard', group: 'Monitoring', Icon: IconGrid },
  { id: 'trends', label: 'Trends', group: 'Monitoring', Icon: IconTrend },
  { id: 'console', label: 'Remote Console', group: 'Monitoring', Icon: IconTerminal },
  { id: 'recorder', label: 'Session Recorder', group: 'Data', Icon: IconRecord },
  { id: 'records', label: 'Database Records', group: 'Data', Icon: IconDatabase }
];

const GROUPS = ['Monitoring', 'Data'];

export const Sidebar = ({ page, onNavigate, recorder }) => (
  <aside className="sidebar">
    <div className="sidebar-logo">
      <IconCpu size={20} />
      <span>Fermentor Monitor</span>
    </div>
    <nav className="sidebar-nav">
      {GROUPS.map((group) => (
        <React.Fragment key={group}>
          <div className="nav-group-label">{group}</div>
          {PAGES.filter((p) => p.group === group).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`nav-item${page === id ? ' active' : ''}`}
              onClick={() => onNavigate(id)}
              aria-current={page === id ? 'page' : undefined}
              title={label}
            >
              <Icon size={16} />
              <span style={{ flex: 1 }}>{label}</span>
              {id === 'recorder' && recorder.isRecording && <span className="rec-dot" aria-label="recording" />}
            </button>
          ))}
        </React.Fragment>
      ))}
    </nav>
    <div className="sidebar-footer">
      ESP32-S3 · <code>fermentor-text</code>
    </div>
  </aside>
);

const connClass = (state) =>
  state === 'CONNECTED' || state === 'ONLINE' ? 'is-live' : state === 'CONNECTING' || state === 'CHECKING' ? 'is-pending' : 'is-error';

export const Topbar = ({ group, title, wsStatus, apiStatus, telemetry, isRecording, onRefresh, onStopRecording }) => {
  // Frames arrive every 5 s; mark the device stale after three missed frames.
  // Re-render on a timer so "stale" shows even when no new frame arrives.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const lastFrame = telemetry.timestamp ? new Date(telemetry.timestamp) : null;
  const stale = !lastFrame || now - lastFrame.getTime() > 15000;

  return (
    <header className="topbar">
      <div className="topbar-breadcrumb">
        <span className="breadcrumb-root">{group}</span>
        <span className="breadcrumb-sep">›</span>
        <span className="breadcrumb-current">{title}</span>
      </div>
      <div className="topbar-actions">
        {isRecording && (
          <button className="btn-danger-sm" type="button" onClick={onStopRecording}>Recording · Stop &amp; save</button>
        )}
        <span className={`connection ${lastFrame ? (stale ? 'is-pending' : 'is-live') : 'is-error'}`}>
          <span className="connection-dot" />
          Device {lastFrame ? (stale ? 'stale' : 'live') : 'waiting'}
        </span>
        <span className={`connection ${connClass(wsStatus)}`}>
          <span className="connection-dot" />
          WebSocket {wsStatus.toLowerCase()}
        </span>
        <span className={`connection ${connClass(apiStatus)}`}>
          <span className="connection-dot" />
          API {String(apiStatus || 'unknown').toLowerCase()}
        </span>
        <button className="btn-sm" onClick={onRefresh} type="button">
          <IconRefresh size={13} />
          Refresh
        </button>
      </div>
    </header>
  );
};
