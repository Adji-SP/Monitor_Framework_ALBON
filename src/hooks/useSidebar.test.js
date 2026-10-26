import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SIDEBAR_STORAGE_KEY, useSidebar } from './useSidebar';

global.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
const originalMatchMedia = window.matchMedia;
function Harness() {
  const [collapsed, toggle] = useSidebar();
  return <button onClick={toggle} aria-expanded={!collapsed}>{String(collapsed)}</button>;
}
beforeEach(() => {
  localStorage.clear();
  window.matchMedia = jest.fn(() => ({ matches: false }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); jest.restoreAllMocks();
  window.matchMedia = originalMatchMedia; localStorage.clear();
});
const render = () => act(() => root.render(<Harness />));

test('desktop starts expanded and remembers both toggle directions across remounts', () => {
  render();
  expect(host.textContent).toBe('false');
  act(() => host.querySelector('button').click());
  expect(host.textContent).toBe('true');
  expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('true');
  act(() => root.render(null)); render();
  expect(host.textContent).toBe('true');
  act(() => host.querySelector('button').click());
  expect(host.textContent).toBe('false');
  expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('false');
});

test('small screens default to collapsed unless the user saved an explicit preference', () => {
  window.matchMedia = jest.fn(() => ({ matches: true }));
  render();
  expect(host.textContent).toBe('true');
  expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 640px)');
  act(() => root.render(null)); localStorage.setItem(SIDEBAR_STORAGE_KEY, 'false'); render();
  expect(host.textContent).toBe('false');
});

test('blocked storage does not prevent toggling the sidebar', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  render();
  expect(host.textContent).toBe('false');
  act(() => host.querySelector('button').click());
  expect(host.textContent).toBe('true');
});

test('unrecognized storage value falls back to the screen size', () => {
  localStorage.setItem(SIDEBAR_STORAGE_KEY, 'invalid');
  render(); expect(host.textContent).toBe('false');
});
