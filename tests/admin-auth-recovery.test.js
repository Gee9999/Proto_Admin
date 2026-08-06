import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../src/lib/supabase.js', () => ({
  supabase: { auth: authMocks },
}));

import { getVerifiedSession, verifyAdminSession } from '../src/lib/auth.js';

describe('Admin authentication recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    authMocks.getUser.mockReset();
    authMocks.getSession.mockReset();
    authMocks.signOut.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('treats a genuinely missing session as signed out', async () => {
    authMocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: 'AuthSessionMissingError', message: 'Auth session missing' },
    });
    await expect(getVerifiedSession()).resolves.toBeNull();
  });

  it('does not disguise a temporary Supabase failure as a logout', async () => {
    const failure = new TypeError('Failed to fetch');
    authMocks.getUser.mockResolvedValue({ data: { user: null }, error: failure });
    await expect(getVerifiedSession()).rejects.toBe(failure);
    expect(authMocks.signOut).not.toHaveBeenCalled();
  });

  it('returns the allowed verified session', async () => {
    const session = { access_token: 'test-token', user: { email: 'online@proto.co.za' } };
    authMocks.getUser.mockResolvedValue({ data: { user: session.user }, error: null });
    authMocks.getSession.mockResolvedValue({ data: { session }, error: null });
    await expect(getVerifiedSession()).resolves.toBe(session);
  });

  it('returns false only for a real authorization rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(verifyAdminSession()).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(verifyAdminSession()).resolves.toBe(false);
  });

  it('surfaces a temporary server failure for the recovery screen', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(verifyAdminSession()).rejects.toThrow('returned 503');
  });

  it('aborts a session check that never responds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })));
    const check = verifyAdminSession();
    const rejection = expect(check).rejects.toMatchObject({ code: 'startup_timeout' });
    await vi.advanceTimersByTimeAsync(8_000);
    await rejection;
  });
});
