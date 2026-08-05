import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Compass, Download, Loader2, RefreshCw, Sparkles, Users } from 'lucide-react';
import { downloadCsv } from '../lib/exportReport';
import { ADMIN_REFRESH_EVENT } from '../lib/adminRefresh';

const PERIODS = [
  { days: 7, label: '7D' },
  { days: 30, label: '30D' },
  { days: 90, label: '90D' },
];

function money(value) {
  return `R ${Number(value || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`;
}

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function Stat({ value, label, tone = '' }) {
  return <div className={`oa-stat-card${tone ? ` oa-stat-card--${tone}` : ''}`}><div className="oa-stat-val">{value}</div><div className="oa-stat-label">{label}</div></div>;
}

function Queue({ title, description, icon: Icon, tone, rows, empty, columns, onExport }) {
  return (
    <section className="oa-panel ac-queue">
      <div className="oa-panel-head">
        <div className="ac-queue-heading"><Icon size={17} className={`ac-icon ac-icon--${tone}`} /><div><h3>{title}</h3><p>{description}</p></div></div>
        {rows?.length > 0 && <button type="button" className="oa-export-btn" onClick={onExport}><Download size={14} /> Export</button>}
      </div>
      {!rows?.length ? <p className="oa-empty">{empty}</p> : (
        <div className="oa-table-wrap"><table className="oa-table ac-table"><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.key || row.term || row.label}-${index}`}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}</tr>)}</tbody></table></div>
      )}
    </section>
  );
}

export default function AnalyticsControlCentre() {
  const [period, setPeriod] = useState(30);
  const [orderData, setOrderData] = useState(null);
  const [searchData, setSearchData] = useState(null);
  const [apollo, setApollo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [orderRes, searchRes, apolloRes] = await Promise.all([
        fetch(`/api/order-analytics?period=${period}`),
        fetch(`/api/search-analytics-dashboard?period=${period}`),
        fetch('/api/apollo-intelligence'),
      ]);
      const [orderJson, searchJson, apolloJson] = await Promise.all([orderRes.json(), searchRes.json(), apolloRes.json()]);
      if (!orderRes.ok) throw new Error(orderJson.error || 'Failed to load order analytics');
      if (!searchRes.ok) throw new Error(searchJson.error || 'Failed to load search analytics');
      setOrderData(orderJson);
      setSearchData(searchJson);
      setApollo(apolloRes.ok ? apolloJson : { configured: false });
    } catch (loadError) {
      setError(loadError.message || 'Failed to load the analytics control centre');
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

  const opportunities = useMemo(() => {
    const ordered = new Map((orderData?.topOrderedProducts || []).map((row) => [normalise(row.name || row.code), row.qty]));
    return (orderData?.topViewedProducts || []).filter((row) => !ordered.has(normalise(row.label))).map((row) => ({
      ...row,
      action: row.views >= 5 ? 'Review price, image and description' : 'Monitor interest',
      priority: row.views >= 8 ? 'High' : 'Review',
    }));
  }, [orderData]);

  const noResultTerms = searchData?.zeroResultTerms || [];
  const noOrderTerms = searchData?.zeroOrderTerms || [];
  const noResultPct = searchData?.kpis?.totalSearches ? Math.round((searchData.kpis.searchesNoResults / searchData.kpis.totalSearches) * 100) : 0;
  const actionCount = opportunities.length + noResultTerms.length;

  const exportRows = (filename, rows) => downloadCsv(filename, [
    { header: 'Item', key: 'label' },
    { header: 'Searches / Views', key: 'views' },
    { header: 'Action', key: 'action' },
    { header: 'Priority', key: 'priority' },
  ], rows);

  return (
    <div className="oa-dashboard ac-dashboard">
      <div className="oa-toolbar">
        <div><p className="ac-eyebrow"><Sparkles size={14} /> Decision support</p><h2 className="ac-title">Analytics Control Centre</h2><p className="ac-subtitle">Turn browsing, searching and buying behaviour into the next Proto action.</p></div>
        <div className="oa-toolbar ac-toolbar-actions"><div className="oa-periods">{PERIODS.map(({ days, label }) => <button key={label} type="button" className={`oa-period-btn${period === days ? ' oa-period-btn--active' : ''}`} onClick={() => setPeriod(days)}>{label}</button>)}</div><button type="button" className="adm-btn-ghost" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Refresh</button></div>
      </div>
      {error && <div className="oa-error">{error}</div>}
      {loading && !orderData ? <div className="oa-loading"><Loader2 size={24} className="spin" /> Loading opportunities…</div> : (
        <>
          <div className="oa-stat-grid ac-stat-grid">
            <Stat value={actionCount} label="Recommended actions" tone="accent" />
            <Stat value={`${noResultPct}%`} label="Searches with no result" tone={noResultPct >= 20 ? 'danger' : ''} />
            <Stat value={orderData?.summary?.totalOrders ?? 0} label="Orders in period" />
            <Stat value={money(searchData?.kpis?.revenue)} label="Search-attributed revenue" />
          </div>

          <section className="oa-panel ac-priority-panel">
            <div className="oa-panel-head"><div className="ac-queue-heading"><Compass size={17} className="ac-icon ac-icon--green" /><div><h3>Today’s priority actions</h3><p>Start here before reviewing the detailed reports.</p></div></div><span className="sa-badge sa-badge--amber">{actionCount} items</span></div>
            <div className="ac-action-grid">
              <div className="ac-action-card"><strong>{noResultTerms.length}</strong><span>search terms need mapping or new products</span><ArrowUpRight size={17} /></div>
              <div className="ac-action-card"><strong>{opportunities.length}</strong><span>viewed products have no matching order signal</span><ArrowUpRight size={17} /></div>
              <div className="ac-action-card"><strong>{noOrderTerms.length}</strong><span>search terms have interest but no completed order</span><ArrowUpRight size={17} /></div>
            </div>
          </section>

          <Queue title="High interest, no order signal" description="Products being viewed but not appearing in the top ordered list." icon={AlertTriangle} tone="amber" rows={opportunities} empty="No high-interest opportunities detected for this period." columns={[{ key: 'label', label: 'Product' }, { key: 'views', label: 'Views' }, { key: 'priority', label: 'Priority', render: (row) => <span className={`sa-badge ${row.priority === 'High' ? 'sa-badge--red' : 'sa-badge--amber'}`}>{row.priority}</span> }, { key: 'action', label: 'Suggested action' }]} onExport={() => exportRows(`proto-product-opportunities-${period}d.csv`, opportunities)} />
          <Queue title="Search problems to fix" description="Repeated no-result searches are demand signals, not just errors." icon={AlertTriangle} tone="red" rows={noResultTerms} empty="No repeated no-result searches detected." columns={[{ key: 'normalized_search_term', label: 'Search term' }, { key: 'search_count', label: 'Searches' }, { key: 'action', label: 'Suggested action', render: () => 'Add synonym, redirect or product' }]} onExport={() => downloadCsv(`proto-search-problems-${period}d.csv`, [{ header: 'Search term', key: 'normalized_search_term' }, { header: 'Searches', key: 'search_count' }], noResultTerms)} />

          <div className="oa-split">
            <section className="oa-panel ac-info-panel"><div className="oa-panel-head"><div className="ac-queue-heading"><Users size={17} className="ac-icon ac-icon--blue" /><div><h3>Customer feedback</h3><p>Capture the reason behind non-purchases.</p></div></div><span className="sa-badge">Next phase</span></div><p>We will add a lightweight prompt on product and search pages: price, stock, information, image, minimum quantity or product request. Feedback will then appear here by category, product and customer segment.</p><div className="ac-feedback-tags"><span>Couldn’t find it</span><span>Price</span><span>Out of stock</span><span>MOQ</span><span>Product request</span></div></section>
            <section className="oa-panel ac-info-panel"><div className="oa-panel-head"><div className="ac-queue-heading"><Sparkles size={17} className="ac-icon ac-icon--purple" /><div><h3>Apollo intelligence</h3><p>Enrichment and account-level buying signals.</p></div></div><span className={`sa-badge ${apollo?.configured ? 'sa-badge--green' : 'sa-badge--amber'}`}>{apollo?.configured ? 'Connected' : 'Ready to connect'}</span></div><p>{apollo?.configured ? 'Apollo enrichment is available for approved account lookups.' : 'The Admin surface is ready. Add the Apollo server key only when you approve the enrichment workflow.'}</p><div className="ac-apollo-list"><div><CheckCircle2 size={15} /> Match business domains and company names</div><div><CheckCircle2 size={15} /> Enrich verified business contacts</div><div><CheckCircle2 size={15} /> Rank high-intent trade prospects</div></div></section>
          </div>
        </>
      )}
    </div>
  );
}
