import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SerialMonitor, serialHint } from './SerialMonitor';
import { emptySerialStats } from '../usbSerialSession';

global.IS_REACT_ACT_ENVIRONMENT = true;
let root, host;
beforeEach(() => { jest.useFakeTimers(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); jest.useRealTimers(); });
const raw = (id, line) => ({ id, type: 'device_log', direction: 'IN', timestamp: '12:00:00', payload: JSON.stringify({ data: { line } }) });
const render = (messages, props = {}) => act(() => root.render(<SerialMonitor messages={messages} status="CONNECTED" {...props} />));
const click = (label) => act(() => [...host.querySelectorAll('button')].find((button) => button.textContent === label).click());
const output = () => host.querySelector('.console-screen').textContent;

test('raw USB output and system errors appear on the dashboard without duplicate parsed JSON or HTML execution', () => {
  render([
    raw(3, '<img src=x onerror=alert(1)>'),
    { id: 2, type: 'sensor_update', direction: 'IN', payload: '{"metrics":{"ph":7}}' },
    { id: 1, type: 'ERROR', direction: 'SYS', timestamp: '12:00:00', payload: JSON.stringify({ text: 'Port busy' }) }
  ]);
  expect(output()).toContain('Port busy');
  expect(output()).toContain('<img');
  expect(output()).not.toContain('metrics');
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('.console-screen').tabIndex).toBe(0);
  expect(host.querySelector('a').getAttribute('href')).toBe('#console');
});

test('pause freezes only the display; counters keep updating and resume shows new data', () => {
  const first = raw(1, 'DS18B20 : 25 C');
  render([first]); click('Pause display');
  render([raw(2, 'O2 : 20.9 %Vol'), first], { stats: { ...emptySerialStats(), bytes: 50, lines: 2 } });
  expect(output()).toContain('DS18B20'); expect(output()).not.toContain('O2');
  expect(host.querySelector('.serial-monitor-stats').textContent).toContain('50 bytes');
  expect(host.textContent).toContain('recording continue');
  click('Resume display'); expect(output()).toContain('O2');
});

test('clear affects only this view, including while paused, and new lines remain visible', () => {
  const messages = [raw(1, 'old line')];
  render(messages); click('Pause display'); click('Clear view');
  expect(output()).toContain('View cleared');
  render([raw(2, 'new line'), ...messages]);
  expect(output()).not.toContain('new line');
  click('Resume display');
  expect(output()).toContain('new line'); expect(output()).not.toContain('old line');
  expect(messages).toEqual([raw(1, 'old line')]);
  click('Clear view'); render([raw(3, 'latest line'), raw(2, 'new line'), ...messages]);
  expect(output()).toContain('latest line'); expect(output()).not.toContain('new line');
});

test('diagnostics distinguish no traffic, incomplete lines, unparsed text and stale/live frames', () => {
  const stats = { ...emptySerialStats(), connectedAt: 0 };
  expect(serialHint('DISCONNECTED', stats, 0)).toContain('Connect USB');
  expect(serialHint('CONNECTING', stats, 0)).toContain('picker');
  expect(serialHint('RECONNECTING', stats, 0)).toContain('same USB port');
  expect(serialHint('DISCONNECTING', stats, 0)).toContain('Releasing');
  expect(serialHint('CONNECTED', { ...stats, baudRate: 57600 }, 1000)).toContain('57600');
  expect(serialHint('CONNECTED', stats, 1000)).toContain('waiting for the first');
  expect(serialHint('CONNECTED', stats, 11000)).toContain('no bytes');
  Object.assign(stats, { bytes: 12, lastByteAt: 11000 });
  expect(serialHint('CONNECTED', stats, 11000)).toContain('no complete text lines');
  stats.lines = 1;
  expect(serialHint('CONNECTED', stats, 11000)).toContain('no sensor block');
  stats.frames = 1; stats.lastFrameAt = 11000;
  expect(serialHint('CONNECTED', stats, 11000)).toContain('Receiving sensor frames');
  expect(serialHint('CONNECTED', stats, 27000)).toContain('traffic has stopped');
  stats.lastByteAt = 27000;
  expect(serialHint('CONNECTED', stats, 27000)).toContain('sensor frames are stale');
});

test('baud selection is labelled and requires Apply; displayed active rate does not change prematurely', () => {
  const serial = { supported: true, baudRate: 115200, selectBaudRate: jest.fn(), refresh: jest.fn() };
  const stats = { ...emptySerialStats(), baudRate: 115200 };
  render([], { serial, stats });
  const select = host.querySelector('select');
  expect(host.querySelector(`label[for="${select.id}"]`).textContent).toContain('Baud rate');
  expect([...select.options].map((option) => Number(option.value))).toEqual([9600, 19200, 38400, 57600, 115200, 230400]);
  act(() => { select.value = '57600'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(serial.selectBaudRate).toHaveBeenCalledWith(57600);
  expect(serial.refresh).not.toHaveBeenCalled();
  render([], { serial: { ...serial, baudRate: 57600 }, stats });
  expect(host.querySelector('.serial-monitor-stats').textContent).toContain('115200 baud selected');
  expect(host.querySelector('#serial-baud-help').textContent).toContain('Apply to use 57600');
  click('Apply & refresh'); expect(serial.refresh).toHaveBeenCalledTimes(1);
  render([], { serial: { ...serial, baudRate: 57600 }, stats: { ...stats, baudRate: 57600 } });
  expect(host.querySelector('.serial-monitor-stats').textContent).toContain('57600 baud selected');
  expect(host.textContent).not.toContain('Apply to use');
});

test('reconnect controls prevent duplicate operations, expose errors and do not block the raw monitor', () => {
  const serial = { supported: true, baudRate: 9600, selectBaudRate: jest.fn(), refresh: jest.fn() };
  for (const status of ['CONNECTING', 'RECONNECTING', 'DISCONNECTING']) {
    render([raw(1, 'Old raw output')], { serial, status });
    expect(host.querySelector('select').disabled).toBe(true);
    expect(host.querySelector('.serial-settings-controls button').disabled).toBe(true);
    expect(output()).toContain('Old raw output');
  }
  render([], { serial: { ...serial, error: 'Cannot open USB serial: port busy' }, status: 'DISCONNECTED' });
  expect(host.querySelector('select').disabled).toBe(false);
  expect(host.querySelector('.serial-settings-controls button').disabled).toBe(true);
  expect(host.querySelector('[role="alert"]').textContent).toContain('port busy');
  expect(host.querySelector('#serial-baud-help').textContent).toContain('Connect USB');
  render([], { serial: { ...serial, mixerCommand: { pending: true } } });
  expect(host.querySelector('.serial-settings-controls button').disabled).toBe(true);
  expect(host.textContent).toContain('Wait for the motor command');
  render([], { serial: { ...serial, supported: false } });
  expect(host.querySelector('select').disabled).toBe(true);
});
