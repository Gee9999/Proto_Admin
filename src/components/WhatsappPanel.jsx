import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BarChart2, Check, CheckCheck, Clock, Inbox, Loader2, Megaphone,
  MessageCircle, RefreshCw, Search, Send, Users, X,
} from 'lucide-react';
import { ADMIN_REFRESH_EVENT } from '../lib/adminRefresh';
import { BUSINESS_TYPES } from '../lib/businessTypes';
import AdminSelect from './AdminSelect';
import {
  countdown, fetchWaAnalytics, fetchWaContacts, fetchWaTemplates, fetchWaThread,
  formatWhen, previewWaAudience, queueWaBroadcast, sendWaReply, statusMeta,
} from '../lib/whatsapp';

const TABS = [
  { id: 'broadcast', label: 'Broadcast', icon: Megaphone },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'analytics', label: 'Analytics', icon: BarChart2 },
  { id: 'contacts', label: 'Contacts', icon: Users },
];

function StatusPill({ status }) {
  const meta = statusMeta(status);
  const Icon = status === 'read' ? CheckCheck
    : status === 'delivered' ? CheckCheck
      : status === 'failed' ? X
        : status === 'queued' ? Clock : Check;
  return (
    <span className={`wa-pill wa-pill--${meta.tone}`} title={meta.label}>
      <Icon size={12} /> {meta.label}
    </span>
  );
}

