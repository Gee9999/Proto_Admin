import { useEffect, useState, Suspense } from 'react';
import { installAuthFetch, hasFulfillmentToken } from './lib/adminKey';
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
  // Clear the one-shot chunk-reload guard only AFTER a successful mount, so a
  // stale-chunk reload that fixed things isn't undone before the app renders
  // (and a failed initial load can't spin in a reload loop).
  useEffect(() => { clearChunkReloadGuard(); }, []);

  const path = window.location.pathname;
  const isFulfillment = path === '/fulfillment' || path === '/f' || path.startsWith('/f/');
  const isResetPassword = path === '/reset-password';

  // A signed fulfilment link IS the credential — the packing team opens it on
  // a phone with no admin account, so it must not meet the login screen. The
  // token is verified server-side on every API call it makes.
  if (isFulfillment && hasFulfillmentToken()) {
    return (
      <QueryProvider>
        <Suspense fallback={loadingFallback}>
          <FulfillmentPage linkMode />
        </Suspense>
      </QueryProvider>
    );
  }

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

  useEffect(() => {
    let mounted = true;

    async function resolveSession() {
      try {
        const verified = await getVerifiedSession();
        if (!verified?.access_token) {
          if (mounted) {
            setSession(null);
            setBooting(false);
          }
          return;
        }
        const ok = await verifyAdminSession();
        if (!ok) {
          await signOut();
          if (mounted) {
            setSession(null);
            setBooting(false);
          }
          return;
        }
        if (mounted) {
          setSession(verified);
          
          setBooting(false);
        }
      } catch {
        if (mounted) {
          setSession(null);
          setBooting(false);
        }
      }
    }

    void resolveSession();

    const { data: { subscription } } = onAuthStateChange(async (s) => {
      if (!mounted) return;
      if (!s?.access_token) {
        setSession(null);
        return;
      }
      const email = s.user?.email || '';
      if (!isAllowedAdminEmail(email)) {
        await signOut();
        setSession(null);
        return;
      }
      const ok = await verifyAdminSession();
      if (!ok) {
        await signOut();
        setSession(null);
        return;
      }
      setSession(s);
      
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
      mounted = false;
      subscription.unsubscribe();
      window.removeEventListener('proto-admin-unauthorized', onUnauthorized);
      window.removeEventListener('proto-admin-forbidden', onForbidden);
    };
  }, []);

  if (booting) return loadingFallback;

  const email = session?.user?.email || '';
  const allowed = session && isAllowedAdminEmail(email);

  if (!allowed) {
    return (
      <AdminLoginPage
        forbidden={!!session && !isAllowedAdminEmail(email)}
        onSignedIn={() => {
          void getVerifiedSession().then(async (s) => {
            if (!s) {
              setSession(null);
              return;
            }
            const ok = await verifyAdminSession();
            if (!ok) {
              await signOut();
              setSession(null);
              return;
            }
            setSession(s);
            
          });
        }}
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
      <Suspense fallback={loadingFallback}>
        {fulfillment ? (
          <FulfillmentPage />
        ) : (
          <AdminPage
            customer={customer}
            onSignOut={() => void signOut().then(() => setSession(null))}
            onViewPortal={() => { window.location.href = PROTO_URLS.site; }}
          />
        )}
      </Suspense>
    </QueryProvider>
  );
}
