import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';

async function request(url, options) {
  const response = await fetch(url, options);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || 'Lead Finder request failed');
  return json;
}

export default function LeadFinderPanel({ onShowToast }) {
  const [data, setData] = useState({ jobs: [], rows: [], migrationRequired: false });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ keyword: '', locations: '', candidateLimit: 20 });
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await request('/api/lead-finder')); } catch (error) { onShowToast?.(error.message, 'error'); } finally { setLoading(false); }
  }, [onShowToast]);
  useEffect(() => { void load(); }, [load]);
  const submit = async (event) => {
    event.preventDefault(); setSubmitting(true);
    try {
      const result = await request('/api/lead-finder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create_job', ...form }) });
      onShowToast?.(result.message, 'success'); setForm((value) => ({ ...value, keyword: '', locations: '' })); await load();
    } catch (error) { onShowToast?.(error.message, 'error'); } finally { setSubmitting(false); }
  };
  return <div className="adm-panel" style={{ display: 'grid', gap: 16 }}>
    <div className="adm-section-head"><div><h2 className="adm-section-title">Lead Finder</h2><p className="adm-section-note">Find prospective wholesale retailers through Brave Search, then review them before any contact is made.</p></div><button type="button" className="adm-btn-ghost" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Refresh</button></div>
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '11px 13px', border: '1px solid #c7d9ed', borderRadius: 9, background: '#f0f7ff', color: '#294967', fontSize: 13 }}><ShieldCheck size={17} /><span><strong>Brave Search only.</strong> Each job is capped at 50 candidates and US$0.25. No paid enrichment, crawling or messages can start from this screen.</span></div>
    {data.migrationRequired ? <div style={{ padding: 28, border: '1px dashed #b8c6d4', borderRadius: 10, textAlign: 'center' }}><strong>Database setup required</strong><p>{data.message}</p></div> : <><form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr .6fr auto', gap: 10, alignItems: 'end' }}><label>Business type<input required value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder="e.g. independent gift shops" /></label><label>Locations<input required value={form.locations} onChange={(e) => setForm({ ...form, locations: e.target.value })} placeholder="Cape Town, Stellenbosch" /></label><label>Max leads<select value={form.candidateLimit} onChange={(e) => setForm({ ...form, candidateLimit: Number(e.target.value) })}><option>10</option><option>20</option><option>50</option></select></label><button className="adm-btn-red" disabled={submitting}>{submitting ? <Loader2 size={15} className="spin" /> : <Search size={15} />} Queue Brave search</button></form><section><h3 style={{ margin: '8px 0' }}>Recent jobs</h3>{data.jobs.length ? data.jobs.map((job) => <div key={job.id} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr .8fr .6fr', padding: '10px 12px', marginBottom: 5, background: '#f8fafc', borderRadius: 8, fontSize: 13 }}><strong>{job.keyword}</strong><span>{job.locations.join(', ')}</span><span>Brave · {job.candidate_limit} max</span><span style={{ textTransform: 'capitalize' }}>{job.status}</span></div>) : <p style={{ color: '#697582' }}>No searches queued yet.</p>}</section></>}
  </div>;
}
