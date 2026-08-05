import { requireAdminKey } from './_admin-auth.js';

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  if (req.method === 'POST') {
    if (!process.env.APOLLO_API_KEY) return res.status(503).json({ error: 'Apollo is not configured' });
    const rawDomain = String(req.body?.domain || '').trim().toLowerCase();
    const domain = rawDomain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
    if (!domain || !/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return res.status(400).json({ error: 'Enter a valid business domain' });
    try {
      const response = await fetch(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.APOLLO_API_KEY },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return res.status(response.status).json({ error: payload.error || 'Apollo enrichment failed' });
      const organization = payload.organization || payload.account || null;
      if (!organization) return res.status(200).json({ matched: false, domain });
      return res.status(200).json({ matched: true, domain, organization: {
        id: organization.id || organization.organization_id || null,
        name: organization.name || null,
        website_url: organization.website_url || organization.website || null,
        industry: organization.industry || null,
        estimated_num_employees: organization.estimated_num_employees || null,
        annual_revenue: organization.annual_revenue || null,
        city: organization.city || null,
        state: organization.state || null,
        country: organization.country || null,
        retail_location_count: organization.retail_location_count || null,
      } });
    } catch (error) {
      console.error('Apollo organization enrichment failed:', error?.message || error);
      return res.status(502).json({ error: 'Apollo enrichment unavailable' });
    }
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // The key is intentionally never returned to the browser. This endpoint only
  // exposes connection state until the approved enrichment contract is enabled.
  return res.status(200).json({
    configured: Boolean(process.env.APOLLO_API_KEY),
    mode: process.env.APOLLO_API_KEY ? 'enrichment-ready' : 'preview',
    capabilities: ['organization-enrichment', 'people-enrichment', 'account-intent'],
  });
}
