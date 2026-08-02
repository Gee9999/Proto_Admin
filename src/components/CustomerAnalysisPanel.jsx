import { BarChart3, CalendarDays, CircleAlert, Clock3, Database, ShoppingBag, TrendingDown, TrendingUp } from 'lucide-react';

const rand = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 });

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function TonePill({ health }) {
  const palette = {
    success: { background: '#dcfce7', color: '#166534', border: '#86efac' },
    warning: { background: '#fef3c7', color: '#92400e', border: '#fcd34d' },
    danger: { background: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
    neutral: { background: '#f1f5f9', color: '#334155', border: '#cbd5e1' },
  };
  const style = palette[health?.tone] || palette.neutral;
  return (
    <span style={{ ...style, border: `1px solid ${style.border}`, borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 800 }}>
      {health?.label || 'Insufficient data'}
    </span>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, background: '#fff', minWidth: 0 }}>
      <div style={{ color: '#64748b', fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: '#0f172a', fontSize: 22, lineHeight: 1.2, fontWeight: 850, marginTop: 5, overflowWrap: 'anywhere' }}>{value}</div>
      {hint && <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function SpendBars({ rows }) {
  const safeRows = rows?.slice(-12) || [];
  const max = Math.max(1, ...safeRows.map((row) => Number(row.spend || 0)));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, safeRows.length)}, minmax(22px, 1fr))`, gap: 7, alignItems: 'end', height: 170, paddingTop: 12 }} aria-label="Monthly spend chart">
      {safeRows.map((row) => {
        const height = Math.max(5, (Number(row.spend || 0) / max) * 130);
        const month = String(row.month || '').slice(5);
        return (
          <div key={row.month} style={{ display: 'grid', alignItems: 'end', gap: 6, minWidth: 0 }} title={`${row.month}: ${rand.format(Number(row.spend || 0))}`}>
            <div style={{ height, borderRadius: '7px 7px 2px 2px', background: 'linear-gradient(180deg, #d4af37 0%, #111827 100%)' }} />
            <span style={{ color: '#64748b', fontSize: 10, textAlign: 'center' }}>{month}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function CustomerAnalysisPanel({ analysis, compact = false }) {
  const metrics = analysis?.metrics;
  if (!metrics) {
    return (
      <section style={{ border: '1px solid #e2e8f0', borderRadius: 16, padding: 20, background: '#fff' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: '#475569' }}>
          <CircleAlert size={18} /> Customer analysis is unavailable.
        </div>
      </section>
    );
  }

  const growth = metrics.growthPercent;
  const growthLabel = growth == null ? '—' : `${growth >= 0 ? '+' : ''}${Math.round(growth)}%`;
  const growthIcon = growth == null ? null : growth >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />;

  return (
    <section aria-labelledby="customer-analysis-title" style={{ border: '1px solid #dbe2ea', borderRadius: 18, overflow: 'hidden', background: '#f8fafc', boxShadow: '0 10px 30px rgba(15, 23, 42, .06)' }}>
      <header style={{ background: 'linear-gradient(135deg, #111827 0%, #020617 100%)', color: '#fff', padding: compact ? 16 : 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
              <BarChart3 size={20} color="#d4af37" />
              <h2 id="customer-analysis-title" style={{ margin: 0, fontSize: compact ? 18 : 22 }}>Customer Analysis</h2>
            </div>
            <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 7 }}>
              {metrics.customerCode || 'No customer code'} · {metrics.customerName || 'Unnamed customer'}
            </div>
          </div>
          <TonePill health={metrics.health} />
        </div>
        <p style={{ margin: '16px 0 0', color: '#e2e8f0', maxWidth: 820, lineHeight: 1.55, fontSize: 14 }}>
          {metrics.health?.explanation}
        </p>
      </header>

      <div style={{ padding: compact ? 14 : 20, display: 'grid', gap: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 10 }}>
          <Metric label="Customer since" value={metrics.customerSinceYears == null ? '—' : `${metrics.customerSinceYears} years`} hint={formatDate(metrics.firstPurchase)} />
          <Metric label="Last purchase" value={metrics.daysSincePurchase == null ? '—' : `${metrics.daysSincePurchase} days ago`} hint={formatDate(metrics.lastPurchase)} />
          <Metric label="This year" value={rand.format(metrics.spendThisYear)} />
          <Metric label="Last year" value={rand.format(metrics.spendLastYear)} />
          <Metric label="Growth" value={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{growthIcon}{growthLabel}</span>} />
          <Metric label="Lifetime spend" value={rand.format(metrics.lifetimeSpend)} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
          <Metric label="Invoices" value={number.format(metrics.invoiceCount)} />
          <Metric label="Average order" value={rand.format(metrics.averageOrderValue)} />
          <Metric label="Largest order" value={rand.format(metrics.largestOrderValue)} />
          <Metric label="Average order rhythm" value={metrics.averageDaysBetweenPurchases ? `${Math.round(metrics.averageDaysBetweenPurchases)} days` : '—'} />
        </div>

        {!compact && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(280px, .85fr)', gap: 16 }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, background: '#fff', padding: 16, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 800, color: '#0f172a' }}><TrendingUp size={17} /> Monthly spend</div>
              <SpendBars rows={metrics.monthlySpend} />
            </div>

            <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, background: '#fff', padding: 16 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 800, color: '#0f172a', marginBottom: 12 }}><ShoppingBag size={17} /> Favourite departments</div>
              <div style={{ display: 'grid', gap: 11 }}>
                {metrics.favouriteDepartments.slice(0, 5).map((department) => (
                  <div key={department.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, marginBottom: 4 }}>
                      <strong>{department.name}</strong><span>{department.share}%</span>
                    </div>
                    <div style={{ height: 7, borderRadius: 999, background: '#e2e8f0', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, Math.max(0, department.share))}%`, height: '100%', borderRadius: 999, background: '#d4af37' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {!compact && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, .8fr)', gap: 16 }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, background: '#fff', padding: 16, overflowX: 'auto' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 800, color: '#0f172a', marginBottom: 12 }}><ShoppingBag size={17} /> Favourite products</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ color: '#64748b', textAlign: 'left' }}><th style={{ padding: '8px 6px' }}>SKU</th><th style={{ padding: '8px 6px' }}>Product</th><th style={{ padding: '8px 6px' }}>Qty</th><th style={{ padding: '8px 6px' }}>Last bought</th></tr></thead>
                <tbody>
                  {metrics.favouriteProducts.slice(0, 20).map((product) => (
                    <tr key={`${product.sku}-${product.name}`} style={{ borderTop: '1px solid #eef2f7' }}>
                      <td style={{ padding: '9px 6px', fontFamily: 'monospace', fontWeight: 700 }}>{product.sku}</td>
                      <td style={{ padding: '9px 6px' }}>{product.name}</td>
                      <td style={{ padding: '9px 6px' }}>{number.format(product.quantity || 0)}</td>
                      <td style={{ padding: '9px 6px' }}>{formatDate(product.lastPurchased)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, background: '#fff', padding: 16 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 800, color: '#0f172a', marginBottom: 12 }}><CalendarDays size={17} /> Timeline</div>
              <div style={{ display: 'grid', gap: 12 }}>
                {metrics.timeline.map((event) => (
                  <div key={`${event.date}-${event.label}`} style={{ display: 'grid', gridTemplateColumns: '12px 1fr', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 999, background: '#d4af37', marginTop: 4 }} />
                    <div><div style={{ fontSize: 11, color: '#64748b' }}>{formatDate(event.date)}</div><div style={{ fontSize: 13, color: '#1e293b', marginTop: 2 }}>{event.label}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <footer style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', color: '#64748b', fontSize: 11 }}>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Database size={13} /> {metrics.source}{metrics.partial ? ' · Partial data' : ''}</span>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Clock3 size={13} /> Updated {formatDate(metrics.refreshedAt)}</span>
        </footer>
      </div>
    </section>
  );
}
