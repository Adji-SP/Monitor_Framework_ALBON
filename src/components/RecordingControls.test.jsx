import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RecordingControls } from './RecordingControls';
global.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
test('default Start requests CSV plus video; Stop is separate and only active while recording', () => {
  const recorder = { status: 'idle', isRecording: false, start: jest.fn(), stop: jest.fn() };
  act(() => root.render(<RecordingControls recorder={recorder} />));
  let buttons = host.querySelectorAll('button');
  expect(buttons[0].disabled).toBe(false); expect(buttons[1].disabled).toBe(true);
  act(() => buttons[0].click()); expect(recorder.start).toHaveBeenCalledWith(true);
  act(() => root.render(<RecordingControls recorder={{ ...recorder, status: 'recording', isRecording: true }} />));
  buttons = host.querySelectorAll('button');
  expect(buttons[0].disabled).toBe(true); expect(buttons[1].disabled).toBe(false);
  expect(host.querySelector('input').disabled).toBe(true);
  act(() => buttons[1].click()); expect(recorder.stop).toHaveBeenCalledTimes(1);
});
test('CSV-only is explicit; completed and partial recordings have separate download links', () => {
  const recorder = { status: 'idle', start: jest.fn(), stop: jest.fn() };
  act(() => root.render(<RecordingControls recorder={recorder} />));
  act(() => host.querySelector('input').click()); act(() => host.querySelector('button').click());
  expect(recorder.start).toHaveBeenCalledWith(false);
  act(() => root.render(<RecordingControls recorder={{ ...recorder, status: 'error', error: 'Upload failed',
    result: { state: 'incomplete', csvUrl: '/records/test/session.csv', videoUrl: '/records/test/dashboard.webm' } }} />));
  expect(host.textContent).toContain('Partial files:'); expect(host.textContent).toContain('Upload failed');
  expect(host.querySelectorAll('a').length).toBe(2);
});

test('compact recorder keeps start/stop and errors visible while help is collapsed', () => {
  const recorder = { status: 'idle', start: jest.fn(), stop: jest.fn() };
  act(() => root.render(<RecordingControls compact recorder={recorder} />));
  expect(host.querySelector('details').open).toBe(false);
  act(() => host.querySelector('button').click()); expect(recorder.start).toHaveBeenCalledWith(true);
  act(() => root.render(<RecordingControls compact recorder={{ ...recorder, status: 'recording', isRecording: true, sampleCount: 12 }} />));
  const stop = host.querySelectorAll('button')[1];
  expect(stop.textContent).toBe('Stop & save'); expect(stop.disabled).toBe(false);
  act(() => stop.click()); expect(recorder.stop).toHaveBeenCalledTimes(1);
  act(() => root.render(<RecordingControls compact recorder={{ ...recorder, status: 'error', error: 'Disk full' }} />));
  expect(host.querySelector('.is-error').closest('details')).toBeNull();
  expect(host.querySelector('[role="status"]').textContent).toContain('Disk full');
});
