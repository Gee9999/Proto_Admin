/**
 * WhatsApp analytics — computed from our own ledger.
 *
 * Every number here is derived from whatsapp_messages / whatsapp_contacts, so
 * it stays correct during a WATI outage and can be recomputed historically.
 * The old build had no analytics at all because nothing was ever stored.
 */

import { requireAdminKey } from './_admin-auth.js';
import { portalDb } from './_whatsapp-db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const db = portalDb();
    const days = Math.min(365, Math.max(1, Number(req.query.days || 30)));
    const since = new Date(Date.now() - days * DAY_MS).toISOString();

    const [messagesRes, contactsRes, broadcastsRes] = await Promise.all([
      db.from('whatsapp_messages')
        .select('direction, status, template_name, broadcast_id, created_at')
        .gte('created_at', since)
        .limit(50_000),
      db.from('whatsapp_contacts')
        .select('accept_whatsapp, allow_broadcast, is_team, unread_count, last_inbound_at, session_expires_at'),
      db.from('whatsapp_broadcasts')
        .select('id, template_name, broadcast_name, created_at, status, total_targeted,'
          + ' count_sent, count_delivered, count_read, count_failed, count_replied')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    for (const r of [messagesRes, contactsRes, broadcastsRes]) {
      if (r.error) throw new Error(r.error.message);
    }

    const messages = messagesRes.data || [];
    const contacts = (contactsRes.data || []).filter((c) => !c.is_team);
    const broadcasts = broadcastsRes.data || [];

    const outbound = messages.filter((m) => m.direction === 'out');
    const inbound = messages.filter((m) => m.direction === 'in');
    const countBy = (rows, status) => rows.filter((m) => m.status === status).length;

    const delivered = countBy(outbound, 'delivered') + countBy(outbound, 'read');
    const read = countBy(outbound, 'read');
    const failed = countBy(outbound, 'failed');
    const sentOrBetter = outbound.length - countBy(outbound, 'queued') - failed;
    const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

    // Daily series for the chart.
    const buckets = new Map();
    for (let i = days - 1; i >= 0; i -= 1) {
      buckets.set(new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10), { out: 0, in: 0, failed: 0 });
    }
    for (const m of messages) {
      const key = String(m.created_at).slice(0, 10);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      if (m.direction === 'in') bucket.in += 1;
      else {
        bucket.out += 1;
        if (m.status === 'failed') bucket.failed += 1;
      }
    }

    const now = Date.now();
    return res.status(200).json({
      days,
      totals: {
        outbound: outbound.length,
        inbound: inbound.length,
        sent: sentOrBetter,
        delivered,
        read,
        failed,
        queued: countBy(outbound, 'queued'),
        deliveryRate: pct(delivered, sentOrBetter),
        readRate: pct(read, delivered),
        failureRate: pct(failed, outbound.length),
      },
      contacts: {
        total: contacts.length,
        optedIn: contacts.filter((c) => c.accept_whatsapp).length,
        broadcastable: contacts.filter((c) => c.accept_whatsapp && c.allow_broadcast).length,
        withOpenSession: contacts.filter((c) => Date.parse(c.session_expires_at || 0) > now).length,
        unreadThreads: contacts.filter((c) => c.unread_count > 0).length,
        repliedInPeriod: contacts.filter((c) => Date.parse(c.last_inbound_at || 0) >= now - days * DAY_MS).length,
      },
      series: [...buckets.entries()].map(([date, v]) => ({ date, ...v })),
      broadcasts: broadcasts.map((b) => ({
        ...b,
        deliveryRate: pct(b.count_delivered + b.count_read, b.count_sent),
        readRate: pct(b.count_read, b.count_delivered + b.count_read),
        replyRate: pct(b.count_replied, b.count_sent),
      })),
      // Honest about coverage: the message scan is capped.
      truncated: messages.length >= 50_000,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load WhatsApp analytics' });
  }
}
