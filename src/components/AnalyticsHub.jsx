import { Suspense, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { lazyRetry } from '../lib/lazyRetry';

const OrderAnalyticsDashboard = lazyRetry(() => import('./OrderAnalyticsDashboard'));
const SearchAnalyticsDashboard = lazyRetry(() => import('./SearchAnalyticsDashboard'));
const AnalyticsControlCentre = lazyRetry(() => import('./AnalyticsControlCentre'));

export default function AnalyticsHub() {
  const [view, setView] = useState('control');

  return (
    <div className="oa-hub">
      <div className="adm-customer-tabs oa-hub-tabs">
        <button
          type="button"
          onClick={() => setView('control')}
          className={`adm-tab${view === 'control' ? ' adm-tab--active' : ''}`}
        >
          Control Centre
        </button>
        <button
          type="button"
          onClick={() => setView('orders')}
          className={`adm-tab${view === 'orders' ? ' adm-tab--active' : ''}`}
        >
          Order Analytics
        </button>
        <button
          type="button"
          onClick={() => setView('search')}
          className={`adm-tab${view === 'search' ? ' adm-tab--active' : ''}`}
        >
          Search Analytics
        </button>
      </div>

      <Suspense fallback={(
        <div className="oa-loading">
          <Loader2 size={20} className="spin" />
          <span>Loading analytics…</span>
        </div>
      )}
      >
        {view === 'control' ? <AnalyticsControlCentre /> : view === 'orders' ? <OrderAnalyticsDashboard /> : <SearchAnalyticsDashboard />}
      </Suspense>
    </div>
  );
}
