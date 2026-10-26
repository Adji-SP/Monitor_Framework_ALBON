// src/components/Header.jsx - Sidebar navigation and topbar (Data & Firmware console style)
import React, { useState, useEffect } from 'react';
import { IconGrid, IconTrend, IconRecord, IconDatabase, IconTerminal, IconRefresh, IconCpu, IconSidebar } from './Icons';

export const PAGES = [
  { id: 'dashboard', label: 'Dashboard', group: 'Monitoring', Icon: IconGrid },
  { id: 'trends', label: 'Trends', group: 'Monitoring', Icon: IconTrend },
  { id: 'console', label: 'Serial Console', group: 'Monitoring', Icon: IconTerminal },
  { id: 'recorder', label: 'Session Recorder', group: 'Data', Icon: IconRecord },
  { id: 'records', label: 'Database Records', group: 'Data', Icon: IconDatabase }
];

const GROUPS = ['Monitoring', 'Data'];

export const Sidebar = ({ page, onNavigate, recorder, collapsed = false, onToggle }) => (
  <aside className="sidebar" data-collapsed={collapsed} aria-label="Main navigation">
    <div className="sidebar-logo">
      <IconCpu size={20} />
      <span>Fermentor Monitor</span>
    </div>
    <button className="sidebar-toggle" type="button" onClick={onToggle}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-expanded={!collapsed} aria-controls="sidebar-navigation">
      <IconSidebar size={18} />
      <span>Collapse sidebar</span>
    </button>
    <nav className="sidebar-nav" id="sidebar-navigation">
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
              aria-label={label}
            >
              <Icon size={16} />
              <span className="nav-label" style={{ flex: 1 }}>{label}</span>
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

export const Topbar = ({ group, title, wsStatus = 'DISCONNECTED', serial, apiStatus, telemetry, isRecording, onRefresh, onStopRecording }) => {
  // Frames arrive every 5 s; mark the device stale after three missed frames.
  // Re-render on a timer so "stale" shows even when no new frame arrives.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const lastFrame = telemetry.timestamp ? new Date(telemetry.timestamp) : null;
  const stale = !lastFrame || (serial && serial.status !== 'CONNECTED') || now - lastFrame.getTime() > 15000;

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
        <span className={`connection ${lastFrame ? (stale ? 'is-pending' : 'is-live') : 'is-error'}`} data-device={lastFrame ? (stale ? 'stale' : 'live') : 'waiting'}>
          <span className="connection-dot" />
          Device {lastFrame ? (stale ? 'stale' : 'live') : 'waiting'}
        </span>
        {serial ? <>
          <span className="connection serial-status" data-state={serial.status}>
            <span className="connection-dot" />USB {serial.status.toLowerCase()}
          </span>
          <button className="btn-sm" type="button" onClick={serial.status === 'CONNECTED' ? serial.disconnect : serial.connect}
            disabled={!serial.supported || ['CONNECTING', 'RECONNECTING', 'DISCONNECTING'].includes(serial.status)}>
            {serial.status === 'CONNECTED' ? 'Disconnect USB' : serial.status === 'RECONNECTING' ? 'Reconnecting USB…' : serial.status === 'CONNECTING' ? 'Select USB port…' : serial.status === 'DISCONNECTING' ? 'Releasing USB…' : 'Connect USB'}
          </button>
        </> : <span className={`connection ${connClass(wsStatus)}`}>
          <span className="connection-dot" />
          WebSocket {wsStatus.toLowerCase()}
        </span>}
        <span className={`connection ${connClass(apiStatus)}`}>
          <span className="connection-dot" />
          {serial ? 'Storage API' : 'API'} {String(apiStatus || 'unknown').toLowerCase()}
        </span>
        <button className="btn-sm" onClick={onRefresh} type="button">
          <IconRefresh size={13} />
          Refresh
        </button>
      </div>
      {serial && (serial.error || !serial.supported || serial.status === 'DISCONNECTED') && (
        <div className="serial-connection-notice" role="status" data-error={Boolean(serial.error) || !serial.supported}>
          {!serial.supported ? serial.supportReason || 'Direct USB requires desktop Chrome or Edge on localhost or HTTPS.' : serial.error || 'Click Connect USB and choose the ESP32 native USB Serial/JTAG port from the device list. Close other serial monitors and dashboard tabs first. USB disconnect does not stop the mixer.'}
        </div>
      )}
    </header>
  );
};
