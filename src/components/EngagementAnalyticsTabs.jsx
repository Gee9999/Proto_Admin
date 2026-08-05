import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, MailOpen, RefreshCw, Users, UserCheck, UserX } from 'lucide-react';

const PAGE_SIZE = 100;
const HIGH_VALUE_THRESHOLD = 10000;
const INACTIVE_DAYS = 90;

function pct(part, total) { return total ? Math.round((part / total) * 100) : 0; }
function emailOf(value) { return String(value || '').trim().toLowerCase(); }
function unique(values) { return [...new Set(values.map(emailOf).filter(Boolean))]; }
function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function exportRows(filename, rows) {
  const blob = new Blob([rows.map((row) => row.map(csvEscape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
function customerName(row) { return row.business_name || row.name || row.company_name || row.email || 'Unknown customer'; }
function orderCount(row) { return Number(row.order_count ?? row.orderCount ?? row.invoice_count ?? 0) || 0; }
function spend(row) { return Number(row.total_spend ?? row.totalSpend ?? row.sales_last_12_months ?? 0) || 0; }
function lastOrder(row) { return row.last_order_at || row.lastOrderAt || row.last_purchase_date || row.last_order_date || null; }

export default function EngagementAnalyticsTabs({ onShowToast }) {
  const [campaigns, setCampaigns] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [customerScope, setCustomerScope] = useState('loading');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const campaignRes = await fetch('/api/email-campaigns');
      const campaignJson = await campaignRes.json();
      if (!campaignRes.ok) throw new Error(campaignJson.error || 'Failed to load email campaigns');
      setCampaigns(campaignJson.campaigns || []);

      const all = [];
      for (let page = 1; page <= 5; page += 1) {
        const res = await fetch(`/api/admin-customers?tab=regular&page=${page}&pageSize=${PAGE_SIZE}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load customer segments');
        const rows = json.rows || [];
        all.push(...rows);
        if (rows.length < PAGE_SIZE || all.length >= Number(json.total || 0)) break;
      }
      setCustomers(all);
      setCustomerScope('available');
    } catch (error) {
      setCustomers([]);
      setCustomerScope('unavailable');
      onShowToast?.(error.message || 'Engagement data unavailable', 'error');
    } finally {
      setLoading(false);
    }
  }, [onShowToast]);

  useEffect(() => { void load(); }, [load]);

  const engagement = useMemo(() => {
    const sent = new Set(); const opened = new Set(); const bounced = new Set();
    (campaigns || []).forEach((campaign) => {
      const eventEmails = campaign.eventEmails || {};
      const recipients = campaign.recipients || campaign.recipientEmails || campaign.to || [];
      unique(Array.isArray(recipients) ? recipients : []).forEach((email) => sent.add(email));
      unique(eventEmails.opened || []).forEach((email) => { opened.add(email); sent.add(email); });
      unique(eventEmails.bounced || []).forEach((email) => { bounced.add(email); sent.add(email); });
    });
    const openedRows = [...opened].map((email) => ({ email, status: 'Opened' }));
    const notOpenedRows = [...sent].filter((email) => !opened.has(email) && !bounced.has(email)).map((email) => ({ email, status: 'Not opened' }));
    return { sent: [...sent], opened: openedRows, notOpened: notOpenedRows, bounced: [...bounced].map((email) => ({ email, status: 'Bounced' })) };
  }, [campaigns]);

  const customerSegments = useMemo(() => {
    const now = Date.now();
    const inactive = customers.filter((row) => {
      const value = lastOrder(row);
      if (!value) return true;
      const time = new Date(value).getTime();
      return !Number.isNaN(time) && (now - time) >= INACTIVE_DAYS * 86400000;
    });
    return {
      repeat: customers.filter((row) => orderCount(row) >= 2),
      firstTime: customers.filter((row) => orderCount(row) === 1),
      inactive,
      highValue: customers.filter((row) => spend(row) >= HIGH_VALUE_THRESHOLD),
    };
  }, [customers]);

  const rowsForTab = tab === 'opened' ? engagement.opened
    : tab === 'not-opened' ? engagement.notOpened
      : tab === 'bounced' ? engagement.bounced
        : tab === 'repeat' ? customerSegments.repeat
          : tab === 'first-time' ? customerSegments.firstTime
            : tab === 'inactive' ? customerSegments.inactive
              : tab === 'high-value' ? customerSegments.highValue : [];

  const exportCurrent = () => {
    const rows = rowsForTab.map((row) => [row.email || emailOf(row.email), customerName(row), orderCount(row), spend(row), lastOrder(row) || '']);
    exportRows(`proto-engagement-${tab}.csv`, [['Email', 'Customer', 'Orders', 'Spend', 'Last order'], ...rows]);
  };

  const metric = (label, value, sub, icon) => (
    <div className="adm-email-stat" key={label}>
      <div className="adm-email-stat__label">{icon} {label}</div>
      <div className="adm-email-stat__value">{value.toLocaleString('en-ZA')}</div>
      {sub && <div className="adm-email-stat__sub">{sub}</div>}
    </div>
  );

  const tabs = [
    ['overview', 'Overview'], ['not-opened', 'Not opened'], ['opened', 'Opened'], ['bounced', 'Bounced'],
    ['repeat', 'Repeat customers'], ['first-time', 'First-time'], ['inactive', 'Inactive 90d+'], ['high-value', 'High-value'],
  ];

  return (
    <section aria-label="Customer engagement analytics" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 17 }}>Engagement segments</h3>
          <p className="adm-section-note" style={{ margin: '3px 0 0' }}>Read-only segments from email events and customer order history. No messages are sent from this view.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="adm-btn-ghost adm-btn--sm" onClick={() => void load()} disabled={loading} aria-label="Refresh engagement data">
            {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Refresh
          </button>
          {tab !== 'overview' && <button type="button" className="adm-btn-ghost adm-btn--sm" onClick={exportCurrent} disabled={!rowsForTab.length}><Download size={13} /> Export CSV</button>}
        </div>
      </div>

      <div className="adm-email-stats">
        {metric('Sent recipients', engagement.sent.length, 'unique addresses', <Users size={14} />)}
        {metric('Opened', engagement.opened.length, `${pct(engagement.opened.length, engagement.sent.length)}% of recipients`, <MailOpen size={14} />)}
        {metric('Not opened', engagement.notOpened.length, `${pct(engagement.notOpened.length, engagement.sent.length)}% of recipients`, <UserX size={14} />)}
        {metric('Repeat customers', customerSegments.repeat.length, customerScope === 'available' ? '2+ recorded orders' : 'order data unavailable', <UserCheck size={14} />)}
      </div>

      <div className="adm-customer-tabs" style={{ margin: '12px 0', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {tabs.map(([key, label]) => <button key={key} type="button" className={`adm-tab${tab === key ? ' adm-tab--active' : ''}`} onClick={() => setTab(key)}>{label}{key !== 'overview' ? ` (${(key === 'not-opened' ? engagement.notOpened : key === 'opened' ? engagement.opened : key === 'bounced' ? engagement.bounced : customerSegments[key] || []).length})` : ''}</button>)}
      </div>

      {tab === 'overview' ? (
        <div className="adm-panel" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: 14 }}>
          <strong>Recommended next action</strong>
          <p className="adm-section-note" style={{ marginTop: 5 }}>Review Not opened first, then compare against Inactive 90d+ and High-value. This identifies customers worth a personal follow-up without automatically contacting anyone.</p>
        </div>
      ) : (
        <div className="adm-table-scroll" style={{ maxHeight: 420 }}>
          <table className="adm-sheet">
            <thead><tr><th>Email</th><th>Customer</th><th>Orders</th><th>Spend</th><th>Last order</th></tr></thead>
            <tbody>
              {rowsForTab.map((row, index) => <tr key={row.email || row.id || index}><td>{row.email || '—'}</td><td>{customerName(row)}</td><td>{orderCount(row) || '—'}</td><td>{spend(row) ? `R ${spend(row).toLocaleString('en-ZA')}` : '—'}</td><td>{lastOrder(row) ? new Date(lastOrder(row)).toLocaleDateString('en-ZA') : '—'}</td></tr>)}
              {!rowsForTab.length && <tr><td colSpan="5" className="adm-muted">{loading ? 'Loading…' : customerScope === 'unavailable' && ['repeat', 'first-time', 'inactive', 'high-value'].includes(tab) ? 'Customer order data is unavailable.' : 'No records in this segment yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="adm-section-note" style={{ marginTop: 10 }}>Email events are based on recorded campaign recipients and webhook events. Customer segments use the current admin customer read model; totals may differ from the full Positill database until the read-only sync includes those fields.</p>
    </section>
  );
}
