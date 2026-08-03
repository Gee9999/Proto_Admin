import { lazy } from 'react';
import { ADMIN_CHUNK_TIMEOUT_MS, withStartupTimeout } from './startupReliability';

const CHUNK_RELOAD_KEY = 'proto-admin-chunk-reload';

/** Detect dynamic-import / hashed-chunk failures across browsers. */
export function isChunkLoadError(error) {
  const msg = String(error?.message || error || '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\d]+ failed|Unable to preload CSS|dashboard module did not finish/i.test(msg);
}

function reloadOnceForChunkError() {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Clear the one-shot reload guard after a successful boot. */
export function clearChunkReloadGuard() {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch { /* ignore */ }
}

export function importWithRetry(importFn) {
  return importFn().catch((error) => {
    if (isChunkLoadError(error) && reloadOnceForChunkError()) {
      return new Promise(() => {});
    }
    throw error;
  });
}

export function lazyRetry(importFn) {
  return lazy(() => withStartupTimeout(
    () => importWithRetry(importFn),
    { timeoutMs: ADMIN_CHUNK_TIMEOUT_MS, label: 'Dashboard module' },
  ));
}

/** Install global handlers for Vite preload + unhandled dynamic import failures. */
export function installChunkLoadRecovery() {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadOnceForChunkError();
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadError(event.reason)) {
      event.preventDefault();
      reloadOnceForChunkError();
    }
  });
}
