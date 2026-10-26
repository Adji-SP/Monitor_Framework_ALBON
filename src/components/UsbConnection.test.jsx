import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Topbar } from './Header';
import { emptyTelemetry } from '../fermentorMetrics';
global.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;
beforeEach(() => { jest.useFakeTimers(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); jest.useRealTimers(); });
const render = (serial, telemetry = emptyTelemetry()) => act(() => root.render(
  <Topbar group="Monitoring" title="Dashboard" serial={serial} apiStatus="OFFLINE" telemetry={telemetry} onRefresh={() => {}} />
));

test('USB connection is an explicit click and stays available when storage API is offline', () => {
  const serial = { status: 'DISCONNECTED', supported: true, connect: jest.fn(), disconnect: jest.fn() };
  render(serial);
  expect(serial.connect).not.toHaveBeenCalled();
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Connect USB');
  expect(button.disabled).toBe(false); act(() => button.click()); expect(serial.connect).toHaveBeenCalledTimes(1);
  expect(host.textContent).not.toContain('WebSocket'); expect(host.textContent).toContain('Storage API offline');
  render({ ...serial, error: 'Port is busy; close the serial monitor.' });
  expect(host.querySelector('[role="status"]').textContent).toContain('Port is busy');
});

test('connected USB gives a release button; missing browser support disables connection with visible guidance', () => {
  const serial = { status: 'CONNECTED', supported: true, connect: jest.fn(), disconnect: jest.fn() };
  render(serial, { ...emptyTelemetry(), timestamp: new Date().toISOString() });
  expect(host.textContent).toContain('Device live');
  act(() => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Disconnect USB').click());
  expect(serial.disconnect).toHaveBeenCalledTimes(1);
  render({ ...serial, status: 'DISCONNECTED', supported: false });
  expect([...host.querySelectorAll('button')].find((b) => b.textContent === 'Connect USB').disabled).toBe(true);
  expect(host.querySelector('[role="status"]').textContent).toContain('localhost or HTTPS');
  render({ ...serial, status: 'DISCONNECTED', supported: false, supportReason: 'Serial access is blocked by the embedded preview.' });
  expect(host.querySelector('[role="status"]').textContent).toContain('embedded preview');
});

test('topbar cannot open a second port while baud refresh is in progress', () => {
  const serial = { status: 'RECONNECTING', supported: true, connect: jest.fn(), disconnect: jest.fn() };
  render(serial);
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Reconnecting USB…');
  expect(button.disabled).toBe(true); act(() => button.click());
  expect(serial.connect).not.toHaveBeenCalled(); expect(serial.disconnect).not.toHaveBeenCalled();
});
