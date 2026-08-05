import { requireAdminKey } from './_admin-auth.js';

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // The key is intentionally never returned to the browser. This endpoint only
  // exposes connection state until the approved enrichment contract is enabled.
  return res.status(200).json({
    configured: Boolean(process.env.APOLLO_API_KEY),
    mode: process.env.APOLLO_API_KEY ? 'enrichment-ready' : 'preview',
    capabilities: ['organization-enrichment', 'people-enrichment', 'account-intent'],
  });
}
