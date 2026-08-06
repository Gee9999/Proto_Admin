/** Patches window.fetch with the verified admin JWT. */
import { supabase } from './supabase';
import { ADMIN_STARTUP_TIMEOUT_MS, withStartupTimeout } from './startupReliability';

export function getOrderAccessFromUrl() {
  try {
    const path = window.location.pathname || '';
    // Accept legacy /f/<orderId>/<old-token> URLs for their order ID only.
    // The trailing token is deliberately ignored; authentication is session-based.
    const match = path.match(/^\/f\/([^/]+)(?:\/[^/]+)?\/?$/);
    if (match) return { orderId: decodeURIComponent(match[1]) };
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('o') || params.get('id') || '';
    if (orderId) return { orderId };
  } catch { /* ignore */ }
  return { orderId: '' };
}

async function attachAuthHeaders(headers) {
  if (headers.has('Authorization')) return;
  try {
    const { data: { session } } = await withStartupTimeout(
      () => supabase.auth.getSession(),
      { timeoutMs: ADMIN_STARTUP_TIMEOUT_MS, label: 'Admin access token loading' },
    );
    if (session?.access_token) {
      headers.set('Authorization', `Bearer ${session.access_token}`);
      return;
    }
    const { data } = await withStartupTimeout(
      () => supabase.auth.refreshSession(),
      { timeoutMs: ADMIN_STARTUP_TIMEOUT_MS, label: 'Admin access token refresh' },
    );
    if (data.session?.access_token) {
      headers.set('Authorization', `Bearer ${data.session.access_token}`);
    }
  } catch { /* ignore */ }
}

export function installAuthFetch() {
  if (window.__protoAuthFetchInstalled) return;
  window.__protoAuthFetchInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isApiCall = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`);
    if (!isApiCall) return originalFetch(input, init);

    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined) || {});

    await attachAuthHeaders(headers);

    let response = await originalFetch(input, { ...init, headers });

    if (response.status === 401 && !getOrderAccessFromUrl().orderId) {
      try {
        const { data } = await supabase.auth.refreshSession();
        if (data.session?.access_token) {
          headers.set('Authorization', `Bearer ${data.session.access_token}`);
          response = await originalFetch(input, { ...init, headers });
        }
      } catch { /* ignore */ }
    }

    if (response.status === 401 && !getOrderAccessFromUrl().orderId) {
      window.dispatchEvent(new CustomEvent('proto-admin-unauthorized'));
    } else if (response.status === 403 && !getOrderAccessFromUrl().orderId) {
      window.dispatchEvent(new CustomEvent('proto-admin-forbidden'));
    }

    return response;
  };
}
