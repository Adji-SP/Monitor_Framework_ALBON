// src/App.js - ALBON Fermentor Kopi monitor (sidebar layout shared with the Data & Firmware console)
import React, { useState, useEffect } from 'react';
import { useWebSerial } from './hooks/useWebSerial';
import { useApi } from './hooks/useApi';
import { useRecorder } from './hooks/useRecorder';
import { useSidebar } from './hooks/useSidebar';

import { Sidebar, Topbar, PAGES } from './components/Header';
import { MetricsOverview, TelemetryDetails, TelemetrySummary } from './components/MetricsOverview';
import { DashboardTrends } from './components/DashboardTrends';
import { MixerControl } from './components/MixerControl';
import { RealtimeChart, RecentFrames, useTelemetryHistory } from './components/RealtimeChart';
import { WebSocketConsole } from './components/WebSocketConsole';
import { SerialMonitor } from './components/SerialMonitor';
import { RecordPanel } from './components/RecordPanel';
import { RecordingControls } from './components/RecordingControls';
import { DbRecords } from './components/DbRecords';

function App() {
  const [sidebarCollapsed, toggleSidebar] = useSidebar();
  // Current page mirrors location.hash (#dashboard, #console, ...) so refresh keeps it.
  const pageFromHash = () => {
    const id = window.location.hash.slice(1);
    return PAGES.some((p) => p.id === id) ? id : 'dashboard';
  };
  const [page, setPageState] = useState(pageFromHash);
  const setPage = (id) => {
    window.location.hash = id;
    setPageState(id);
  };
  useEffect(() => {
    const onHash = () => setPageState(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const recorder = useRecorder();
  const serial = useWebSerial(recorder.capture);
  const {
    status: serialStatus,
    telemetry,
    mixer,
    mixerControlAvailable,
    mixerCommand,
    sendMixerCommand,
    messages,
    activeDevice
  } = serial;

  const {
    apiStatus,
    sensorRecords,
    checkHealth: checkApiHealth,
    fetchSensorRecords,
    postSensorData
  } = useApi();

  // Recorder lives here so recording continues while switching pages.
  const history = useTelemetryHistory(telemetry);

  const handleGlobalRefresh = () => {
    checkApiHealth();
    fetchSensorRecords();
  };

  const current = PAGES.find((p) => p.id === page);

  return (
    <div className="app-shell" data-sidebar-collapsed={sidebarCollapsed}>
      <Sidebar page={page} onNavigate={setPage} recorder={recorder}
        collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      <div className="layout">
        <Topbar
          group={current.group}
          title={current.label}
          serial={serial}
          apiStatus={apiStatus}
          telemetry={telemetry}
          isRecording={recorder.isRecording}
          onRefresh={handleGlobalRefresh}
          onStopRecording={recorder.stop}
        />
        <main className="content" data-page={page}>
          {page === 'dashboard' && (
            <div className="stack dashboard">
              <div className="dashboard-heading">
                <PageTitle kicker="Fermentor Kopi" title="Live Dashboard" />
                <TelemetrySummary telemetry={telemetry} />
              </div>
              <MetricsOverview telemetry={telemetry} />
              <div className="dashboard-workspace">
                <DashboardTrends history={history} connectionStatus={serialStatus} serialStats={serial.stats} />
                <aside className="dashboard-rail" aria-label="Serial monitor, mixer, recording and device">
                  <SerialMonitor messages={messages} status={serialStatus} stats={serial.stats} serial={serial} />
                  <MixerControl compact mixer={mixer} connectionStatus={serialStatus}
                    controlAvailable={mixerControlAvailable} command={mixerCommand} onCommand={sendMixerCommand} />
                  <RecordingControls compact recorder={recorder} apiStatus={apiStatus} />
                  <TelemetryDetails telemetry={telemetry} activeDevice={activeDevice} />
                </aside>
              </div>
            </div>
          )}

          {page === 'trends' && (
            <div className="stack">
              <PageTitle kicker="Fermentor Kopi" title="Sensor Trends" subtitle="Last 25 frames per sensor; gaps mark WAIT, OFFLINE or ERROR readings." />
              <RealtimeChart history={history} />
              <RecentFrames history={history} />
            </div>
          )}

          {page === 'recorder' && (
            <div className="stack">
              <PageTitle kicker="Data" title="Session Recorder" subtitle="Record all incoming sensor and mixer events to CSV, with dashboard video." />
              <RecordPanel recorder={recorder} />
            </div>
          )}

          {page === 'records' && (
            <div className="stack">
              <PageTitle kicker="Data" title="Database Records" subtitle="Rows served by GET /api/sensor-data." />
              <DbRecords sensorRecords={sensorRecords} onPostData={postSensorData} onRefreshApi={fetchSensorRecords} />
            </div>
          )}

          {page === 'console' && (
            <div className="stack">
              <PageTitle kicker="Monitoring" title="USB Serial Console" subtitle={`Direct USB output. ${serialStatus === 'CONNECTED' ? serial.stats.baudRate : serial.baudRate} baud selected; change it in the dashboard's Serial monitor.`} />
              <WebSocketConsole messages={messages} directSerial />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

const PageTitle = ({ kicker, title, subtitle }) => (
  <div className="page-title-row" style={{ marginBottom: 0 }}>
    <div>
      <span className="page-kicker">{kicker}</span>
      <h1>{title}</h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </div>
  </div>
);

export default App;
