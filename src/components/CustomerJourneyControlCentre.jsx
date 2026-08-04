import { useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, Route, ShieldCheck, Sparkles } from 'lucide-react';
import { fetchCustomerJourneySummary } from '../lib/customerJourney';

const LABELS = {
  registration: 'Registration', authentication: 'Sign-in & recovery', basket: 'Basket', checkout: 'Checkout',
  hot: 'Proven sellers', specials: 'Specials', start: 'Full catalogue', dismissed: 'Skipped',
};

const label = (key) => LABELS[key] || String(key || '').replaceAll('_', ' ');

export default function CustomerJourneyControlCentre() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try { setData(await fetchCustomerJourneySummary(days)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const journeyRows = useMemo(() => Object.entries(data?.journeys || {}).sort((a, b) => b[1] - a[1]), [data]);
  const eventRows = useMemo(() => Object.entries(data?.events || {}).sort((a, b) => b[1] - a[1]).slice(0, 8), [data]);

  return (
    <section className="journey-control" aria-labelledby="journey-control-title">
      <div className="adm-section-head">
        <div><h2 className="adm-section-title" id="journey-control-title">Customer Journey Control Centre</h2><p className="adm-section-note">A read-only view of where customers progress, pause or need help. No customer record can be changed here.</p></div>
        <div className="journey-control-actions">
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Journey reporting period"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
          <button type="button" className="adm-btn-ghost" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button>
        </div>
      </div>
      <div className="journey-readonly"><ShieldCheck size={17} /> Read-only staff intelligence. It never approves customers, sends messages or changes orders.</div>
      {error && <div className="journey-error" role="alert">{error}</div>}
      {!error && (
        <>
          <div className="journey-metrics">
            <article><Activity /><span>Journey events</span><strong>{Number(data?.totalEvents || 0).toLocaleString()}</strong><small>Latest {days} days</small></article>
            <article><Route /><span>Active journey areas</span><strong>{journeyRows.length}</strong><small>Registration through checkout</small></article>
            <article><Sparkles /><span>Buying assistants completed</span><strong>{data?.assistant?.available ? Number(data.assistant.completed).toLocaleString() : 'Draft'}</strong><small>{data?.assistant?.available ? 'Stored completions' : 'Available after migration 064'}</small></article>
          </div>
          <div className="journey-grid">
            <article><h3>Activity by journey</h3>{journeyRows.length ? journeyRows.map(([key, count]) => <div className="journey-row" key={key}><span>{label(key)}</span><strong>{count}</strong></div>) : <p className="adm-muted">No journey events in this period.</p>}</article>
            <article><h3>Most frequent customer actions</h3>{eventRows.length ? eventRows.map(([key, count]) => <div className="journey-row" key={key}><span>{label(key)}</span><strong>{count}</strong></div>) : <p className="adm-muted">No actions recorded in this period.</p>}</article>
            <article><h3>First-login starting choices</h3>{data?.assistant?.available ? Object.entries(data.assistant.goals || {}).map(([key, count]) => <div className="journey-row" key={key}><span>{label(key)}</span><strong>{count}</strong></div>) : <p className="adm-muted">Migration 064 remains a draft, so no persistent completion data is read yet.</p>}</article>
          </div>
        </>
      )}
    </section>
  );
}
