import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { installAuthFetch } from './lib/adminKey';
import { clearChunkReloadGuard, lazyRetry } from './lib/lazyRetry';
import {
  getVerifiedSession,
  getAdminRole,
  isAllowedAdminEmail,
  onAuthStateChange,
  signOut,
  verifyAdminSession,
} from './lib/auth';
import { PROTO_URLS } from './lib/protoUrls';
import QueryProvider from './components/QueryProvider';
import AdminLoginPage from './components/AdminLoginPage';
import AdminResetPasswordPage from './components/AdminResetPasswordPage';
import AdminStartupBoundary from './components/AdminStartupBoundary';
import { startupErrorMessage } from './lib/startupReliability';

const AdminPage = lazyRetry(() => import('./pages/AdminPage'));
const FulfillmentPage = lazyRetry(() => import('./pages/FulfillmentPage'));

installAuthFetch();

const loadingFallback = (
  <div className="adm-login-page">
    <div className="adm-login-layout">
      <div className="adm-login-card adm-login-card--loading">Loading dashboard…</div>
    </div>
  </div>
);

export default function Root() {
  const path = window.location.pathname;
  const isFulfillment = path === '/fulfillment' || path === '/f' || path.startsWith('/f/');
  const isResetPassword = path === '/reset-password';

  if (isFulfillment) return <AdminGate fulfillment />;

  if (isResetPassword) {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    return (
      <AdminResetPasswordPage
        token={token}
        onDone={() => { window.location.replace('/'); }}
      />
    );
  }

  return <AdminGate />;
}

function AdminGate({ fulfillment = false }) {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [startupError, setStartupError] = useState('');
  const mountedRef = useRef(true);
  const attemptRef = useRef(0);

  const resolveSession = useCallback(async (candidate = null) => {
    const attempt = ++attemptRef.current;
    setBooting(true);
    setStartupError('');
    try {
      const verified = candidate?.access_token ? candidate : await getVerifiedSession();
      if (!verified?.access_token) {
        if (mountedRef.current && attempt === attemptRef.current) {
          setSession(null);
          setBooting(false);
        }
        return;
      }
      const ok = await verifyAdminSession();
      if (!ok) {
        await signOut();
        if (mountedRef.current && attempt === attemptRef.current) {
          setSession(null);
          setBooting(false);
        }
        return;
      }
      if (mountedRef.current && attempt === attemptRef.current) {
        setSession(verified);
        setBooting(false);
      }
    } catch (error) {
      if (mountedRef.current && attempt === attemptRef.current) {
        setStartupError(startupErrorMessage(error));
        setBooting(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void resolveSession();

    const { data: { subscription } } = onAuthStateChange(async (s) => {
      if (!mountedRef.current) return;
      if (!s?.access_token) {
        setSession(null);
        setStartupError('');
        setBooting(false);
        return;
      }
      const email = s.user?.email || '';
      if (!isAllowedAdminEmail(email)) {
        await signOut();
        setSession(null);
        setBooting(false);
        return;
      }
      await resolveSession(s);
    });

    const onUnauthorized = () => { void signOut().then(() => setSession(null)); };
    // 403 means the server rejected this user's email — sign out so they can re-auth with a valid account
    const onForbidden = () => {
      void getVerifiedSession().then((s) => {
        if (!s || !isAllowedAdminEmail(s.user?.email || '')) {
          void signOut().then(() => setSession(null));
        }
      });
    };
    window.addEventListener('proto-admin-unauthorized', onUnauthorized);
    window.addEventListener('proto-admin-forbidden', onForbidden);
    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      window.removeEventListener('proto-admin-unauthorized', onUnauthorized);
      window.removeEventListener('proto-admin-forbidden', onForbidden);
    };
  }, [resolveSession]);

  if (booting) return loadingFallback;

  if (startupError) {
    return (
      <AdminStartupRecovery
        message={startupError}
        onRetry={() => void resolveSession()}
        onSignOut={() => void signOut().finally(() => {
          setSession(null);
          setStartupError('');
        })}
      />
    );
  }

  const email = session?.user?.email || '';
  const allowed = session && isAllowedAdminEmail(email);

  if (!allowed) {
    return (
      <AdminLoginPage
        forbidden={!!session && !isAllowedAdminEmail(email)}
        onSignedIn={() => void resolveSession()}
      />
    );
  }

  const customer = {
    id: session.user.id,
    name: session.user.user_metadata?.name || email.split('@')[0],
    email,
    role: getAdminRole(email),
  };

  return (
    <QueryProvider>
      <AdminStartupBoundary>
        <Suspense fallback={loadingFallback}>
          <LoadedAdminRoute>
            {fulfillment ? (
              <FulfillmentPage />
            ) : (
              <AdminPage
                customer={customer}
                onSignOut={() => void signOut().then(() => setSession(null))}
                onViewPortal={() => { window.location.href = PROTO_URLS.site; }}
              />
            )}
          </LoadedAdminRoute>
        </Suspense>
      </AdminStartupBoundary>
    </QueryProvider>
  );
}

function LoadedAdminRoute({ children }) {
  // Clear the one-shot stale-chunk guard only after the protected route has
  // rendered successfully. Clearing it at Root mount can create reload loops.
  useEffect(() => { clearChunkReloadGuard(); }, []);
  return children;
}

function AdminStartupRecovery({ message, onRetry, onSignOut }) {
  return (
    <div className="adm-login-page">
      <div className="adm-login-layout">
        <div className="adm-login-card adm-startup-recovery" role="alert">
          <div className="adm-login-logo" aria-hidden="true">P</div>
          <h1>Admin connection interrupted</h1>
          <p>{message}</p>
          <p className="adm-muted">No catalogue, customer or order data was changed.</p>
          <div className="adm-startup-recovery-actions">
            <button type="button" className="adm-btn-red" onClick={onRetry}>Try again</button>
            <button type="button" className="adm-btn-ghost" onClick={onSignOut}>Return to sign in</button>
          </div>
        </div>
      </div>
    </div>
  );
}
