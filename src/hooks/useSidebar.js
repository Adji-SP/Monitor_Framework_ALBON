import { useState } from 'react';

export const SIDEBAR_STORAGE_KEY = 'fermentor.sidebarCollapsed';

export function useSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (saved === 'true' || saved === 'false') return saved === 'true';
    } catch { /* The toggle still works when browser storage is unavailable. */ }
    return window.matchMedia?.('(max-width: 640px)').matches ?? false;
  });

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next)); }
    catch { /* Saving a layout preference must not interrupt monitoring. */ }
  };

  return [collapsed, toggle];
}
