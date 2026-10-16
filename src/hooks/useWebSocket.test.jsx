import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useWebSocket } from './useWebSocket';

global.IS_REACT_ACT_ENVIRONMENT = true;
const originalWebSocket = global.WebSocket;
let host, root, current;
class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static sockets = [];
  constructor() { this.readyState = 0; this.sent = []; FakeSocket.sockets.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
function Probe() { current = useWebSocket(); return null; }
const mixer = { version: 1, boot_id: 42, revision: 1, armed: false, hmi_connected: true };
beforeEach(() => {
  jest.useFakeTimers(); global.WebSocket = FakeSocket; FakeSocket.sockets = [];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<Probe />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); global.WebSocket = originalWebSocket; jest.useRealTimers(); });
const ready = () => {
  const ws = FakeSocket.sockets.at(-1);
  act(() => { ws.open(); ws.receive({ type: 'handshake_response', mixerControlAvailable: true }); ws.receive({ type: 'mixer_status', data: mixer }); });
  return ws;
};

test('command result is matched by ID; STOP supersedes a pending RESUME', () => {
  const ws = ready();
  act(() => current.sendMixerCommand('RESUME'));
  const resume = ws.sent.at(-1);
  expect(current.mixerCommand.pending).toBe(true);
  expect(current.mixer.armed).toBe(false); // no optimistic state
  act(() => current.sendMixerCommand('STOP'));
  const stop = ws.sent.at(-1);
  act(() => ws.receive({ type: 'mixer_command_result', requestId: resume.requestId, ok: true }));
  expect(current.mixerCommand.action).toBe('STOP'); expect(current.mixerCommand.pending).toBe(true);
  act(() => ws.receive({ type: 'mixer_command_result', requestId: stop.requestId, action: 'STOP', ok: true, detail: 'Confirmed' }));
  expect(current.mixerCommand.ok).toBe(true); expect(current.mixerCommand.pending).toBe(false);
});

test('lost connection clears live state and never replays a command after reconnect', () => {
  const ws = ready(); act(() => current.sendMixerCommand('RESUME'));
  act(() => ws.close());
  expect(current.mixer).toBeNull(); expect(current.mixerCommand.ok).toBe(false);
  act(() => jest.advanceTimersByTime(4000));
  const reconnect = ready();
  expect(reconnect.sent.some((s) => s.type === 'mixer_command')).toBe(false);
  act(() => root.unmount());
  act(() => jest.advanceTimersByTime(5000));
  expect(FakeSocket.sockets.length).toBe(2);
});

test('timeout is unknown, not success; stale telemetry blocks RESUME but not STOP', () => {
  const ws = ready(); act(() => current.sendMixerCommand('RESUME'));
  act(() => jest.advanceTimersByTime(5000));
  expect(current.mixerCommand.ok).toBe(false);
  expect(current.mixerCommand.detail).toContain('unknown');
  const sent = ws.sent.length;
  act(() => current.sendMixerCommand('RESUME')); expect(ws.sent.length).toBe(sent);
  act(() => current.sendMixerCommand('STOP')); expect(ws.sent.length).toBe(sent + 1);
});
