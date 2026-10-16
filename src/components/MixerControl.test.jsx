import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MixerControl } from './MixerControl';

global.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const frame = () => ({ boot_id: 1, revision: 2, state: 'AUTO PAUSED', armed: false,
  output_pwm: 0, configured_pwm: 64, target_rpm: 3, hmi_connected: true,
  receivedAt: Date.now(), start_delay_ms: 30000, run_duration_ms: 120000, interval_ms: 21600000 });
const render = (props) => act(() => root.render(<MixerControl wsStatus="CONNECTED" controlAvailable onCommand={() => {}} {...props} />));
beforeEach(() => { jest.useFakeTimers(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); jest.useRealTimers(); });

test('resume needs a deliberate confirmation; STOP is immediately available', () => {
  const send = jest.fn(); render({ mixer: frame(), onCommand: send });
  const [stop, resume] = host.querySelectorAll('button');
  expect(stop.disabled).toBe(false); expect(resume.disabled).toBe(true);
  act(() => host.querySelector('input').click());
  expect(resume.disabled).toBe(false);
  act(() => resume.click());
  expect(send).toHaveBeenCalledWith('RESUME'); expect(resume.disabled).toBe(true);
  act(() => stop.click()); expect(send).toHaveBeenLastCalledWith('STOP');
});

test('stale telemetry/Nextion loss/disconnected WebSocket never appear live or enable resume', () => {
  const mixer = frame(); render({ mixer });
  act(() => host.querySelector('input').click());
  act(() => jest.advanceTimersByTime(2500));
  expect(host.textContent).toContain('Status unavailable');
  expect(host.querySelectorAll('button')[1].disabled).toBe(true);
  expect(host.querySelectorAll('button')[0].disabled).toBe(false);
  render({ mixer: { ...frame(), hmi_connected: false } });
  expect(host.textContent).toContain('Offline · blocked');
  expect(host.querySelector('input').disabled).toBe(true);
  render({ mixer: frame(), wsStatus: 'DISCONNECTED' });
  expect(host.querySelectorAll('button')[0].disabled).toBe(true);
});

test('STOP remains possible during resume acknowledgement; status and errors stay honest', () => {
  render({ mixer: { ...frame(), armed: true, state: 'AUTO FWD', output_pwm: 64, run_remaining_ms: 120000 },
    command: { action: 'RESUME', pending: true, detail: 'Waiting for ESP32' } });
  expect(host.textContent).toContain('00:02:00');
  expect(host.textContent).toContain('actual shaft speed is not measured');
  expect(host.querySelectorAll('button')[0].disabled).toBe(false);
  render({ mixer: null, command: { action: 'STOP', ok: false, detail: 'Result unknown' } });
  expect(host.querySelector('[role="status"]').textContent).toContain('Result unknown');
  expect(host.querySelector('[data-error="true"]')).not.toBeNull();
});

test('compact layout retains confirmation, immediate STOP and visible warnings outside details', () => {
  const send = jest.fn(); render({ compact: true, mixer: frame(), onCommand: send });
  const [stop, resume] = host.querySelectorAll('button');
  expect(host.querySelector('details').open).toBe(false);
  expect(stop.closest('details')).toBeNull(); expect(resume.disabled).toBe(true);
  act(() => host.querySelector('input').click());
  act(() => resume.click()); expect(send).toHaveBeenCalledWith('RESUME');
  act(() => stop.click()); expect(send).toHaveBeenLastCalledWith('STOP');
  render({ compact: true, mixer: null, command: { action: 'STOP', ok: false, detail: 'Result unknown' } });
  expect(host.querySelector('.notice.is-warn').closest('details')).toBeNull();
  expect(host.querySelector('[role="status"]').closest('details')).toBeNull();
  expect(host.querySelector('[role="status"]').textContent).toContain('Result unknown');
  expect(host.querySelector('.card-body > .mixer-safety').textContent).toContain('Not a physical emergency stop');
});
