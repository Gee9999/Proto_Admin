import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, BrainCircuit, Loader2, RefreshCw, TrendingUp, Users } from 'lucide-react';
import { ADMIN_REFRESH_EVENT } from '../lib/adminRefresh';
import { buildApolloRecommendations, recommendationSummary } from '../lib/apolloRecommendations';

const PERIODS = [7, 30, 90];

function money(value) {
  return `R ${Number(value || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
}

function Metric({ label, value, note, icon: Icon, accent = false }) {
  return (
    <div className={`acc-metric${accent ? ' acc-metric--accent' : ''}`}>
      <div className="acc-metric-label">{Icon && <Icon size={14} />} {label}</div>
      <strong>{value}</strong>
      {note && <span>{note}</span>}
    </div>
  );
}

export default function AnalyticsControlCentre() {
  const [period, setPeriod] = useState(30);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const suffix = `?period=${period}`;
      const [ordersRes, searchRes] = await Promise.all([
        fetch(`/api/order-analytics${suffix}`),
        fetch(`/api/search-analytics-dashboard${suffix}`),
      ]);
      const [orders, search] = await Promise.all([ordersRes.json(), searchRes.json()]);
      if (!ordersRes.ok) throw new Error(orders.error || 'Order analytics unavailable');
      if (!searchRes.ok) throw new Error(search.error || 'Search analytics unavailable');
      setPayload({ orders, search });
    } catch (err) {
      setPayload(null);
      setError(err.message || 'Analytics unavailable');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onRefresh = (event) => { if (event.detail === 'analytics') void load(); };
    window.addEventListener(ADMIN_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(ADMIN_REFRESH_EVENT, onRefresh);
  }, [load]);

  const recommendations = useMemo(() => buildApolloRecommendations(payload || {}), [payload]);
  const counts = useMemo(() => recommendationSummary(recommendations), [recommendations]);
  const summary = payload?.orders?.summary || {};
  const searchKpis = payload?.search?.kpis || {};
  const attention = recommendations.slice(0, 3);

  return (
    <div className="acc-dashboard">
      <header className="acc-header">
        <div>
          <p className="acc-eyebrow">PROTO ANALYTICS</p>
          <h2>Analytics Control Centre</h2>
          <p>One view of what customers are buying, searching for, viewing and ignoring — with Apollo recommendations for the next review.</p>
        </div>
        <div className="acc-controls">
          <div className="oa-periods" aria-label="Analytics period">
            {PERIODS.map((days) => <button key={days} type="button" className={`oa-period-btn${period === days ? ' oa-period-btn--active' : ''}`} onClick={() => setPeriod(days)}>{days} days</button>)}
          </div>
          <button type="button" className="adm-btn-ghost" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        </div>
      </header>

      {error && <div className="oa-error" role="alert">{error}</div>}
      {loading && !payload ? <div className="oa-loading"><Loader2 size={20} className="spin" /> Loading control centre…</div> : (
        <>
          <div className="acc-metrics">
            <Metric label="Revenue" value={money(summary.totalRevenue)} note={`${period}-day period`} icon={TrendingUp} accent />
            <Metric label="Orders" value={Number(summary.totalOrders || 0).toLocaleString('en-ZA')} note={`${summary.customersWhoOrdered || 0} customers ordered`} icon={TrendingUp} />
            <Metric label="Search → order" value={`${searchKpis.conversionPct || 0}%`} note={`${searchKpis.totalSearches || 0} searches`} icon={ArrowRight} />
            <Metric label="Repeat customers" value={`${summary.repeatCustomerPct || 0}%`} note="of ordering customers" icon={Users} />
          </div>

          <section className="acc-attention oa-panel" aria-labelledby="acc-attention-title">
            <div className="acc-section-head"><div><p className="acc-eyebrow">APOLLO REVIEW QUEUE</p><h3 id="acc-attention-title">What needs attention?</h3></div><span className="acc-signal-count"><AlertTriangle size={14} /> {counts.high + counts.medium} review signals</span></div>
            <div className="acc-recommendations">
              {attention.map((row) => <article key={row.id} className={`acc-recommendation acc-recommendation--${row.priority}`}><div><span className="acc-priority">{row.priority}</span><h4>{row.title}</h4><p>{row.detail}</p></div><div className="acc-evidence"><strong>{row.evidence}</strong><span>{row.action}</span></div></article>)}
            </div>
            <div className="acc-queue-footer"><BrainCircuit size={15} /> Advisory only — no product, customer or communication changes are made from this view. Open Apollo Insights for the complete queue.</div>
          </section>

          <div className="acc-two-col">
            <section className="oa-panel"><div className="acc-section-head"><div><p className="acc-eyebrow">CUSTOMER BEHAVIOUR</p><h3>Funnel health</h3></div></div><div className="acc-funnel-row"><strong>{searchKpis.totalSearches || 0}</strong><span>searches</span><ArrowRight size={15} /><strong>{searchKpis.searchesWithResults || 0}</strong><span>with results</span><ArrowRight size={15} /><strong>{searchKpis.funnel?.orders || 0}</strong><span>orders</span></div><p className="oa-muted">Use the Search Analytics tab to find the exact terms and no-result gaps.</p></section>
            <section className="oa-panel"><div className="acc-section-head"><div><p className="acc-eyebrow">COMMERCIAL SIGNAL</p><h3>Top customer value</h3></div></div><div className="acc-value-row"><strong>{money(summary.avgOrderValue)}</strong><span>average order value</span></div><div className="acc-value-row"><strong>{summary.customersWhoOrdered || 0}</strong><span>customers ordered online</span></div><p className="oa-muted">Compare this with inactive and high-value segments in Email CRM.</p></section>
          </div>
        </>
      )}
    </div>
  );
}
