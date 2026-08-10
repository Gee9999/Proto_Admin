import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Boxes, Clock3, Loader2, RefreshCw, TrendingDown } from 'lucide-react';
import { ADMIN_REFRESH_EVENT } from '../lib/adminRefresh';

const PERIODS = [30, 90, 180, 365];
const styles = {
  grid: { display: 'grid', gap: 16 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  controls: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  metric: { padding: 15, border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff' },
  metricLabel: { display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' },
  metricValue: { display: 'block', marginTop: 10, color: '#172033', fontSize: 25 },
  note: { display: 'block', marginTop: 6, color: '#64748b', fontSize: 11, lineHeight: 1.4 },
  caveat: { padding: 12, border: '1px solid #fde68a', borderRadius: 9, background: '#fffbeb', color: '#92400e', fontSize: 12, lineHeight: 1.5 },
};

function number(value, maximumFractionDigits = 0) {
  return Number(value || 0).toLocaleString('en-ZA', { maximumFractionDigits });
}

function Metric({ icon: Icon, label, value, note }) {
  return <div style={styles.metric}><span style={styles.metricLabel}><Icon size={14} />{label}</span><strong style={styles.metricValue}>{value}</strong><span style={styles.note}>{note}</span></div>;
}

function StockTable({ title, note, rows, mode }) {
  return (
    <section className="oa-panel">
      <div className="oa-panel-head"><div><h3>{title}</h3><p className="oa-muted">{note}</p></div></div>
      {!rows.length ? <p className="oa-muted">No products match this signal in the selected period.</p> : (
        <div className="oa-table-wrap"><table className="oa-table"><thead><tr><th>Product</th><th>Category</th><th>Available</th><th>Units ordered</th><th>{mode === 'unavailable' ? 'Potential units' : 'Days cover'}</th></tr></thead><tbody>
          {rows.slice(0, 25).map((row) => <tr key={row.sku || row.barcode}><td><strong>{row.title}</strong><br /><span className="oa-muted">{row.sku || row.barcode}</span></td><td>{row.category}</td><td>{number(row.availableStock, 2)}</td><td>{number(row.unitsSold, 2)}</td><td>{mode === 'unavailable' ? number(row.potentialUnavailableUnits, 2) : row.daysCover == null ? 'No demand rate' : number(row.daysCover, 1)}</td></tr>)}
        </tbody></table></div>
      )}
    </section>
  );
}

export default function StockIntelligencePanel() {
  const [period, setPeriod] = useState(90);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/stock-intelligence?period=${period}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Stock intelligence unavailable');
      setPayload(data);
    } catch (err) {
      setError(err.message || 'Stock intelligence unavailable');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = (event) => { if (event.detail === 'analytics') void load(); };
    window.addEventListener(ADMIN_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(ADMIN_REFRESH_EVENT, refresh);
  }, [load]);

  const summary = payload?.summary || {};
  return (
    <div style={styles.grid}>
      <header style={styles.head}>
        <div><p className="acc-eyebrow">INVENTORY DECISIONS</p><h2 style={{ margin: '3px 0 5px' }}>Stock Intelligence</h2><p className="oa-muted">Live catalogue stock measured against recent ordered demand. Read-only: this view never changes stock.</p></div>
        <div style={styles.controls}><div className="oa-periods" aria-label="Stock intelligence period">{PERIODS.map((days) => <button type="button" key={days} className={`oa-period-btn${period === days ? ' oa-period-btn--active' : ''}`} onClick={() => setPeriod(days)}>{days} days</button>)}</div><button type="button" className="adm-btn-ghost" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh</button></div>
      </header>
      {error && <div className="oa-error" role="alert">{error}</div>}
      {loading && !payload ? <div className="oa-loading"><Loader2 size={20} className="spin" /> Loading stock intelligence…</div> : payload && <>
        <div style={styles.metrics}>
          <Metric icon={AlertTriangle} label="Low-stock risk" value={number(summary.lowStockRiskProducts)} note="Demanded SKUs at ≤14 days of cover" />
          <Metric icon={TrendingDown} label="Zero stock + demand" value={number(summary.zeroStockWithDemand)} note={`Ordered during the last ${period} days`} />
          <Metric icon={Clock3} label={`No-sales stock (${period}d)`} value={number(summary.noSalesStockProducts)} note={`${number(summary.unitsOnNoSalesStock, 2)} units currently held`} />
          <Metric icon={Boxes} label="Potential unavailable demand" value={number(summary.potentialUnavailableUnits, 2)} note="Original minus final order quantities" />
        </div>
        <div style={styles.caveat}><strong>Metric guardrails:</strong> {payload.metricAvailability.deadStock.reason} {payload.metricAvailability.sellThrough.reason} Fulfilment reductions are a potential unavailable-demand signal, not a confirmed stock-out reason.</div>
        <StockTable title="Low-stock risk" note="Products with recent demand and no more than 14 estimated days of cover. Made-to-order products are excluded." rows={payload.lowStock} />
        <StockTable title={`No-sales stock (${period} days)`} note="A stock-ageing proxy: current available stock with no recorded ordered units in this window." rows={payload.noSalesStock} />
        <StockTable title="Potential unavailable demand" note="Original order quantity exceeded the final fulfilled quantity; review the order before treating this as a stock-out." rows={payload.unavailableDemand} mode="unavailable" />
        <p className="oa-muted">Source: {payload.source.stock}; {payload.source.demand}. Grain: {payload.source.grain}. Generated {new Date(payload.source.generatedAt).toLocaleString('en-ZA')}.</p>
      </>}
    </div>
  );
}

