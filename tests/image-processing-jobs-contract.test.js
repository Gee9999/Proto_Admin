import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deploymentEnvironment } from '../api/image-processing-jobs.js';

const route = readFileSync(new URL('../api/image-processing-jobs.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/061_image_processing_jobs.sql', import.meta.url), 'utf8');

describe('Image Processing Centre production contract', () => {
  it('separates preview and production records while only enabling apply in production', () => {
    expect(deploymentEnvironment({ VERCEL_ENV: 'preview' })).toBe('preview');
    expect(deploymentEnvironment({ VERCEL_ENV: 'production' })).toBe('production');
    expect(route).toContain('Applying an image to the live catalogue is disabled outside production');
  });

  it('requires an owner, review checklist, required audit evidence and a stale-write guard', () => {
    expect(route).toContain('requireOwner(req, res)');
    expect(route).toContain('reviewChecklistComplete');
    expect(route).toContain('writeRequiredProductPublishAudit');
    expect(route).toContain(".eq(field, currentValue)");
    expect(route).toContain(".is(field, null)");
  });

  it('uses a protected staged candidate and cleans up an un-applied immutable copy', () => {
    expect(route).toContain("startsWith('staging/image-processing/')");
    expect(route).toContain('copyImageProcessingStagedUrlToLive');
    expect(route).toContain('removeImageProcessingLiveUrl');
    expect(route).not.toContain('resolveLiveImageUrl');
  });

  it('defines durable, service-role-only jobs and events', () => {
    expect(migration).toContain('create table if not exists public.image_processing_review_jobs');
    expect(migration).toContain('create table if not exists public.image_processing_review_job_events');
    expect(migration).toContain('enable row level security');
    expect(migration).toContain('revoke all on public.image_processing_review_jobs from anon, authenticated');
    expect(migration).toContain("'applying'");
  });
});
