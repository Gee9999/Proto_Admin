import { useCallback, useEffect, useMemo, useState } from 'react';
import { BrainCircuit, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { ADMIN_REFRESH_EVENT } from '../lib/adminRefresh';
import { buildApolloRecommendations, recommendationSummary } from '../lib/apolloRecommendations';

// Keep the shared period in the intersection supported by both analytics APIs.
const PERIODS = [7, 30, 90];

function priorityClass(priority) {
  return `apollo-recommendation apollo-recommendation--${priority}`;
}

export default function ApolloRecommendations() {
  const [period, setPeriod] = useState(30);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const suffix = `?period=${period}`;
      const [searchRes, orderRes] = await Promise.all([
        fetch(`/api/search-analytics-dashboard${suffix}`),
        fetch(`/api/order-analytics${suffix}`),
      ]);
      const [search, orders] = await Promise.all([searchRes.json(), orderRes.json()]);
      if (!searchRes.ok) throw new Error(search.error || 'Failed to load search signals');
      if (!orderRes.ok) throw new Error(orders.error || 'Failed to load order signals');
      setPayload({ search, orders });
    } catch (err) {
      setError(err.message || 'Failed to load Apollo advisory signals');
      setPayload(null);
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

  return (
    <div className="oa-dashboard apollo-dashboard">
      <div className="oa-toolbar">
        <div className="oa-periods" aria-label="Analytics period">
          {PERIODS.map((days) => (
            <button key={days} type="button" className={`oa-period-btn${period === days ? ' oa-period-btn--active' : ''}`} onClick={() => setPeriod(days)}>
              {days} days
            </button>
          ))}
        </div>
        <button type="button" className="oa-export-btn" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          Refresh
        </button>
      </div>

      <section className="apollo-intro oa-panel">
        <div className="apollo-intro-icon"><BrainCircuit size={24} /></div>
        <div>
          <h3>Apollo advisory insights</h3>
          <p>Read-only feedback from search, product-view, category-view, order, and customer-engagement signals. These are prompts for staff review — Apollo does not change products, contact customers, or send anything.</p>
        </div>
        <span className="apollo-readonly"><ShieldCheck size={14} /> Advisory only</span>
      </section>

      {error && <div className="oa-error">{error}</div>}
      {loading && !payload ? <div className="oa-loading"><Loader2 size={22} className="spin" /> Loading advisory signals…</div> : (
        <>
          <div className="oa-stat-grid apollo-stat-grid">
            <div className="oa-stat-card oa-stat-card--accent"><div className="oa-stat-val">{counts.high}</div><div className="oa-stat-label">High priority</div></div>
            <div className="oa-stat-card"><div className="oa-stat-val">{counts.medium}</div><div className="oa-stat-label">Review soon</div></div>
            <div className="oa-stat-card"><div className="oa-stat-val">{counts.low}</div><div className="oa-stat-label">Monitor</div></div>
            <div className="oa-stat-card"><div className="oa-stat-val">{recommendations.length}</div><div className="oa-stat-label">Total signals</div></div>
          </div>
          <section className="apollo-recommendations" aria-label="Apollo recommendations">
            {recommendations.map((row) => (
              <article key={row.id} className={priorityClass(row.priority)}>
                <div className="apollo-recommendation-head"><span className={`sa-badge sa-badge--${row.priority === 'high' ? 'red' : 'amber'}`}>{row.priority}</span><h3>{row.title}</h3></div>
                <p>{row.detail}</p>
                <div className="apollo-recommendation-foot"><span><strong>Evidence:</strong> {row.evidence}</span><span><strong>Suggested review:</strong> {row.action}</span></div>
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
