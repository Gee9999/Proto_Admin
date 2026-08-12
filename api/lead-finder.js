import { createClient } from '@supabase/supabase-js';
import { requireOwner } from './_admin-auth.js';

const SOURCE = 'brave';
const MAX_CANDIDATES = 50;

function client() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function clean(value, limit) {
  return String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export default async function handler(req, res) {
  if (!(await requireOwner(req, res))) return;
  if (req.method === 'GET') {
    try {
      const sb = client();
      const [{ data: jobs, error: jobError }, { data: leads, error: leadError }] = await Promise.all([
        sb.from('lead_jobs').select('*').order('created_at', { ascending: false }).limit(10),
        sb.from('lead_records').select('*').order('fit_score', { ascending: false }).limit(50),
      ]);
      if (jobError || leadError) {
        const message = (jobError || leadError).message || '';
        if (/lead_(jobs|records)/i.test(message)) return res.status(200).json({ migrationRequired: true, jobs: [], rows: [], message: 'Apply migration 064_lead_finder_brave.sql before using Lead Finder.' });
        throw jobError || leadError;
      }
      return res.status(200).json({ migrationRequired: false, jobs: jobs || [], rows: leads || [] });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Could not load Lead Finder' });
    }
  }
  if (req.method !== 'POST' || req.body?.action !== 'create_job') return res.status(405).end();
  const keyword = clean(req.body?.keyword, 120);
  const locations = [...new Set(String(req.body?.locations || '').split(',').map((x) => clean(x, 80)).filter(Boolean))].slice(0, 20);
  const candidateLimit = Math.min(MAX_CANDIDATES, Math.max(1, Number.parseInt(req.body?.candidateLimit, 10) || 20));
  if (!keyword || !locations.length) return res.status(400).json({ error: 'Enter a business type and at least one location' });
  try {
    const { data, error } = await client().from('lead_jobs').insert({
      keyword, locations, source: SOURCE, candidate_limit: candidateLimit, status: 'queued',
      config: { provider: 'brave', country: 'ZA', searchLanguage: 'en', maxCostUsd: 0.25, enrichment: 'disabled' },
    }).select('*').single();
    if (error) {
      if (/lead_jobs/i.test(error.message || '')) return res.status(409).json({ error: 'Apply migration 064_lead_finder_brave.sql before creating searches' });
      throw error;
    }
    return res.status(201).json({ job: data, message: `Brave search queued. Its maximum search cost is US$0.25; no crawl, enrichment or outreach runs from Admin.` });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not queue search' });
  }
}
