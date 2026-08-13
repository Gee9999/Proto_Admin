/**
 * Abandoned Baskets — who is sitting on a basket they never checked out,
 * what is in it, and everything needed to chase it.
 *
 * All money here is VAT-INCLUSIVE: storefront prices already include VAT, and
 * the basket stores the storefront price. The labels say so on purpose.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronRight, Download, Loader2, RefreshCw, Search, ShoppingCart,
} from 'lucide-react';
import { downloadCsv } from '../lib/exportReport';
import { basketExportRows } from '../../lib/abandoned-baskets.mjs';
import { ADMIN_REFRESH_EVENT } from '../lib/adminRefresh';

const STALENESS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Still shopping' },
  { key: 'cooling', label: 'Cooling off' },
  { key: 'stale', label: 'Gone cold' },
];

const SORTS = [
  { key: 'value', label: 'Basket value' },
  { key: 'recent', label: 'Most recent' },
  { key: 'oldest', label: 'Longest idle' },
  { key: 'lines', label: 'Most items' },
  { key: 'name', label: 'Customer name' },
];

const STALENESS_LABELS = {
  active: 'Still shopping',
  cooling: 'Cooling off',
  stale: 'Gone cold',
  unknown: 'Unknown',
};

function money(value) {
  return `R ${Number(value || 0).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function moneyExact(value) {
  return `R ${Number(value || 0).toLocaleString('en-ZA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function idleLabel(ageDays) {
  if (ageDays === null || ageDays === undefined) return 'Unknown';
  if (ageDays < 1) return 'Today';
  if (ageDays < 2) return '1 day';
  return `${Math.floor(ageDays)} days`;
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function CustomerDetail({ basket }) {
  const rows = [
    ['Email', basket.email || '—'],
    ['Phone', basket.phone || '—'],
    ['Business', basket.businessName || '—'],
    ['Customer code', basket.customerCode || 'Not allocated'],
    ['Tier', basket.tier || '—'],
    ['Location', [basket.city, basket.province].filter(Boolean).join(', ') || '—'],
    ['Customer since', dateLabel(basket.customerSince)],
    ['Last purchase', dateLabel(basket.lastPurchaseDate)],
    ['Sales (12m)', basket.salesLast12Months === null ? '—' : money(basket.salesLast12Months)],
    ['Last email', basket.lastEmailType
      ? `${basket.lastEmailType} · ${dateLabel(basket.lastEmailAt)}`
      : 'None recorded'],
  ];

  return (
    <div className="ab-detail-customer">
      <h5>Customer</h5>
      <dl className="ab-detail-list">
        {rows.map(([label, value]) => (
          <div key={label} className="ab-detail-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {basket.tags?.length > 0 && (
        <div className="ab-tags">
          {basket.tags.map((tag) => <span key={tag} className="ab-tag">{tag}</span>)}
        </div>
      )}
    </div>
  );
}

function BasketLines({ basket }) {
  return (
    <div className="ab-detail-basket">
      <h5>{basket.lineCount} {basket.lineCount === 1 ? 'product' : 'products'} in the basket</h5>
      <div className="oa-table-wrap">
        <table className="oa-table ab-lines-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th className="ab-num">Qty</th>
              <th className="ab-num">Unit</th>
              <th className="ab-num">Line total</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>
            {basket.items.map((item) => (
              <tr key={`${item.sku}-${item.name}`}>
                <td className="ab-sku">{item.sku}</td>
                <td>{item.name}</td>
                <td className="ab-num">{item.qty}</td>
                <td className="ab-num">{moneyExact(item.price)}</td>
                <td className="ab-num ab-strong">{moneyExact(item.lineTotal)}</td>
                <td>
                  {item.inStock
                    ? <span className="ab-pill ab-pill--ok">In stock</span>
                    : <span className="ab-pill ab-pill--warn">Out of stock</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="ab-strong">Basket total (incl. VAT)</td>
              <td className="ab-num ab-strong">{moneyExact(basket.value)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default function AbandonedBasketsPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [staleness, setStaleness] = useState('all');
  const [sort, setSort] = useState('value');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ staleness, sort });
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/abandoned-baskets?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load abandoned baskets');
      setData(json);
    } catch (e) {
      setError(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [staleness, sort, search]);

  // Typing in the search box should not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    const onRefresh = (event) => {
      if (event.detail === 'analytics') void load();
    };
    window.addEventListener(ADMIN_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(ADMIN_REFRESH_EVENT, onRefresh);
  }, [load]);

  const toggle = useCallback((customerId) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }, []);

  const baskets = useMemo(() => data?.baskets || [], [data]);
  const summary = data?.summary;
  const filtered = data?.filteredSummary;
  const isFiltered = staleness !== 'all' || Boolean(search.trim());

  const handleExport = useCallback(() => {
    const rows = basketExportRows(baskets);
    if (!rows.length) return;
    const columns = Object.keys(rows[0]).map((key) => ({ header: key, key }));
    downloadCsv(`abandoned-baskets-${new Date().toISOString().slice(0, 10)}.csv`, columns, rows);
  }, [baskets]);

  if (data && data.available === false) {
    return (
      <div className="oa-error">
        <AlertTriangle size={16} /> {data.reason}
      </div>
    );
  }

  return (
    <div className="ab-panel">
      <div className="oa-panel-head">
        <div>
          <h3>Abandoned Baskets</h3>
          <p className="ab-subtitle">
            Customers holding a basket they have not checked out. A basket is emptied
            automatically when the order is submitted, so everything below is still outstanding.
          </p>
        </div>
        <div className="oa-panel-actions">
          <button type="button" className="oa-export-btn" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : undefined} />
            Refresh
          </button>
          <button type="button" className="oa-export-btn" onClick={handleExport} disabled={!baskets.length}>
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {error && <div className="oa-error">{error}</div>}

      {summary && (
        <div className="oa-stat-grid">
          <div className="oa-stat-card oa-stat-card--accent">
            <div className="oa-stat-val">{summary.basketCount}</div>
            <div className="oa-stat-label">Outstanding Baskets</div>
          </div>
          <div className="oa-stat-card">
            <div className="oa-stat-val">{money(summary.totalValue)}</div>
            <div className="oa-stat-label">Value At Risk (incl. VAT)</div>
          </div>
          <div className="oa-stat-card">
            <div className="oa-stat-val">{money(summary.avgValue)}</div>
            <div className="oa-stat-label">Average Basket</div>
          </div>
          <div className="oa-stat-card">
            <div className="oa-stat-val">{money(summary.biggestValue)}</div>
            <div className="oa-stat-label">Biggest Basket</div>
          </div>
          <div className="oa-stat-card">
            <div className="oa-stat-val">{summary.staleCount}</div>
            <div className="oa-stat-label">Gone Cold (7+ days)</div>
          </div>
          <div className="oa-stat-card">
            <div className="oa-stat-val">{summary.totalUnits}</div>
            <div className="oa-stat-label">Units Waiting</div>
          </div>
        </div>
      )}

      <div className="ab-controls">
        <div className="ab-filter-group">
          {STALENESS_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`oa-period-btn${staleness === filter.key ? ' oa-period-btn--active' : ''}`}
              onClick={() => setStaleness(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <label className="ab-search">
          <Search size={14} />
          <input
            type="search"
            value={search}
            placeholder="Search customer, email, product or SKU…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <label className="ab-sort">
          <span>Sort by</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            {SORTS.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      {isFiltered && filtered && (
        <p className="ab-filter-summary">
          Showing <strong>{filtered.basketCount}</strong> of {summary.basketCount} baskets
          · <strong>{money(filtered.totalValue)}</strong> of {money(summary.totalValue)}
        </p>
      )}

      {loading && !data && (
        <div className="oa-loading"><Loader2 size={28} className="star-spinning" /></div>
      )}

      {data && !baskets.length && !loading && (
        <p className="oa-empty">
          <ShoppingCart size={16} />
          {isFiltered
            ? 'No baskets match this filter.'
            : 'No outstanding baskets — every customer basket has been checked out or cleared.'}
        </p>
      )}

      {baskets.length > 0 && (
        <div className="oa-table-wrap">
          <table className="oa-table ab-table">
            <thead>
              <tr>
                <th aria-label="Expand" />
                <th>Customer</th>
                <th>Contact</th>
                <th className="ab-num">Items</th>
                <th className="ab-num">Basket value</th>
                <th className="ab-num">Idle</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {baskets.map((basket) => {
                const isOpen = expanded.has(basket.customerId);
                return [
                  <tr
                    key={basket.customerId}
                    className={`ab-row${isOpen ? ' ab-row--open' : ''}`}
                    onClick={() => toggle(basket.customerId)}
                  >
                    <td className="ab-chevron">
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </td>
                    <td>
                      <span className="ab-name">{basket.name}</span>
                      {basket.businessName && <span className="ab-business">{basket.businessName}</span>}
                      {basket.missing && (
                        <span className="ab-pill ab-pill--warn">No customer record</span>
                      )}
                    </td>
                    <td className="ab-contact">
                      {basket.email && <span>{basket.email}</span>}
                      {basket.phone && <span>{basket.phone}</span>}
                      {!basket.email && !basket.phone && <span>—</span>}
                    </td>
                    <td className="ab-num">{basket.lineCount}</td>
                    <td className="ab-num ab-strong">{money(basket.value)}</td>
                    <td className="ab-num">{idleLabel(basket.ageDays)}</td>
                    <td>
                      <span className={`ab-pill ab-pill--${basket.staleness}`}>
                        {STALENESS_LABELS[basket.staleness] || basket.staleness}
                      </span>
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={`${basket.customerId}-detail`} className="ab-detail-row-wrap">
                      <td colSpan={7}>
                        <div className="ab-detail">
                          <CustomerDetail basket={basket} />
                          <BasketLines basket={basket} />
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
