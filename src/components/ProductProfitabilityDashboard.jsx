import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { ADMIN_REFRESH_EVENT } from '../lib/adminRefresh';
import './ProductProfitabilityDashboard.css';

const PERIODS = [7, 30, 90, 120];

function money(value) {
  if (value == null) return 'Unavailable';
  return `R ${Number(value).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function percent(value) {
  return value == null ? 'Unavailable' : `${Number(value).toFixed(1)}%`;
}

function Metric({ label, value, note, unavailable = false }) {
  return (
    <div className={`pp-metric${unavailable ? ' pp-metric--unavailable' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

export default function ProductProfitabilityDashboard() {
  const [period, setPeriod] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/product-profitability?period=${period}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Product profitability unavailable');
      setData(payload);
    } catch (loadError) {
      setData(null);
      setError(loadError.message || 'Product profitability unavailable');
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

  const summary = data?.summary;
  const rows = data?.products || [];

  return (
    <div className="pp-dashboard">
      <header className="pp-header">
        <div>
          <p className="pp-eyebrow">COMMERCIAL ANALYTICS</p>
          <h2>Product Profitability</h2>
          <p>Revenue by product, with gross profit and margin shown only where a matched ERP cost exists.</p>
        </div>
        <div className="pp-controls">
          <div className="oa-periods" aria-label="Profitability period">
            {PERIODS.map((days) => (
              <button key={days} type="button" className={`oa-period-btn${period === days ? ' oa-period-btn--active' : ''}`} onClick={() => setPeriod(days)}>
                {days} days
              </button>
            ))}
          </div>
          <button type="button" className="adm-btn-ghost" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
          </button>
        </div>
      </header>

      {error && <div className="oa-error" role="alert">{error}</div>}
      {loading && !data && <div className="oa-loading"><Loader2 size={20} className="spin" /> Loading profitability…</div>}

      {summary && (
        <>
          <div className="pp-metrics">
            <Metric label="Order revenue" value={money(summary.totalOrderRevenue)} note={`${summary.totalOrders} orders · ${period} days`} />
            <Metric label="Product-line revenue" value={money(summary.productRevenue)} note={`${percent(summary.revenueCoveragePct)} of order revenue represented`} />
            <Metric
              label="Gross profit (covered lines)"
              value={money(summary.grossProfit)}
              note={data.costAvailable ? `${money(summary.coveredRevenue)} revenue has cost data` : 'No supported ERP cost value found'}
              unavailable={!data.costAvailable}
            />
            <Metric
              label="Gross margin (covered lines)"
              value={percent(summary.marginPct)}
              note={`${percent(summary.costCoveragePct)} of product revenue has cost coverage`}
              unavailable={!data.costAvailable}
            />
          </div>

          {!data.costAvailable && (
            <div className="pp-caveat" role="note">
              <AlertTriangle size={17} />
              <div><strong>Profit is not estimated.</strong><span>Add a supported cost value to the ERP product source before using gross profit or margin.</span></div>
            </div>
          )}

          <section className="oa-panel">
            <div className="oa-panel-head">
              <div>
                <h3>Product performance</h3>
                <p className="pp-source">Revenue source: saved order lines · Cost source: {data.source?.cost || 'unavailable'}</p>
              </div>
            </div>
            {!rows.length ? <p className="oa-empty">No product lines for this period.</p> : (
              <div className="oa-table-wrap">
                <table className="oa-table pp-table">
                  <thead><tr><th>Product</th><th>Units</th><th>Revenue</th><th>Cost coverage</th><th>Gross profit</th><th>Margin</th></tr></thead>
                  <tbody>
                    {rows.map((row) => {
                      const fullyCosted = row.units > 0 && row.costedUnits === row.units;
                      return (
                        <tr key={row.sku}>
                          <td><strong>{row.name}</strong><small>{row.sku}</small></td>
                          <td>{Number(row.units).toLocaleString('en-ZA')}</td>
                          <td>{row.revenueAvailable ? money(row.revenue) : 'Unavailable'}</td>
                          <td>{row.costedUnits ? `${Number(row.costedUnits).toLocaleString('en-ZA')} of ${Number(row.units).toLocaleString('en-ZA')} units` : 'No cost data'}</td>
                          <td>{row.grossProfit == null ? 'Unavailable' : money(row.grossProfit)}</td>
                          <td>{row.marginPct == null ? 'Unavailable' : <>{percent(row.marginPct)}{!fullyCosted && <small>Covered lines only</small>}</>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <footer className="pp-footnote">
            {(data.caveats || []).map((caveat) => <span key={caveat}>{caveat}</span>)}
          </footer>
        </>
      )}
    </div>
  );
}
