import React from 'react';
import { GaugeMeter } from './GaugeMeter';
import { METRICS, METRIC_KEYS } from '../fermentorMetrics';

// All nine measurements from the existing hardware, ordered like the overview reference.
const DASHBOARD_METRICS = [
  ['sht_temp', 'Chamber T', 'SHT30'],
  ['sht_rh', 'Chamber RH', 'SHT30'],
  ['process_temp', 'Coffee T', 'DS18B20 · GPIO12'],
  ['co2', 'CO2', 'SCD41'],
  ['o2', 'Oxygen', 'SEN0322'],
  ['ph', 'pH', 'ADS1115 · A0'],
  ['pressure', 'Pressure', 'ADS1115 · A1'],
  ['scd_temp', 'SCD41 T', 'SCD41'],
  ['scd_rh', 'SCD41 RH', 'SCD41']
];

const fmt = (v, digits, unit) => (Number.isFinite(v) ? `${v.toFixed(digits)} ${unit}` : '—');

export const MetricsOverview = ({ telemetry }) => (
  <section className="dashboard-gauges" aria-label="Live sensor readings">
    {DASHBOARD_METRICS.map(([key, title, subtitle]) => {
      const m = METRICS[key];
      return (
        <GaugeMeter key={key} compact title={title} subtitle={subtitle}
          value={telemetry[key]} status={telemetry.status?.[key] || 'WAIT'}
          unit={m.unit} min={m.min} max={m.max} decimals={m.decimals} color={m.color} />
      );
    })}
  </section>
);

export const TelemetrySummary = ({ telemetry }) => {
  const hasFrame = Boolean(telemetry.timestamp);
  const okCount = METRIC_KEYS.filter((key) => telemetry.status?.[key] === 'OK' && Number.isFinite(telemetry[key])).length;
  return (
    <div className="telemetry-summary" aria-label="Telemetry summary">
      <span>Last frame <strong>{hasFrame ? new Date(telemetry.timestamp).toLocaleTimeString([], { hour12: false }) : '—'}</strong></span>
      <span>Readings OK <strong>{hasFrame ? `${okCount} / ${METRIC_KEYS.length}` : '—'}</strong></span>
      <span>Updates every <strong>5 s</strong></span>
    </div>
  );
};

export const TelemetryDetails = ({ telemetry, activeDevice }) => (
  <section className="card telemetry-details" aria-labelledby="telemetry-details-title">
    <div className="card-header"><h2 id="telemetry-details-title">Device &amp; inputs</h2></div>
    <div className="card-body">
      <dl className="detail-list">
        <div><dt>Device</dt><dd>{activeDevice?.name || telemetry.device_id || 'Waiting for device'}</dd></div>
        <div><dt>Source</dt><dd>{activeDevice?.source || 'ESP32-S3 USB console'}</dd></div>
        <div><dt>pH · A0</dt><dd>{fmt(telemetry.raw?.ph_mv, 1, 'mV')}</dd></div>
        <div><dt>Pressure · A1</dt><dd>{fmt(telemetry.raw?.pressure_v, 3, 'V')}</dd></div>
      </dl>
    </div>
  </section>
);
