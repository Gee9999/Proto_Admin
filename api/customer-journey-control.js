import { createClient } from '@supabase/supabase-js';
import { requireAdminKey } from './_admin-auth.js';

const ALLOWED_DAYS = new Set([7, 30, 90]);

function adminClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();
  if (!(await requireAdminKey(req, res))) return;
  const days = Number(req.query?.days || 30);
  if (!ALLOWED_DAYS.has(days)) return res.status(400).json({ error: 'days must be 7, 30 or 90' });
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('customer_journey_events')
    .select('journey,event_type,outcome,created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) return res.status(503).json({ error: 'Journey analytics are temporarily unavailable.' });

  const journeys = {};
  const events = {};
  const outcomes = {};
  const daily = {};
  for (const row of data || []) {
    journeys[row.journey] = (journeys[row.journey] || 0) + 1;
    events[row.event_type] = (events[row.event_type] || 0) + 1;
    if (row.outcome) outcomes[row.outcome] = (outcomes[row.outcome] || 0) + 1;
    const day = String(row.created_at || '').slice(0, 10);
    if (day) daily[day] = (daily[day] || 0) + 1;
  }

  let assistant = { available: false, completed: 0, goals: {} };
  const assistantResult = await supabase.from('customer_buying_assistant').select('goal,completed_at').gte('completed_at', since).limit(5000);
  if (!assistantResult.error) {
    assistant = { available: true, completed: assistantResult.data?.length || 0, goals: {} };
    for (const row of assistantResult.data || []) assistant.goals[row.goal] = (assistant.goals[row.goal] || 0) + 1;
  }

  return res.status(200).json({ days, since, totalEvents: data?.length || 0, journeys, events, outcomes, daily, assistant, readOnly: true });
}
