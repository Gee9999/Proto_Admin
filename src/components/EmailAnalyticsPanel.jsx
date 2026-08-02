import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart2, Download, Loader2, X } from 'lucide-react';
import { ADMIN_REFRESH_EVENT } from '../lib/adminRefresh';
import { normalizeCampaignAnalytics } from '../lib/emailAnalytics';

/**
 * Email analytics as a SPREADSHEET, not a wall of text.
 *
 * The previous version printed every campaign as a card with hundreds of
 * comma-separated addresses inline, which was unreadable. Now: headline totals
 * across all campaigns, one sortable row per campaign with its rates, and the
 * recipient detail moved behind a per-campaign drawer (plus CSV export).
 */

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function rateClass(value, { good, warn }) {
  if (value >= good) return 'adm-rate adm-rate--good';
  if (value >= warn) return 'adm-rate adm-rate--warn';
  return 'adm-rate adm-rate--bad';
}

function fmtDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadCsv(filename, rows) {
  const blob = new Blob([rows.map((r) => r.map(csvEscape).join(',')).join('\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const SORTS = {
  date: (a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0),
  sent: (a, b) => b.sent - a.sent,
  opened: (a, b) => b.openRate - a.openRate,
  clicked: (a, b) => b.clickRate - a.clickRate,
};

export default function EmailAnalyticsPanel({ onShowToast }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('date');
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/email-campaigns');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load email campaigns');
      setCampaigns(json.campaigns || []);
    } catch (err) {
      onShowToast?.(err.message || 'Failed to load email analytics', 'error');
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [onShowToast]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onRefresh = (event) => {
      if (event.detail === 'customers' || event.detail === 'comms') void load();
    };
    window.addEventListener(ADMIN_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(ADMIN_REFRESH_EVENT, onRefresh);
  }, [load]);

  const rows = useMemo(() => {
    const mapped = (campaigns || []).map(normalizeCampaignAnalytics);
    return mapped.sort(SORTS[sort] || SORTS.date);
  }, [campaigns, sort]);

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    campaigns: acc.campaigns + 1,
    sent: acc.sent + r.sent,
    delivered: acc.delivered + r.delivered,
    deliveryUnknown: acc.deliveryUnknown + r.deliveryUnknown,
    openedUnique: acc.openedUnique + r.openedUnique,
    clickedUnique: acc.clickedUnique + r.clickedUnique,
    bounced: acc.bounced + r.bounced,
  }), { campaigns: 0, sent: 0, delivered: 0, deliveryUnknown: 0, openedUnique: 0, clickedUnique: 0, bounced: 0 }), [rows]);

  const exportCsv = () => {
    downloadCsv('proto-email-campaigns.csv', [
      ['Sent at', 'Subject', 'Audience', 'Business types', 'Recipients', 'Confirmed delivered', 'Delivered %', 'Delivery unknown', 'Opened (people)', 'Open %', 'Clicked (people)', 'Click %', 'Bounced', 'Bounce %'],
      ...rows.map((r) => [
        r.sentAt ? new Date(r.sentAt).toISOString() : '',
        r.subject || '(no subject)',
        r.audience || '',
        (r.businessTypes || []).join(' / '),
        r.sent, r.delivered, `${r.deliveryRate}%`, r.deliveryUnknown,
        r.openedUnique, `${r.openRate}%`,
        r.clickedUnique, `${r.clickRate}%`,
        r.bounced, `${r.bounceRate}%`,
      ]),
    ]);
  };

  if (loading && campaigns.length === 0) return <EmailAnalyticsSkeleton />;

  return (
    <div style={{ marginTop: 8 }}>
      <div className="adm-email-stats">
        <Headline label="Campaigns" value={totals.campaigns} />
        <Headline label="Emails sent" value={totals.sent.toLocaleString('en-ZA')} />
        <Headline label="Confirmed delivered" value={`${pct(totals.delivered, totals.sent)}%`} sub={`${totals.delivered.toLocaleString('en-ZA')} of ${totals.sent.toLocaleString('en-ZA')}`} />
        <Headline label="Delivery unknown" value={totals.deliveryUnknown.toLocaleString('en-ZA')} sub="Accepted send; no delivery webhook" tone={totals.deliveryUnknown > 0 ? 'bad' : undefined} />
        <Headline label="Opened" value={`${pct(totals.openedUnique, totals.sent)}%`} sub={`${totals.openedUnique.toLocaleString('en-ZA')} people`} />
        <Headline label="Clicked" value={`${pct(totals.clickedUnique, totals.sent)}%`} sub={`${totals.clickedUnique.toLocaleString('en-ZA')} people`} />
        <Headline label="Bounced" value={`${pct(totals.bounced, totals.sent)}%`} sub={`${totals.bounced.toLocaleString('en-ZA')} addresses`} tone={totals.bounced > 0 ? 'bad' : undefined} />
      </div>

      <div className="adm-email-analytics-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="adm-muted" style={{ fontSize: 12, fontWeight: 700 }}>Sort</span>
          {[['date', 'Newest'], ['sent', 'Most sent'], ['opened', 'Best open rate'], ['clicked', 'Best click rate']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`adm-tab${sort === key ? ' adm-tab--active' : ''}`}
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => setSort(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading && <Loader2 size={15} className="spin" aria-label="Loading" />}
          <button type="button" className="adm-btn-ghost adm-btn--sm" onClick={exportCsv} disabled={!rows.length}>
            <Download size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
            Export CSV
          </button>
        </div>
      </div>

      {rows.length === 0 && !loading ? (
        <div className="adm-empty" style={{ padding: '32px 0' }}>
          <BarChart2 size={28} style={{ color: '#9ca3af', marginBottom: 8 }} />
          <div>No email campaigns logged yet. Use <strong>Send email</strong> to start tracking.</div>
        </div>
      ) : (
        <div className="adm-table-scroll">
          <table className="adm-sheet">
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>Sent</th>
                <th style={{ minWidth: 220 }}>Subject</th>
                <th style={{ minWidth: 130 }}>Audience</th>
                <th className="adm-sheet__num">Recipients</th>
                <th className="adm-sheet__num">Confirmed delivered</th>
                <th className="adm-sheet__num">Delivery unknown</th>
                <th className="adm-sheet__num">Opened</th>
                <th className="adm-sheet__num">Clicked</th>
                <th className="adm-sheet__num">Bounced</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="adm-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.sentAt)}</td>
                  <td style={{ fontWeight: 700 }}>{r.subject || '(no subject)'}</td>
                  <td className="adm-muted">
                    {r.audience || '—'}
                    {r.businessTypes?.length ? <div style={{ fontSize: 11 }}>{r.businessTypes.join(', ')}</div> : null}
                  </td>
                  <td className="adm-sheet__num">{r.sent.toLocaleString('en-ZA')}</td>
                  <td className="adm-sheet__num">
                    {r.delivered.toLocaleString('en-ZA')}<span className={rateClass(r.deliveryRate, { good: 90, warn: 60 })}>{r.deliveryRate}%</span>
                  </td>
                  <td className="adm-sheet__num">{r.deliveryUnknown.toLocaleString('en-ZA')}</td>
                  <td className="adm-sheet__num">
                    {r.openedUnique.toLocaleString('en-ZA')}<span className={rateClass(r.openRate, { good: 25, warn: 10 })}>{r.openRate}%</span>
                  </td>
                  <td className="adm-sheet__num">
                    {r.clickedUnique.toLocaleString('en-ZA')}<span className={rateClass(r.clickRate, { good: 10, warn: 3 })}>{r.clickRate}%</span>
                  </td>
                  <td className="adm-sheet__num">
                    {r.bounced.toLocaleString('en-ZA')}
                    {r.bounced > 0 && <span className="adm-rate adm-rate--bad">{r.bounceRate}%</span>}
                  </td>
                  <td>
                    <button type="button" className="adm-btn-ghost adm-btn--sm" onClick={() => setDetail(r)}>
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="adm-section-note" style={{ marginTop: 12 }}>
        Open and click rates count each PERSON once, measured against recipients. “Confirmed delivered” requires a Brevo
        delivery webhook; accepted sends without that evidence remain “Delivery unknown” instead of being reported as failed or delivered.
      </p>

      {detail && <CampaignDetail campaign={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function EmailAnalyticsSkeleton() {
  return (
    <div className="adm-email-analytics-skeleton" role="status" aria-label="Loading email analytics">
      <div className="adm-email-stats">
        {[0, 1, 2, 3, 4, 5].map((key) => (
          <div className="adm-email-stat" key={key}>
            <span className="adm-loading-skeleton__bar" style={{ width: '55%' }} />
            <span className="adm-loading-skeleton__bar" style={{ width: '35%', height: 24 }} />
          </div>
        ))}
      </div>
      <div className="adm-loading-skeleton">
        {[0, 1, 2].map((row) => (
          <div key={row} className="adm-loading-skeleton__row">
            {[26, 44, 34, 20].map((width, index) => (
              <span key={index} className="adm-loading-skeleton__bar" style={{ width: `${width}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Headline({ label, value, sub, tone }) {
  return (
    <div className={`adm-email-stat${tone === 'bad' ? ' adm-email-stat--bad' : ''}`}>
      <div className="adm-email-stat__label">{label}</div>
      <div className="adm-email-stat__value">{value}</div>
      {sub && <div className="adm-email-stat__sub">{sub}</div>}
    </div>
  );
}

/** Per-campaign recipient detail — one address per line, exportable. */
function CampaignDetail({ campaign, onClose }) {
  const groups = [
    { key: 'clicked', label: 'Clicked', emails: campaign.eventEmails?.clicked || [] },
    { key: 'opened', label: 'Opened', emails: campaign.eventEmails?.opened || [] },
    { key: 'bounced', label: 'Bounced', emails: campaign.eventEmails?.bounced || [] },
  ].filter((g) => g.emails.length);
  const links = Object.entries(campaign.clickedLinks || {});
  const [tab, setTab] = useState(groups[0]?.key || 'links');
  const active = groups.find((g) => g.key === tab);

  const exportRecipients = () => {
    downloadCsv(`campaign-${(campaign.subject || 'email').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, [
      ['Email', 'Status'],
      ...groups.flatMap((g) => g.emails.map((e) => [e, g.label])),
    ]);
  };

  return (
    <div className="adm-modal-backdrop" onClick={onClose}>
      <div className="adm-modal adm-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="adm-modal-header">
          <div>
            <h3 className="adm-modal-title">{campaign.subject || '(no subject)'}</h3>
            <p className="adm-modal-note" style={{ margin: '2px 0 0' }}>{fmtDate(campaign.sentAt)} · {campaign.sent} recipients</p>
          </div>
          <button type="button" className="adm-modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="adm-modal-body">
          <div className="adm-customer-tabs" style={{ marginBottom: 12 }}>
            {groups.map((g) => (
              <button key={g.key} type="button" className={`adm-tab${tab === g.key ? ' adm-tab--active' : ''}`} onClick={() => setTab(g.key)}>
                {g.label} ({g.emails.length})
              </button>
            ))}
            {links.length > 0 && (
              <button type="button" className={`adm-tab${tab === 'links' ? ' adm-tab--active' : ''}`} onClick={() => setTab('links')}>
                Links ({links.length})
              </button>
            )}
          </div>

          {tab === 'links' ? (
            <div className="adm-table-scroll">
              <table className="adm-sheet">
                <thead><tr><th>Link</th><th className="adm-sheet__num">Clicks</th></tr></thead>
                <tbody>
                  {links.map(([url, info]) => (
                    <tr key={url}>
                      <td style={{ wordBreak: 'break-all' }}>{url}</td>
                      <td className="adm-sheet__num">{info.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : active ? (
            <div className="adm-table-scroll" style={{ maxHeight: '50vh' }}>
              <table className="adm-sheet">
                <thead><tr><th style={{ width: 48 }}>#</th><th>Email address</th></tr></thead>
                <tbody>
                  {active.emails.map((email, i) => (
                    <tr key={email}><td className="adm-muted">{i + 1}</td><td>{email}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="adm-empty" style={{ padding: 24 }}>No recipient detail recorded for this campaign.</div>
          )}
        </div>
        <div className="adm-modal-footer adm-modal-footer--end">
          <button type="button" className="adm-btn-ghost" onClick={exportRecipients} disabled={!groups.length}>
            <Download size={13} style={{ marginRight: 5, verticalAlign: -2 }} /> Export recipients
          </button>
          <button type="button" className="adm-btn-red" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
