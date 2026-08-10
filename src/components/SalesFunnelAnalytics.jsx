import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { ADMIN_REFRESH_EVENT } from '../lib/adminRefresh';

const PERIODS = [7, 30, 90];

function Stage({ stage, maximum }) {
  const width = stage.available && maximum > 0
    ? Math.max(4, Math.round((stage.value / maximum) * 100))
    : 0;

  return (
    <article className="oa-panel" style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <strong>{stage.label}</strong>
        <span className="oa-stat-val" style={{ fontSize: 20 }}>{stage.available ? Number(stage.value).toLocaleString('en-ZA') : 'Not tracked'}</span>
      </div>
      <div className="oa-hbar-track" aria-hidden="true">
        <div className="oa-hbar-fill" style={{ width: `${width}%`, opacity: stage.available ? 1 : 0 }} />
      </div>
      <p className="oa-muted" style={{ margin: 0 }}>{stage.detail}</p>
      <span className="oa-muted">{stage.available ? `Source: ${stage.source}` : 'Instrumentation required'}</span>
    </article>
  );
}

export default function SalesFunnelAnalytics() {
  const [period, setPeriod] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/sales-funnel-analytics?period=${period}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Sales funnel analytics unavailable');
      setData(payload);
    } catch (loadError) {
      setData(null);
      setError(loadError.message || 'Sales funnel analytics unavailable');
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

  const stages = data?.stages || [];
  const maximum = Math.max(0, ...stages.filter((stage) => stage.available).map((stage) => stage.value || 0));

  return (
    <div className="oa-dashboard">
      <div className="oa-toolbar">
        <div>
          <h2 style={{ margin: '0 0 5px' }}>Sales funnel</h2>
          <p className="oa-note" style={{ margin: 0 }}>Measured activity from discovery through paid orders.</p>
        </div>
        <div className="oa-panel-actions">
          <div className="oa-periods" aria-label="Sales funnel period">
            {PERIODS.map((days) => (
              <button key={days} type="button" className={`oa-period-btn${period === days ? ' oa-period-btn--active' : ''}`} onClick={() => setPeriod(days)}>
                {days} days
              </button>
            ))}
          </div>
          <button type="button" className="oa-export-btn" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        </div>
      </div>

      {error && <div className="oa-error" role="alert">{error}</div>}
      {loading && !data ? (
        <div className="oa-loading"><Loader2 size={20} className="spin" /> Loading sales funnel…</div>
      ) : data && (
        <>
          <div className={`oa-wa-notify ${data.coverage.available === data.coverage.total ? 'oa-wa-notify--ok' : 'oa-wa-notify--warn'}`}>
            <div className="oa-wa-notify-head">
              {data.coverage.available === data.coverage.total ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              <strong>{data.coverage.available} of {data.coverage.total} stages measured</strong>
            </div>
            <p className="oa-wa-notify-msg">{data.interpretation}</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            {stages.map((stage) => <Stage key={stage.key} stage={stage} maximum={maximum} />)}
          </div>
          <p className="oa-note">Unavailable stages are shown explicitly. No values are estimated or backfilled.</p>
        </>
      )}
    </div>
  );
}
