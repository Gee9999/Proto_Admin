import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(new URL('../src/components/ProductLoaderPanel.jsx', import.meta.url), 'utf8');
const queue = readFileSync(new URL('../src/components/productLoader/ProductLoaderDormantQueue.jsx', import.meta.url), 'utf8');
const jobsApi = readFileSync(new URL('../api/image-processing-jobs.js', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');

describe('Image Processing Centre durable review surface', () => {
  it('mounts the intended queue surface in the product loader', () => {
    expect(panel).toContain("ProductLoaderDormantQueue");
    expect(panel).toContain("id: 'image-centre', label: 'Image Processing Centre'");
    expect(panel).toContain("fetch('/api/image-processing-jobs?action=list'");
    expect(panel).toContain("action: 'queue'");
    expect(panel).toContain("action: 'apply'");
    expect(panel).toContain("event.detail === 'product-loader' && (activeTab === 'image-centre' || dormantRequested)");
  });

  it('shows saved review, checklist and explicit-apply controls', () => {
    expect(queue).toContain('Retry queue load');
    expect(queue).toContain('No products are waiting in Image Processing Centre.');
    expect(queue).toContain('Processing never replaces a website image automatically.');
    expect(queue).toContain('Required review confirmation');
    expect(queue).toContain('Type ${selectedJob.sku} to apply');
    expect(queue).toContain('Manual lane.');
  });

  it('uses the owner-only durable job API and production function limit', () => {
    expect(jobsApi).toContain("import { requireOwner, verifyAdminUser } from './_admin-auth.js';");
    expect(jobsApi).toContain("from('image_processing_review_jobs')");
    expect(jobsApi).toContain('reviewChecklistComplete');
    expect(jobsApi).toContain('copyImageProcessingStagedUrlToLive');
    expect(vercel).toContain('"api/image-processing-jobs.js": {');
    expect(vercel).toContain('"maxDuration": 60');
  });
});
