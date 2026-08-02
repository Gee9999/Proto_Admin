/**
 * Create a broadcast. This endpoint QUEUES ONLY — it never sends.
 *
 * The previous build looped `sendTemplateMessage` synchronously inside the
 * request, so a few hundred recipients would blow the serverless time limit
 * mid-run and leave no record of who had actually been messaged. Here the
 * request writes one broadcast row plus one queued message row per recipient
 * and returns; api/wa-broadcast-worker.js drains the queue on a cron.
 *
 * GET  — audience preview (count + sample), so the composer's number and the
 *        worker's send list come from the same SQL function and cannot diverge.
 * POST — create the broadcast and enqueue.
 */

import { requireAdminKey, verifyAdminUser } from './_admin-auth.js';
import { checkRateLimit, clientIp } from './_rate-limit.js';
import { fetchApprovedTemplates, WatiNotConfigured } from './_wati-client.js';
import { portalDb, resolveAudience } from './_whatsapp-db.js';

const MAX_RECIPIENTS = 5000;

function parseFilters(source) {
  return {
    businessTypes: [].concat(source.businessType || source.businessTypes || []).filter(Boolean),
    search: String(source.search || '').trim(),
  };
}

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');

  let db;
  try { db = portalDb(); } catch (err) { return res.status(500).json({ error: err.message }); }

  if (req.method === 'GET') {
    try {
      const filters = parseFilters(req.query);
      const audience = await resolveAudience(db, filters);
      return res.status(200).json({
        total: audience.length,
        sample: audience.slice(0, 20).map((a) => ({
          phone: a.phone, phoneDisplay: `+${a.phone}`, name: a.wa_name, businessType: a.business_type,
        })),
        filters,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to resolve audience' });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const limit = await checkRateLimit({ bucket: `wa-broadcast:${clientIp(req)}`, max: 5, windowSeconds: 3600 });
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter || 600));
    return res.status(429).json({ error: 'Broadcast limit reached (5/hour)' });
  }

  try {
    const templateName = String(req.body?.templateName || '').trim();
    if (!templateName) return res.status(400).json({ error: 'templateName is required' });
    const broadcastName = String(req.body?.broadcastName || templateName).trim();
    const filters = parseFilters(req.body || {});
    const parameters = Array.isArray(req.body?.parameters) ? req.body.parameters : [];

    // Only approved templates can be broadcast — check against WATI, not our cache.
    const templates = await fetchApprovedTemplates();
    const template = templates.find((t) => t.name === templateName);
    if (!template) return res.status(400).json({ error: 'Template is not approved or no longer exists' });
    if (template.placeholders > parameters.length) {
      return res.status(400).json({
        error: `Template needs ${template.placeholders} parameter(s), got ${parameters.length}`,
      });
    }

    const audience = await resolveAudience(db, filters);
    if (!audience.length) return res.status(400).json({ error: 'No opted-in contacts match those filters' });
    if (audience.length > MAX_RECIPIENTS) {
      return res.status(400).json({ error: `Audience of ${audience.length} exceeds the ${MAX_RECIPIENTS} cap` });
    }

    const admin = await verifyAdminUser(req);

    const { data: broadcast, error: bErr } = await db
      .from('whatsapp_broadcasts')
      .insert({
        template_name: templateName,
        broadcast_name: broadcastName,
        audience_filter: { ...filters, parameters },
        created_by: admin?.email || 'admin',
        status: 'queued',
        total_targeted: audience.length,
      })
      .select()
      .single();
    if (bErr) throw new Error(bErr.message);

    // Enqueue in chunks so one oversized insert can't fail the whole broadcast.
    const body = template.body || '';
    const rows = audience.map((a) => ({
      phone: a.phone,
      direction: 'out',
      body,
      message_type: 'template',
      template_name: templateName,
      broadcast_id: broadcast.id,
      status: 'queued',
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('whatsapp_messages').insert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }

    return res.status(200).json({
      ok: true,
      broadcastId: broadcast.id,
      queued: rows.length,
      // Nothing has been sent yet — the worker picks this up within a minute.
      message: `Queued ${rows.length} message(s). Delivery starts within a minute and is tracked per contact.`,
    });
  } catch (err) {
    if (err instanceof WatiNotConfigured) {
      return res.status(503).json({ error: 'WATI_API_TOKEN is not configured' });
    }
    return res.status(500).json({ error: err.message || 'Failed to queue broadcast' });
  }
}