function Stat({ value, label, hint, tone }) {
  return (
    <div className={`wa-stat${tone ? ` wa-stat--${tone}` : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      {hint && <em className="adm-muted">{hint}</em>}
    </div>
  );
}

function useTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await fetchWaTemplates();
      setTemplates(data.templates || []);
    } catch (err) {
      setError(err.message || 'Failed to load templates');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { templates, templatesLoading: loading, templatesError: error, reloadTemplates: load };
}

/* ── Broadcast ───────────────────────────────────────────────────────────── */
function BroadcastTab({ templates, templatesLoading, templatesError, onShowToast }) {
  const [selected, setSelected] = useState('');
  const [businessTypes, setBusinessTypes] = useState([]);
  const [search, setSearch] = useState('');
  const [audience, setAudience] = useState({ total: 0, sample: [] });
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [params, setParams] = useState([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const template = useMemo(
    () => templates.find((t) => t.name === selected) || null,
    [templates, selected],
  );

  useEffect(() => {
    if (!selected && templates.length) setSelected(templates[0].name);
  }, [templates, selected]);

  useEffect(() => {
    setParams(Array.from({ length: template?.placeholders || 0 }, (_, i) => params[i] || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.name, template?.placeholders]);

  useEffect(() => {
    let cancelled = false;
    setAudienceLoading(true);
    const timer = setTimeout(() => {
      previewWaAudience({ businessTypes, search })
        .then((data) => { if (!cancelled) setAudience(data); })
        .catch(() => { if (!cancelled) setAudience({ total: 0, sample: [] }); })
        .finally(() => { if (!cancelled) setAudienceLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [businessTypes, search]);

  const toggleType = (type) => setBusinessTypes((prev) => (
    prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
  ));

  const missingParams = params.some((p) => !String(p).trim());

  const send = async () => {
    if (!template) return;
    const ok = window.confirm(
      `Queue "${template.name}" to ${audience.total} opted-in contact${audience.total === 1 ? '' : 's'}?`,
    );
    if (!ok) return;
    setSending(true); setResult(null);
    try {
      const data = await queueWaBroadcast({
        templateName: template.name,
        broadcastName: template.name,
        businessTypes,
        search,
        parameters: params.map((value, i) => ({ name: String(i + 1), value })),
      });
      setResult(data);
      onShowToast?.(`Queued ${data.queued} WhatsApp message(s)`, 'success');
    } catch (err) {
      onShowToast?.(err.message || 'Broadcast failed', 'error');
    } finally { setSending(false); }
  };

  return (
    <div className="wa-layout">
      <aside className="wa-audience">
        <h3>Audience</h3>
        <p className="adm-muted wa-note">
          Only customers who ticked the WhatsApp opt-in at registration are reachable.
          Fulfilment team numbers and contacts who sent STOP are always excluded.
        </p>

        <label className="adm-search wa-search">
          <Search size={14} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or number…"
            className="adm-search-input"
          />
        </label>

        <div className="wa-filter-block">
          <span className="wa-filter-label">Business type</span>
          <div className="wa-chip-row">
            <button
              type="button"
              className={`wa-chip${businessTypes.length === 0 ? ' wa-chip--on' : ''}`}
              onClick={() => setBusinessTypes([])}
            >
              {businessTypes.length === 0 && <Check size={12} strokeWidth={3} />} All
            </button>
            {BUSINESS_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className={`wa-chip${businessTypes.includes(type) ? ' wa-chip--on' : ''}`}
                onClick={() => toggleType(type)}
              >
                {businessTypes.includes(type) && <Check size={12} strokeWidth={3} />} {type}
              </button>
            ))}
          </div>
        </div>

        <div className={`wa-match-count${audience.total ? ' wa-match-count--ready' : ''}`}>
          <Megaphone size={16} />
          <span>
            {audienceLoading
              ? 'Counting…'
              : <><strong>{audience.total}</strong> opted-in contact{audience.total === 1 ? '' : 's'} will receive this</>}
          </span>
        </div>

        {audience.sample?.length > 0 && (
          <ul className="wa-sample">
            {audience.sample.slice(0, 8).map((c) => (
              <li key={c.phone}><strong>{c.name || c.phoneDisplay}</strong><span>{c.businessType || '—'}</span></li>
            ))}
            {audience.total > 8 && <li className="adm-muted">+{audience.total - 8} more</li>}
          </ul>
        )}
      </aside>

      <section className="wa-compose">
        <h3>Compose broadcast</h3>

        {templatesError && (
          <div className="wa-alert wa-alert--bad">
            <AlertTriangle size={15} /> {templatesError}
          </div>
        )}

        <label className="wa-field">
          <span className="wa-field-label">Approved template</span>
          {templatesLoading ? (
            <div className="wa-loading"><Loader2 size={16} className="spin" /> Loading templates…</div>
          ) : (
            <AdminSelect
              ariaLabel="Approved template"
              minWidth={260}
              value={selected}
              onChange={setSelected}
              options={[
                { value: '', label: templates.length ? 'Select a template' : 'No approved templates' },
                ...templates.map((t) => ({ value: t.name, label: `${t.name}${t.category ? ` · ${t.category}` : ''}` })),
              ]}
            />
          )}
        </label>

        {template?.placeholders > 0 && (
          <div className="wa-field">
            <span className="wa-field-label">
              Template values ({template.placeholders} required)
            </span>
            {params.map((value, i) => (
              <input
                key={`param-${i}`}
                className="adm-input"
                value={value}
                placeholder={`{{${i + 1}}}`}
                onChange={(e) => setParams((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
              />
            ))}
          </div>
        )}

        <div className="wa-preview">
          <div className="wa-preview__label">Preview</div>
          <div className="wa-preview__phone">
            <div className="wa-preview__bubble">
              {template?.headerText && <div className="wa-preview__header">{template.headerText}</div>}
              <div className="wa-preview__body">
                {template
                  ? (template.body || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => params[Number(n) - 1] || m)
                  : 'Select a template to preview.'}
              </div>
              {template?.footer && <div className="wa-preview__footer">{template.footer}</div>}
              {template?.buttons?.length > 0 && (
                <div className="wa-preview__buttons">
                  {template.buttons.map((b) => <span key={b.index} className="wa-preview__btn">{b.text}</span>)}
                </div>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="adm-btn-red wa-send-btn"
          disabled={sending || !template || !audience.total || missingParams}
          onClick={send}
        >
          {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
          {sending ? 'Queueing…' : `Queue to ${audience.total} contact${audience.total === 1 ? '' : 's'}`}
        </button>
        {missingParams && <p className="adm-muted wa-note">Fill every template value before sending.</p>}

        {result && (
          <div className="wa-alert wa-alert--ok">
            <Check size={15} />
            <span>
              {result.message} Track delivery per contact in <strong>Analytics</strong>.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

/* ── Inbox ───────────────────────────────────────────────────────────────── */
function InboxTab({ templates, onShowToast, initialPhone }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null);
  const [thread, setThread] = useState({ contact: null, messages: [] });
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [templateFallback, setTemplateFallback] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchWaContacts({ scope: 'inbox', pageSize: 100 });
      setThreads(data.contacts || []);
    } catch (err) {
      onShowToast?.(err.message || 'Failed to load inbox', 'error');
    } finally { setLoading(false); }
  }, [onShowToast]);

  const openThread = useCallback(async (phone) => {
    setActive(phone); setThreadLoading(true); setDraft('');
    try {
      const data = await fetchWaThread(phone, { markRead: true });
      setThread(data);
      setThreads((prev) => prev.map((t) => (t.phone === phone ? { ...t, unread_count: 0 } : t)));
    } catch (err) {
      onShowToast?.(err.message || 'Failed to load conversation', 'error');
    } finally { setThreadLoading(false); }
  }, [onShowToast]);

  useEffect(() => { void loadThreads(); }, [loadThreads]);
  // Opening a thread from the Contacts tab hands the number over here.
  useEffect(() => { if (initialPhone) void openThread(initialPhone); }, [initialPhone, openThread]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [thread.messages.length]);

  const open = thread.contact?.sessionOpen;

  const send = async () => {
    if (!active) return;
    setSending(true);
    try {
      await sendWaReply(active, open
        ? { text: draft.trim() }
        : { templateName: templateFallback });
      setDraft('');
      await openThread(active);
      onShowToast?.('Message sent', 'success');
    } catch (err) {
      onShowToast?.(err.payload?.message || err.message || 'Send failed', 'error');
    } finally { setSending(false); }
  };

  return (
    <div className="wa-inbox">
      <aside className="wa-threads">
        <div className="wa-threads__head">
          <h3>Conversations</h3>
          <button type="button" className="adm-btn-ghost adm-btn-sm" onClick={loadThreads} disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
        {!loading && !threads.length && (
          <p className="adm-muted wa-note">No incoming messages yet. Conversations appear here as customers reply.</p>
        )}
        <ul className="wa-thread-list">
          {threads.map((t) => (
            <li key={t.phone}>
              <button
                type="button"
                className={`wa-thread-btn${active === t.phone ? ' wa-thread-btn--active' : ''}`}
                onClick={() => openThread(t.phone)}
              >
                <span className="wa-thread-name">
                  {t.wa_name || t.phoneDisplay}
                  {t.unread_count > 0 && <span className="wa-unread">{t.unread_count}</span>}
                </span>
                <span className="wa-thread-preview">{t.last_inbound_preview || '—'}</span>
                <span className="wa-thread-meta">
                  {formatWhen(t.last_inbound_at)}
                  {t.sessionOpen && <em className="wa-window-open">· {countdown(t.sessionMsRemaining)}</em>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="wa-conversation">
        {!active && <div className="wa-empty"><MessageCircle size={28} /><p>Select a conversation</p></div>}

        {active && (
          <>
            <header className="wa-conv-head">
              <div>
                <strong>{thread.contact?.wa_name || thread.contact?.phoneDisplay}</strong>
                <span className="adm-muted">{thread.contact?.phoneDisplay}</span>
              </div>
              <span className={`wa-pill wa-pill--${open ? 'ok' : 'muted'}`}>
                <Clock size={12} /> {open ? countdown(thread.contact.sessionMsRemaining) : '24h window closed'}
              </span>
            </header>

            <div className="wa-messages">
              {threadLoading && <div className="wa-loading"><Loader2 size={16} className="spin" /> Loading…</div>}
              {thread.messages.map((m) => (
                <div key={m.id} className={`wa-msg wa-msg--${m.direction}`}>
                  <div className="wa-msg__body">{m.body || <em className="adm-muted">[{m.message_type}]</em>}</div>
                  <div className="wa-msg__meta">
                    {formatWhen(m.created_at)}
                    {m.direction === 'out' && <> · <StatusPill status={m.status} /></>}
                    {m.template_name && <> · <span className="adm-muted">{m.template_name}</span></>}
                    {m.error && <> · <span className="wa-error">{m.error}</span></>}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <footer className="wa-composer">
              {open ? (
                <>
                  <textarea
                    className="adm-input wa-reply"
                    rows={2}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type a reply…"
                  />
                  <button
                    type="button"
                    className="adm-btn-red"
                    disabled={sending || !draft.trim()}
                    onClick={send}
                  >
                    {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                  </button>
                </>
              ) : (
                <div className="wa-window-closed">
                  <AlertTriangle size={15} />
                  <span>
                    The 24-hour reply window has closed. WhatsApp only allows an approved template now.
                  </span>
                  <AdminSelect
                    ariaLabel="Template to send"
                    minWidth={220}
                    value={templateFallback}
                    onChange={setTemplateFallback}
                    options={[
                      { value: '', label: 'Choose a template' },
                      ...templates.map((t) => ({ value: t.name, label: t.name })),
                    ]}
                  />
                  <button
                    type="button"
                    className="adm-btn-red"
                    disabled={sending || !templateFallback}
                    onClick={send}
                  >
                    {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Send template
                  </button>
                </div>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

/* ── Analytics ───────────────────────────────────────────────────────────── */
function AnalyticsTab({ onShowToast }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (window) => {
    setLoading(true);
    try { setData(await fetchWaAnalytics(window)); }
    catch (err) { onShowToast?.(err.message || 'Failed to load analytics', 'error'); }
    finally { setLoading(false); }
  }, [onShowToast]);

  useEffect(() => { void load(days); }, [days, load]);

  const peak = useMemo(
    () => Math.max(1, ...(data?.series || []).map((d) => Math.max(d.out, d.in))),
    [data],
  );

  if (loading && !data) return <div className="wa-loading"><Loader2 size={16} className="spin" /> Loading analytics…</div>;
  if (!data) return null;

  const { totals, contacts, series, broadcasts } = data;

  return (
    <div className="wa-analytics">
      <div className="wa-range">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            className={`wa-chip${days === d ? ' wa-chip--on' : ''}`}
            onClick={() => setDays(d)}
          >
            {d} days
          </button>
        ))}
      </div>

      <div className="wa-stats">
        <Stat value={totals.outbound} label="Sent out" hint={`${totals.queued} still queued`} />
        <Stat value={`${totals.deliveryRate}%`} label="Delivered" hint={`${totals.delivered} of ${totals.sent}`} tone="accent" />
        <Stat value={`${totals.readRate}%`} label="Read" hint={`${totals.read} messages`} />
        <Stat value={totals.inbound} label="Replies in" hint={`${contacts.repliedInPeriod} contacts`} />
        <Stat value={totals.failed} label="Failed" hint={`${totals.failureRate}% of sends`} tone={totals.failed ? 'bad' : undefined} />
      </div>

      <div className="wa-stats">
        <Stat value={contacts.optedIn} label="Opted in" hint={`of ${contacts.total} contacts`} />
        <Stat value={contacts.broadcastable} label="Broadcast ready" />
        <Stat value={contacts.withOpenSession} label="Open 24h windows" />
        <Stat value={contacts.unreadThreads} label="Unread threads" tone={contacts.unreadThreads ? 'accent' : undefined} />
      </div>

      <div className="wa-chart">
        <div className="wa-chart__head">Messages per day</div>
        <div className="wa-chart__bars">
          {series.map((d) => (
            <div key={d.date} className="wa-chart__col" title={`${d.date}: ${d.out} out, ${d.in} in, ${d.failed} failed`}>
              <div className="wa-chart__bar wa-chart__bar--out" style={{ height: `${(d.out / peak) * 100}%` }} />
              <div className="wa-chart__bar wa-chart__bar--in" style={{ height: `${(d.in / peak) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="wa-chart__legend">
          <span><i className="wa-swatch wa-swatch--out" /> Outbound</span>
          <span><i className="wa-swatch wa-swatch--in" /> Inbound</span>
        </div>
      </div>

      <div className="wa-broadcast-table">
        <h3>Broadcasts</h3>
        {!broadcasts.length && <p className="adm-muted">No broadcasts in this period.</p>}
        {broadcasts.length > 0 && (
          <table className="adm-sheet">
            <thead>
              <tr>
                <th>Template</th><th>When</th><th>Targeted</th><th>Sent</th>
                <th>Delivered</th><th>Read</th><th>Failed</th><th>Replies</th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((b) => (
                <tr key={b.id}>
                  <td>{b.broadcast_name || b.template_name}</td>
                  <td>{formatWhen(b.created_at)}</td>
                  <td>{b.total_targeted}</td>
                  <td>{b.count_sent}</td>
                  <td>{b.count_delivered} <span className="adm-muted">({b.deliveryRate}%)</span></td>
                  <td>{b.count_read} <span className="adm-muted">({b.readRate}%)</span></td>
                  <td className={b.count_failed ? 'wa-error' : undefined}>{b.count_failed}</td>
                  <td>{b.count_replied} <span className="adm-muted">({b.replyRate}%)</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.truncated && (
        <p className="adm-muted wa-note">
          Message scan capped at 50,000 rows for this period — totals may undercount.
        </p>
      )}
    </div>
  );
}

/* ── Contacts ────────────────────────────────────────────────────────────── */
function ContactsTab({ onShowToast, onOpenThread }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('all');
  const [loading, setLoading] = useState(false);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchWaContacts({ page, pageSize, search, scope });
      setRows(data.contacts || []);
      setTotal(data.total || 0);
    } catch (err) {
      onShowToast?.(err.message || 'Failed to load contacts', 'error');
    } finally { setLoading(false); }
  }, [page, search, scope, onShowToast]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="wa-contacts">
      <div className="wa-contacts__bar">
        <label className="adm-search">
          <Search size={14} />
          <input
            className="adm-search-input"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name or number…"
          />
        </label>
        <div className="wa-chip-row">
          {[
            { id: 'all', label: 'All' },
            { id: 'broadcastable', label: 'Opted in' },
            { id: 'inbox', label: 'Has replied' },
            { id: 'unread', label: 'Unread' },
          ].map((s) => (
            <button
              key={s.id}
              type="button"
              className={`wa-chip${scope === s.id ? ' wa-chip--on' : ''}`}
              onClick={() => { setScope(s.id); setPage(1); }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="adm-muted">{total} contact{total === 1 ? '' : 's'}</span>
      </div>

      <table className="adm-sheet wa-contacts__table">
        <thead>
          <tr>
            <th>Contact</th><th>Number</th><th>Type</th><th>Opt-in</th>
            <th>Last message sent</th><th>Status</th><th>Last reply</th><th />
          </tr>
        </thead>
        <tbody>
          {loading && !rows.length && (
            <tr><td colSpan={8}><Loader2 size={14} className="spin" /> Loading…</td></tr>
          )}
          {!loading && !rows.length && (
            <tr><td colSpan={8} className="adm-muted">No contacts match.</td></tr>
          )}
          {rows.map((c) => (
            <tr key={c.phone}>
              <td>{c.wa_name || '—'}</td>
              <td>{c.phoneDisplay}</td>
              <td>{c.business_type || '—'}</td>
              <td>
                {c.accept_whatsapp
                  ? <Check size={15} color="#15803d" strokeWidth={3} aria-label="Opted in" />
                  : <X size={15} color="#dc2626" strokeWidth={3} aria-label="Not opted in" />}
              </td>
              {/* The column that replaces WATI contact attributes entirely. */}
              <td>
                {c.last_outbound_at ? (
                  <>
                    <strong>{c.last_outbound_template || 'Message'}</strong>
                    <br />
                    <span className="adm-muted">{formatWhen(c.last_outbound_at)}</span>
                  </>
                ) : <span className="adm-muted">Never</span>}
              </td>
              <td>{c.last_outbound_at ? <StatusPill status={c.last_outbound_status} /> : '—'}</td>
              <td>
                {formatWhen(c.last_inbound_at)}
                {c.unread_count > 0 && <span className="wa-unread">{c.unread_count}</span>}
              </td>
              <td>
                {c.last_inbound_at && (
                  <button type="button" className="adm-btn-ghost adm-btn-sm" onClick={() => onOpenThread(c.phone)}>
                    Open
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="wa-pager">
        <button type="button" className="adm-btn-ghost adm-btn-sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span className="adm-muted">Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
        <button
          type="button"
          className="adm-btn-ghost adm-btn-sm"
          disabled={page >= Math.ceil(total / pageSize)}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * WhatsApp — broadcast, inbox, analytics and contacts over the WATI channel.
 *
 * Everything displayed here is read from our own message ledger (migration
 * 060), not from WATI contact attributes. "What did we last send this contact
 * and did it land" is a stored column maintained on every send and every
 * delivery webhook, which is what makes the analytics tab possible at all.
 */
export default function WhatsappPanel({ onShowToast }) {
  const [tab, setTab] = useState('broadcast');
  const { templates, templatesLoading, templatesError, reloadTemplates } = useTemplates();
  const [pendingThread, setPendingThread] = useState(null);

  useEffect(() => {
    const handler = () => reloadTemplates();
    window.addEventListener(ADMIN_REFRESH_EVENT, handler);
    return () => window.removeEventListener(ADMIN_REFRESH_EVENT, handler);
  }, [reloadTemplates]);

  const openThread = (phone) => { setPendingThread(phone); setTab('inbox'); };

  return (
    <div className="wa-panel">
      <div className="wa-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              className={`wa-tab${tab === t.id ? ' wa-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'broadcast' && (
        <BroadcastTab
          templates={templates}
          templatesLoading={templatesLoading}
          templatesError={templatesError}
          onShowToast={onShowToast}
        />
      )}
      {tab === 'inbox' && <InboxTab templates={templates} onShowToast={onShowToast} initialPhone={pendingThread} />}
      {tab === 'analytics' && <AnalyticsTab onShowToast={onShowToast} />}
      {tab === 'contacts' && <ContactsTab onShowToast={onShowToast} onOpenThread={openThread} />}
    </div>
  );
}
