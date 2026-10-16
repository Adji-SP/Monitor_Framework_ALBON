// src/App.js - ALBON Fermentor Kopi monitor (sidebar layout shared with the Data & Firmware console)
import React, { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useApi } from './hooks/useApi';
import { useRecorder } from './hooks/useRecorder';

import { Sidebar, Topbar, PAGES } from './components/Header';
import { MetricsOverview, TelemetrySummary, TelemetryDetails } from './components/MetricsOverview';
import { DashboardTrends } from './components/DashboardTrends';
import { MixerControl } from './components/MixerControl';
import { RealtimeChart, RecentFrames, useTelemetryHistory } from './components/RealtimeChart';
import { WebSocketConsole } from './components/WebSocketConsole';
import { RecordPanel } from './components/RecordPanel';
import { RecordingControls } from './components/RecordingControls';
import { DbRecords } from './components/DbRecords';

const WS_URL = `ws://localhost:${process.env.REACT_APP_WS_PORT || 8080}`;

function App() {
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
  const {
    status: wsStatus,
    telemetry,
    mixer,
    mixerControlAvailable,
    mixerCommand,
    sendMixerCommand,
    messages,
    activeDevice,
    connect: reconnectWs,
    sendMessage
  } = useWebSocket(WS_URL, recorder.capture);

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
    reconnectWs();
    checkApiHealth();
    fetchSensorRecords();
  };

  const current = PAGES.find((p) => p.id === page);

  return (
    <>
      <Sidebar page={page} onNavigate={setPage} recorder={recorder} />
      <div className="layout">
        <Topbar
          group={current.group}
          title={current.label}
          wsStatus={wsStatus}
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
                <DashboardTrends history={history} />
                <aside className="dashboard-rail" aria-label="Mixer, recording and device">
                  <MixerControl compact mixer={mixer} wsStatus={wsStatus}
                    controlAvailable={mixerControlAvailable} command={mixerCommand} onCommand={sendMixerCommand} />
                  <RecordingControls compact recorder={recorder} />
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
              <PageTitle kicker="Monitoring" title="Remote Console" subtitle="WebSocket frames and device log lines relayed from the backend." />
              <WebSocketConsole messages={messages} onSendMessage={sendMessage} />
            </div>
          )}
        </main>
      </div>
    </>
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
