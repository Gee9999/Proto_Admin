import { describe, expect, it, vi } from 'vitest';
import {
  isMissingAuthSession,
  StartupTimeoutError,
  startupErrorMessage,
  withStartupTimeout,
} from '../src/lib/startupReliability.js';
import { isChunkLoadError } from '../src/lib/lazyRetry.js';

describe('Admin startup reliability', () => {
  it('bounds unresolved startup work instead of loading forever', async () => {
    vi.useFakeTimers();
    const outcome = withStartupTimeout(() => new Promise(() => {}), {
      timeoutMs: 50,
      label: 'Secure session',
    });
    const rejection = expect(outcome).rejects.toMatchObject({
      name: 'StartupTimeoutError',
      code: 'startup_timeout',
    });
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    vi.useRealTimers();
  });

  it('clears its deadline when startup succeeds', async () => {
    vi.useFakeTimers();
    await expect(withStartupTimeout(Promise.resolve('ready'), { timeoutMs: 50 })).resolves.toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('distinguishes a missing session from a temporary provider failure', () => {
    expect(isMissingAuthSession({ name: 'AuthSessionMissingError' })).toBe(true);
    expect(isMissingAuthSession({ code: 'session_not_found' })).toBe(true);
    expect(isMissingAuthSession(new TypeError('Failed to fetch'))).toBe(false);
  });

  it('gives timeouts a clear recovery message', () => {
    const error = new StartupTimeoutError('Supabase session verification', 8_000);
    expect(startupErrorMessage(error)).toContain('took too long');
    expect(startupErrorMessage(new Error('network down'))).toContain('could not verify');
  });

  it('classifies a dashboard-module deadline as a recoverable chunk error', () => {
    expect(isChunkLoadError(new StartupTimeoutError('Dashboard module', 15_000))).toBe(true);
  });
});
