/**
 * Broadcast queue drain — cron, every minute.
 *
 * Sends a bounded batch of queued messages per invocation and returns well
 * inside the serverless time limit. Whatever is left is picked up on the next
 * tick, so a 5,000-recipient broadcast completes over several minutes instead
 * of dying half-way through a single request with no record of progress.
 *
 * A message is claimed by flipping its status off 'queued' BEFORE the send, so
 * two overlapping cron runs can't double-send to the same contact.
 */

import { requireCronOrAdminKey } from './_admin-auth.js';
import { sendTemplate, WatiNotConfigured } from './_wati-client.js';
import { portalDb, attachWaMessageId } from './_whatsapp-db.js';

const BATCH = 60;            // messages per invocation
const CONCURRENCY = 5;       // parallel sends; WATI throttles above this
const MAX_RUN_MS = 45_000;

async function pool(items, size, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item) await worker(item);
    }
  });
  await Promise.all(runners);
}

export default async function handler(req, res) {
  if (!(await requireCronOrAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');

  const startedAt = Date.now();
  let db;
  try { db = portalDb(); } catch (err) { return res.status(500).json({ error: err.message }); }

  try {
    const { data: queued, error } = await db
      .from('whatsapp_messages')
      .select('id, phone, template_name, broadcast_id')
      .eq('status', 'queued')
      .not('broadcast_id', 'is', null)
      .order('queued_at', { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(error.message);

    if (!queued?.length) return res.status(200).json({ ok: true, drained: 0 });

    // Cache each broadcast's template parameters once per run.
    const broadcastIds = [...new Set(queued.map((m) => m.broadcast_id))];
    const { data: broadcasts } = await db
      .from('whatsapp_broadcasts')
      .select('id, template_name, broadcast_name, audience_filter, status')
      .in('id', broadcastIds);
    const byId = new Map((broadcasts || []).map((b) => [b.id, b]));

    await db.from('whatsapp_broadcasts')
      .update({ status: 'sending', started_at: new Date().toISOString() })
      .in('id', broadcastIds)
      .eq('status', 'queued');

    let sent = 0;
    let failed = 0;

    await pool(queued, CONCURRENCY, async (msg) => {
      if (Date.now() - startedAt > MAX_RUN_MS) return; // leave the rest for the next tick

      // Claim: only proceed if THIS run flipped the row out of 'queued'.
      const { data: claimed } = await db
        .from('whatsapp_messages')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', msg.id)
        .eq('status', 'queued')
        .select('id')
        .maybeSingle();
      if (!claimed) return; // another invocation got it

      const broadcast = byId.get(msg.broadcast_id);
      const parameters = broadcast?.audience_filter?.parameters || [];

      try {
        const result = await sendTemplate(
          msg.phone,
          msg.template_name || broadcast?.template_name,
          parameters,
          broadcast?.broadcast_name || msg.template_name,
        );
        if (result.success) {
          sent += 1;
          await attachWaMessageId(db, msg.id, result.messageId);
        } else {
          failed += 1;
          await db.from('whatsapp_messages')
            .update({
              status: 'failed', failed_at: new Date().toISOString(),
              error: result.error, raw: result.response,
            })
            .eq('id', msg.id);
        }
      } catch (err) {
        failed += 1;
        await db.from('whatsapp_messages')
          .update({ status: 'failed', failed_at: new Date().toISOString(), error: err.message })
          .eq('id', msg.id);
      }
    });

    // Close out broadcasts with nothing left queued.
    for (const id of broadcastIds) {
      const { count } = await db
        .from('whatsapp_messages')
        .select('id', { count: 'exact', head: true })
        .eq('broadcast_id', id)
        .eq('status', 'queued');
      if (!count) {
        await db.from('whatsapp_broadcasts')
          .update({ status: 'completed', completed_at: new Date().toISOString() })
          .eq('id', id);
      }
    }

    return res.status(200).json({ ok: true, drained: queued.length, sent, failed, ms: Date.now() - startedAt });
  } catch (err) {
    if (err instanceof WatiNotConfigured) {
      return res.status(503).json({ error: 'WATI_API_TOKEN is not configured' });
    }
    return res.status(500).json({ error: err.message || 'Broadcast worker failed' });
  }
}
