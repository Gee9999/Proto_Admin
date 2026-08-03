import { supabase } from './supabase';
import {
  ADMIN_STARTUP_TIMEOUT_MS,
  isMissingAuthSession,
  withStartupTimeout,
} from './startupReliability';

export const ADMIN_ROLES = Object.freeze({
  OWNER: 'owner',
  CUSTOMER_SERVICE: 'customer_service',
});

// Presentation mirror of the server-side role map. The server always makes
// the authorization decision; this only keeps the workspace focused.
const ADMIN_USERS = new Map([
  ['danieljoffeinfo@gmail.com', ADMIN_ROLES.OWNER],
  ['george@proto.co.za', ADMIN_ROLES.OWNER],
  ['online@proto.co.za', ADMIN_ROLES.OWNER],
]);

export const ADMIN_EMAILS = new Set(ADMIN_USERS.keys());

export function getAdminRole(email) {
  return ADMIN_USERS.get(String(email || '').trim().toLowerCase()) || null;
}

export function isAllowedAdminEmail(email) {
  return Boolean(getAdminRole(email));
}

export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

/** Validates JWT with Supabase — use on boot instead of getSession() alone. */
export async function getVerifiedSession() {
  const { data: { user }, error } = await withStartupTimeout(
    () => supabase.auth.getUser(),
    { timeoutMs: ADMIN_STARTUP_TIMEOUT_MS, label: 'Supabase session verification' },
  );
  if (error) {
    if (isMissingAuthSession(error)) return null;
    throw error;
  }
  if (!user?.email) return null;
  if (!isAllowedAdminEmail(user.email)) {
    await supabase.auth.signOut();
    return null;
  }
  const { data: { session }, error: sessionError } = await withStartupTimeout(
    () => supabase.auth.getSession(),
    { timeoutMs: ADMIN_STARTUP_TIMEOUT_MS, label: 'Admin session loading' },
  );
  if (sessionError) throw sessionError;
  return session;
}

export async function verifyAdminSession() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ADMIN_STARTUP_TIMEOUT_MS);
  try {
    const res = await fetch('/api/auth-check', { cache: 'no-store', signal: controller.signal });
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) return false;
    throw new Error(`Admin session service returned ${res.status}`);
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Admin session service timed out');
      timeoutError.code = 'startup_timeout';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getAccessToken() {
  const session = await getSession();
  return session?.access_token || '';
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email).trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  if (!isAllowedAdminEmail(data.user?.email)) {
    await supabase.auth.signOut();
    throw new Error('This account is not authorized for the admin dashboard.');
  }
  return data.session;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function requestPasswordReset(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new Error('Email is required');
  if (!isAllowedAdminEmail(normalized)) {
    throw new Error('This email is not authorized for the admin dashboard.');
  }
  const res = await fetch('/api/admin-forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normalized }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Failed to send reset email');
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}
