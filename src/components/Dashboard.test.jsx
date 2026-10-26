import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MetricsOverview, TelemetrySummary } from './MetricsOverview';
import { DashboardTrends, plotDomain } from './DashboardTrends';
import { Sidebar } from './Header';
import { emptyTelemetry, METRICS, METRIC_KEYS } from '../fermentorMetrics';

global.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

test('sidebar toggle and icon-only navigation have accessible names', () => {
  const navigate = jest.fn();
  const toggle = jest.fn();
  const render = (collapsed) => act(() => root.render(<Sidebar page="dashboard" onNavigate={navigate}
    recorder={{ isRecording: true }} collapsed={collapsed} onToggle={toggle} />));
  render(false);
  const collapse = host.querySelector('button[aria-label="Collapse sidebar"]');
  expect(collapse.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(collapse.getAttribute('aria-controls'))).not.toBeNull();
  act(() => collapse.click());
  expect(toggle).toHaveBeenCalledTimes(1);
  render(true);
  const expand = host.querySelector('button[aria-label="Expand sidebar"]');
  expect(expand.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.sidebar').getAttribute('data-collapsed')).toBe('true');
  expect(host.querySelector('.rec-dot')).not.toBeNull();
  act(() => expand.click());
  expect(toggle).toHaveBeenCalledTimes(2);
  const serialLink = host.querySelector('button[aria-label="Serial Console"]');
  act(() => serialLink.click());
  expect(navigate).toHaveBeenCalledWith('console');
  expect(host.querySelector('button[aria-current="page"]').getAttribute('aria-label')).toBe('Dashboard');
});

test('overview shows all nine hardware readings as compact gauges, never a synthetic zero while waiting', () => {
  act(() => root.render(<MetricsOverview telemetry={emptyTelemetry()} />));
  expect(host.querySelectorAll('.gauge-card[data-compact="true"]').length).toBe(9);
  expect(host.querySelectorAll('svg[role="img"]').length).toBe(9);
  expect(host.querySelectorAll('.gauge-value').length).toBe(0);
  expect(host.querySelectorAll('.gauge-state').length).toBe(9);
  expect(host.querySelectorAll('svg line').length).toBe(0);
  expect(host.querySelectorAll('.gauge-body > .gauge-subtitle').length).toBe(9);
  expect(host.textContent).toContain('DS18B20');
  expect(host.textContent).toContain('SHT30');
  expect(host.textContent).not.toContain('PT100');
});

test('gauges retain units and precision; invalid or offline values do not count as OK', () => {
  const telemetry = { ...emptyTelemetry(), timestamp: '2026-10-16T08:00:00Z',
    process_temp: 24.88, pressure: -0.194, ph: NaN, o2: 20.9,
    status: { process_temp: 'OK', pressure: 'OK', ph: 'OK', o2: 'OFFLINE' } };
  act(() => root.render(<><MetricsOverview telemetry={telemetry} /><TelemetrySummary telemetry={telemetry} /></>));
  expect(host.textContent).toContain('24.88');
  expect(host.textContent).toContain('-0.194');
  expect(host.textContent).toContain('ERROR');
  expect(host.textContent).toContain('OFFLINE');
  expect(host.textContent).not.toContain('20.90');
  expect(host.querySelector('.telemetry-summary').textContent).toContain('2 / 9');
});

test('six simultaneous plots include all metrics and split lines at missing samples', () => {
  const history = [0, 1, 2].map((i) => ({ time: `00:${i}0`, timestamp: i * 10000,
    ...Object.fromEntries(METRIC_KEYS.map((key) => [key, i === 1 ? null : 12 + i])) }));
  act(() => root.render(<DashboardTrends history={history} />));
  expect(host.querySelectorAll('.trend-plot').length).toBe(6);
  METRIC_KEYS.forEach((key) => {
    const series = host.querySelector(`[data-series="${key}"]`);
    expect(series).not.toBeNull();
    const path = series.querySelector('path').getAttribute('d');
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).not.toContain('L');
    expect(path).not.toMatch(/NaN|Infinity/);
  });
  expect(host.textContent).toContain('Auto scale');
});

test('empty and constant plot domains are finite; valid extreme values are not clipped', () => {
  expect(plotDomain([null, NaN], METRICS.ph)).toEqual([0, 14]);
  const [low, high] = plotDomain([24.88, 24.88], METRICS.sht_temp);
  expect(low).toBeLessThan(24.88); expect(high).toBeGreaterThan(24.88);
  const [negative, positive] = plotDomain([-0.194, 15], METRICS.pressure);
  expect(negative).toBeLessThan(-0.194); expect(positive).toBeGreaterThan(15);
  act(() => root.render(<DashboardTrends history={[]} />));
  expect(host.querySelectorAll('.trend-placeholder').length).toBe(6);
  expect(host.textContent).toContain('Connect the ESP32-S3');
});

test('empty trends explain parsing rather than asking an already connected device to reconnect', () => {
  act(() => root.render(<DashboardTrends history={[]} connectionStatus="CONNECTED" serialStats={{ lines: 31 }} />));
  expect(host.querySelector('.trend-empty-hint').textContent).toContain('USB text is arriving');
  expect(host.querySelector('.trend-empty-hint').textContent).not.toContain('Connect USB');
});
