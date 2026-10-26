import React from 'react';
import { METRICS } from '../fermentorMetrics';

const PLOTS = [
  { id: 'temperature', title: 'Temperature', unit: '°C', keys: ['sht_temp', 'process_temp', 'scd_temp'], labels: ['Chamber · SHT30', 'Coffee · DS18B20', 'SCD41'] },
  { id: 'humidity', title: 'Relative humidity', unit: '%RH', keys: ['sht_rh', 'scd_rh'], labels: ['Chamber · SHT30', 'SCD41'] },
  { id: 'co2', title: 'Carbon dioxide', unit: 'ppm', keys: ['co2'], labels: ['SCD41'] },
  { id: 'oxygen', title: 'Oxygen', unit: '%vol', keys: ['o2'], labels: ['DFRobot SEN0322'] },
  { id: 'ph', title: 'pH', unit: 'pH', keys: ['ph'], labels: ['pH · ADS1115 A0'] },
  { id: 'pressure', title: 'Pressure', unit: 'bar', keys: ['pressure'], labels: ['Pressure · ADS1115 A1'] }
];

// Autoscale only the plot; source values and gauge ranges stay unchanged.
// Missing readings are gaps, never zeroes or carried-forward values.
export const plotDomain = (values, fallback) => {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return [fallback.min, fallback.max];
  const low = Math.min(...valid);
  const high = Math.max(...valid);
  const span = Math.max(high - low, (fallback.max - fallback.min) / 100);
  const step = 10 ** Math.floor(Math.log10(span / 4));
  const tick = Math.ceil((span / 4) / step) * step;
  return [Math.floor((low - span * 0.12) / tick) * tick, Math.ceil((high + span * 0.12) / tick) * tick];
};

export const TrendPlot = ({ plot, history }) => {
  const width = 480;
  const height = 152;
  const left = 49;
  const right = width - 16;
  const top = 12;
  const bottom = height - 25;
  const [min, max] = plotDomain(history.flatMap((p) => plot.keys.map((key) => p[key])), METRICS[plot.keys[0]]);
  const firstTime = history[0]?.timestamp;
  const lastTime = history[history.length - 1]?.timestamp;
  const timed = Number.isFinite(firstTime) && Number.isFinite(lastTime) && lastTime > firstTime;
  const x = (i) => left + (timed ? (history[i].timestamp - firstTime) / (lastTime - firstTime) : i / Math.max(1, history.length - 1)) * (right - left);
  const y = (value) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const hasValues = history.some((p) => plot.keys.some((key) => Number.isFinite(p[key])));
  const tickDigits = Math.min(3, Math.max(0, 1 - Math.floor(Math.log10(max - min))));
  const timeTicks = [...new Set([0, Math.floor((history.length - 1) / 2), history.length - 1])].filter((i) => i >= 0);

  return (
    <section className="trend-plot" aria-labelledby={`plot-${plot.id}`}>
      <div className="trend-plot-heading"><h3 id={`plot-${plot.id}`}>{plot.title}</h3><span>{plot.unit}</span></div>
      <ul className="trend-legend" aria-label={`${plot.title} series`}>
        {plot.keys.map((key, i) => <li key={key}><span style={{ background: METRICS[key].color }} aria-hidden="true" />{plot.labels[i]}</li>)}
      </ul>
      <svg className="trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${plot.title}: ${hasValues ? `last ${history.length} frames, automatic scale` : 'waiting for valid readings'}`}>
        {[0, 0.5, 1].map((ratio) => {
          const v = max - ratio * (max - min);
          return <g key={ratio}>
            <line x1={left} y1={y(v)} x2={right} y2={y(v)} stroke="var(--border)" strokeDasharray={ratio === 1 ? undefined : '3 4'} />
            <text x={left - 8} y={y(v) + 4} textAnchor="end">{v.toFixed(tickDigits)}</text>
          </g>;
        })}
        {timeTicks.map((i) => history[i] && <text key={i} x={x(i)} y={height - 6} textAnchor="middle">{history[i].time}</text>)}
        {plot.keys.map((key) => {
          let down = false;
          const path = history.map((p, i) => {
            if (!Number.isFinite(p[key])) { down = false; return ''; }
            const segment = `${down ? 'L' : 'M'} ${x(i)} ${y(p[key])}`;
            down = true;
            return segment;
          }).join(' ');
          return <g key={key} data-series={key}>
            <path d={path} fill="none" stroke={METRICS[key].color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {history.map((p, i) => Number.isFinite(p[key]) && <circle key={i} cx={x(i)} cy={y(p[key])} r="2" fill={METRICS[key].color} />)}
          </g>;
        })}
        {!hasValues && <text className="trend-placeholder" x={(left + right) / 2} y={(top + bottom) / 2} textAnchor="middle">{history.length ? 'No valid readings' : 'Waiting for data'}</text>}
      </svg>
    </section>
  );
};

export const DashboardTrends = ({ history, connectionStatus = 'DISCONNECTED', serialStats }) => (
  <section className="card dashboard-trends" aria-labelledby="dashboard-trends-title">
    <div className="card-header">
      <h2 id="dashboard-trends-title">Live telemetry</h2>
      <span className="muted">{history.length} / 25 frames · Auto scale</span>
    </div>
    {!history.length && <p className="trend-empty-hint">{
      connectionStatus === 'CONNECTED'
        ? serialStats?.lines ? 'USB text is arriving. Waiting for a recognized sensor cycle or DATA row.' : 'USB is connected. Waiting for the first complete sensor reading.'
        : connectionStatus === 'RECONNECTING' ? 'USB is reconnecting. Waiting for new sensor readings.'
          : 'Connect the ESP32-S3 using Connect USB above to see live trends.'
    }</p>}
    <div className="trend-grid">{PLOTS.map((plot) => <TrendPlot key={plot.id} plot={plot} history={history} />)}</div>
    <div className="trend-footer">Last 25 frames · Time (mm:ss) · Gaps indicate unavailable readings</div>
  </section>
);
