import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = readFileSync(new URL('../src/Root.jsx', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../src/lib/auth.js', import.meta.url), 'utf8');
const adminKey = readFileSync(new URL('../src/lib/adminKey.js', import.meta.url), 'utf8');
const boundary = readFileSync(new URL('../src/components/AdminStartupBoundary.jsx', import.meta.url), 'utf8');

describe('Admin startup UI contract', () => {
  it('offers recovery instead of an indefinite loading card', () => {
    expect(root).toContain('Admin connection interrupted');
    expect(root).toContain('Try again');
    expect(root).toContain('Return to sign in');
    expect(root).toContain('No catalogue, customer or order data was changed.');
  });

  it('only signs out for an explicit authorization rejection', () => {
    expect(auth).toContain('res.status === 401 || res.status === 403');
    expect(auth).toContain('throw new Error(`Admin session service returned ${res.status}`)');
    expect(root).toContain('setStartupError(startupErrorMessage(error))');
  });

  it('bounds API token lookup before protected requests are sent', () => {
    expect(adminKey).toContain('withStartupTimeout');
    expect(adminKey).toContain("label: 'Admin access token loading'");
    expect(adminKey).toContain("label: 'Admin access token refresh'");
  });

  it('clears stale-chunk protection only after the protected route renders', () => {
    expect(root).toContain('function LoadedAdminRoute');
    expect(root).toContain('<LoadedAdminRoute>');
    expect(root).toContain('useEffect(() => { clearChunkReloadGuard(); }, [])');
    const rootFunction = root.slice(root.indexOf('export default function Root()'), root.indexOf('function AdminGate'));
    expect(rootFunction).not.toContain('clearChunkReloadGuard');
  });

  it('has a last-resort reload path for stale dashboard bundles', () => {
    expect(boundary).toContain('Dashboard could not finish loading');
    expect(boundary).toContain('Reload dashboard');
    expect(boundary).toContain('window.location.reload()');
  });
});
