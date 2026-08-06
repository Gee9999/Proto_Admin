import { timingSafeEqual } from 'crypto';
import { createClient } from '@supabase/supabase-js';

/**
 * Admin API auth — Supabase JWT + email allowlist.
 * Fulfillment work requires a verified admin session; shared bearer links are
 * deliberately not accepted.
 */

export const ADMIN_ROLES = Object.freeze({
  OWNER: 'owner',
  CUSTOMER_SERVICE: 'customer_service',
});

// Server-side source of truth for the current small admin team. Authorization
// is based on the verified Supabase user's email, never a browser-supplied role.
export const ADMIN_USERS = new Map([
  ['danieljoffeinfo@gmail.com', ADMIN_ROLES.OWNER],
  ['george@proto.co.za', ADMIN_ROLES.OWNER],
  ['online@proto.co.za', ADMIN_ROLES.OWNER],
]);

export const ADMIN_EMAILS = new Set(ADMIN_USERS.keys());

export function getAdminRole(email) {
  return ADMIN_USERS.get(String(email || '').trim().toLowerCase()) || null;
}

export function isOwnerEmail(email) {
  return getAdminRole(email) === ADMIN_ROLES.OWNER;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

function getSupabaseAuthClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function extractBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return '';
}

export function isAdminEmail(email) {
  return ADMIN_EMAILS.has(String(email || '').trim().toLowerCase());
}

export async function verifyAdminUser(req) {
  const token = extractBearerToken(req);
  if (!token) return null;
  try {
    const supabase = getSupabaseAuthClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user?.email || !isAdminEmail(user.email)) return null;
    return user;
  } catch {
    return null;
  }
}

export function hasAdminKey(req) {
  const expected = process.env.ADMIN_DASH_KEY;
  if (!expected) return false;
  const provided = req.headers['x-admin-key'];
  return Boolean(provided) && safeEqual(provided, expected);
}

/** Dedicated server-to-server guard for the image processor worker. */
export function hasImageProcessorSecret(req) {
  const expected = process.env.IMAGE_PROCESSOR_SECRET
    || process.env.CRON_SECRET
    || process.env.ADMIN_DASH_KEY;
  if (!expected) return false;
  const provided = String(
    req.headers['x-image-processor-secret']
    || req.headers['x-cron-secret']
    || '',
  ).trim();
  return Boolean(provided) && safeEqual(provided, expected);
}

function sendUnauthorized(res, message = 'Authentication required') {
  if (!res.headersSent) res.status(401).json({ error: message });
  return false;
}

function sendForbidden(res, message = 'Not authorized for admin access') {
  if (!res.headersSent) res.status(403).json({ error: message });
  return false;
}

/** Requires valid Supabase session for an allowlisted admin email. */
export async function requireAdminKey(req, res) {
  if (hasAdminKey(req)) return true;
  const token = extractBearerToken(req);
  if (!token) return sendUnauthorized(res);
  try {
    const supabase = getSupabaseAuthClient();
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user?.email) return sendUnauthorized(res, 'Invalid or expired session');
    if (!isAdminEmail(user.email)) return sendForbidden(res);
    return true;
  } catch {
    return sendUnauthorized(res);
  }
}


/** Requires a verified Owner account for irreversible or site-wide operations. */
export async function requireOwner(req, res) {
  // ADMIN_DASH_KEY remains an emergency server-to-server break-glass credential.
  // It is not exposed by the browser application.
  if (hasAdminKey(req)) return true;
  const user = await verifyAdminUser(req);
  if (!user) return sendUnauthorized(res, 'Invalid or expired session');
  if (!isOwnerEmail(user.email)) return sendForbidden(res, 'Owner access is required for this operation');
  return true;
}

export async function resolveRequestAuth(req) {
  if (hasAdminKey(req)) return { type: 'admin' };
  const admin = await verifyAdminUser(req);
  return admin ? { type: 'admin', user: admin } : null;
}

/**
 * Backward-compatible helper name for fulfillment routes. Shared order tokens
 * are intentionally disabled; a verified admin session is required.
 */
export async function requireAdminOrOrderToken(req, res) {
  const auth = await resolveRequestAuth(req);
  if (auth) return auth;
  return sendUnauthorized(res, 'Sign in to access fulfillment work');
}

/** Vercel cron secret or admin JWT. */
export async function requireCronOrAdminKey(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided = String(
      req.headers['x-cron-secret']
      || req.headers['authorization']?.replace(/^Bearer\s+/i, '')
      || '',
    ).trim();
    if (provided && safeEqual(provided, cronSecret)) return true;
  }
  return requireAdminKey(req, res);
}

export function requireImageProcessor(req, res) {
  if (hasImageProcessorSecret(req)) return true;
  return sendUnauthorized(res, 'Valid image processor credentials are required');
}

/** Server-to-server trade registration (register / main portal) or admin session. */
export function hasTradeRegisterSecret(req) {
  const expected = process.env.TRADE_REGISTER_SECRET || process.env.ORDER_NOTIFY_SECRET;
  if (!expected) return false;
  const provided = String(req.headers['x-trade-register-secret'] || '').trim();
  return Boolean(provided) && safeEqual(provided, expected);
}

export async function requireTradeRegisterOrAdmin(req, res) {
  if (hasTradeRegisterSecret(req)) return true;
  if (hasAdminKey(req)) return true;
  return requireAdminKey(req, res);
}
