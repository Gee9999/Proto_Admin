import { Suspense, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { lazyRetry } from '../lib/lazyRetry';

const OrderAnalyticsDashboard = lazyRetry(() => import('./OrderAnalyticsDashboard'));
const SearchAnalyticsDashboard = lazyRetry(() => import('./SearchAnalyticsDashboard'));
const ApolloRecommendations = lazyRetry(() => import('./ApolloRecommendations'));
const AnalyticsControlCentre = lazyRetry(() => import('./AnalyticsControlCentre'));
const SalesFunnelAnalytics = lazyRetry(() => import('./SalesFunnelAnalytics'));
const ProductProfitabilityDashboard = lazyRetry(() => import('./ProductProfitabilityDashboard'));
const StockIntelligencePanel = lazyRetry(() => import('./StockIntelligencePanel'));

const VIEWS = [
  ['overview', 'Control Centre'],
  ['orders', 'Order Analytics'],
  ['search', 'Search Analytics'],
  ['funnel', 'Sales Funnel'],
  ['profitability', 'Product Profitability'],
  ['stock', 'Stock Intelligence'],
  ['apollo', 'Apollo Insights'],
];

function AnalyticsView({ view }) {
  if (view === 'orders') return <OrderAnalyticsDashboard />;
  if (view === 'search') return <SearchAnalyticsDashboard />;
  if (view === 'funnel') return <SalesFunnelAnalytics />;
  if (view === 'profitability') return <ProductProfitabilityDashboard />;
  if (view === 'stock') return <StockIntelligencePanel />;
  if (view === 'apollo') return <ApolloRecommendations />;
  return <AnalyticsControlCentre />;
}

export default function AnalyticsHub() {
  const [view, setView] = useState('overview');

  return (
    <div className="oa-hub">
      <div className="adm-customer-tabs oa-hub-tabs">
        {VIEWS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={`adm-tab${view === key ? ' adm-tab--active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      <Suspense fallback={(
        <div className="oa-loading">
          <Loader2 size={20} className="spin" />
          <span>Loading analytics…</span>
        </div>
      )}
      >
        <AnalyticsView view={view} />
      </Suspense>
    </div>
  );
}
