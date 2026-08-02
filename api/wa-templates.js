import { requireAdminKey } from './_admin-auth.js';
import { fetchApprovedTemplates, WatiNotConfigured, watiConfig } from './_wati-client.js';

/** Approved WATI templates. The only endpoint that reads live WATI on a page render. */
export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();

  if (!watiConfig().configured) {
    return res.status(503).json({ error: 'WATI_API_TOKEN is not configured', templates: [] });
  }
  try {
    return res.status(200).json({ templates: await fetchApprovedTemplates() });
  } catch (err) {
    if (err instanceof WatiNotConfigured) {
      return res.status(503).json({ error: 'WATI_API_TOKEN is not configured', templates: [] });
    }
    return res.status(502).json({ error: err.message || 'Failed to load WhatsApp templates', templates: [] });
  }
}
