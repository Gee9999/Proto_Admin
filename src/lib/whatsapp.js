/** WhatsApp admin API helpers. All reads hit our own ledger, not WATI. */

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export async function fetchWaContacts({ page = 1, pageSize = 50, search = '', businessTypes = [], scope = 'all' } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), scope });
  if (search) params.set('search', search);
  businessTypes.forEach((t) => params.append('businessType', t));
  return json(await fetch(`/api/wa-contacts?${params}`));
}

export async function fetchWaThread(phone, { markRead = false } = {}) {
  const params = new URLSearchParams({ phone });
  if (markRead) params.set('markRead', 'true');
  return json(await fetch(`/api/wa-thread?${params}`));
}

export async function sendWaReply(phone, { text, templateName, parameters } = {}) {
  return json(await fetch('/api/wa-thread', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, text, templateName, parameters }),
  }));
}

export async function fetchWaTemplates() {
  return json(await fetch('/api/wa-templates'));
}

export async function previewWaAudience({ businessTypes = [], search = '' } = {}) {
  const params = new URLSearchParams();
  businessTypes.forEach((t) => params.append('businessType', t));
  if (search) params.set('search', search);
  return json(await fetch(`/api/wa-broadcast?${params}`));
}

export async function queueWaBroadcast({ templateName, broadcastName, businessTypes = [], search = '', parameters = [] }) {
  return json(await fetch('/api/wa-broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateName, broadcastName, businessTypes, search, parameters }),
  }));
}

export async function fetchWaAnalytics(days = 30) {
  return json(await fetch(`/api/wa-analytics?days=${days}`));
}

export function formatWhen(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Delivery status → label + tone. Drives the per-contact "last message" badge. */
export function statusMeta(status) {
  switch (status) {
    case 'read':      return { label: 'Read',      tone: 'ok' };
    case 'delivered': return { label: 'Delivered', tone: 'ok' };
    case 'sent':      return { label: 'Sent',      tone: 'muted' };
    case 'queued':    return { label: 'Queued',    tone: 'muted' };
    case 'failed':    return { label: 'Failed',    tone: 'bad' };
    case 'received':  return { label: 'Received',  tone: 'muted' };
    default:          return { label: '—',         tone: 'muted' };
  }
}

export function countdown(ms) {
  if (!ms || ms <= 0) return 'closed';
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return hours ? `${hours}h ${mins}m left` : `${mins}m left`;
}
