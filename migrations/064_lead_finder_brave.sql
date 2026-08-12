-- Owner-only prospecting workspace. The browser has no direct table grants.
create table if not exists public.lead_jobs (
  id uuid primary key default gen_random_uuid(), keyword text not null check (char_length(keyword) between 1 and 120),
  locations jsonb not null check (jsonb_typeof(locations) = 'array'), source text not null check (source = 'brave'),
  status text not null default 'queued' check (status in ('queued','running','completed','partial','failed','cancelled')),
  candidate_limit integer not null default 20 check (candidate_limit between 1 and 50), candidates_found integer not null default 0,
  leads_saved integer not null default 0, config jsonb not null default '{}', last_error text, created_at timestamptz not null default now(), completed_at timestamptz
);
create table if not exists public.lead_records (
  id uuid primary key default gen_random_uuid(), source_job_id uuid references public.lead_jobs(id) on delete set null,
  business_name text, canonical_domain text not null unique, website_url text, public_emails text not null default '', public_phones text not null default '',
  location text, fit_score integer not null default 0 check (fit_score between 0 and 100), score_evidence jsonb not null default '[]',
  status text not null default 'new' check (status in ('new','qualified','ready_to_contact','contacted','responded','joined','not_suitable','duplicate','existing_customer','do_not_contact','bounced')),
  is_existing_proto_customer boolean not null default false, notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists lead_jobs_queue_idx on public.lead_jobs(status, created_at);
create index if not exists lead_records_review_idx on public.lead_records(status, fit_score desc);
alter table public.lead_jobs enable row level security; alter table public.lead_records enable row level security;
revoke all on public.lead_jobs, public.lead_records from anon, authenticated;
