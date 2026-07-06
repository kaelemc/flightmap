import type { MouseEvent } from 'react';

/**
 * Navigate the navbar logo back to a fresh home (`/`). The share viewer is
 * hash-routed (`#/share/…`), so clearing the hash via an href change alone
 * won't reload — force it. Modified clicks (⌘/ctrl/shift/alt) fall through so
 * "open in new tab" still works.
 */
export function goHome(e: MouseEvent) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  // strip any share hash WITHOUT a fragment navigation (which wouldn't reload),
  // then reload the clean URL so main.tsx mounts the app fresh
  if (window.location.pathname !== '/' || window.location.hash) {
    window.history.replaceState(null, '', '/');
  }
  window.location.reload();
}
