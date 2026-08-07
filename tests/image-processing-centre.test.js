import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNutstoreImageJobs,
  createUploadedImageJobs,
  clearImageProcessingJob,
  executeImageProcessingJob,
  fetchImageProcessingJobs,
  normalizeImageProcessingJob,
  summarizeImageProcessingJobs,
  updateImageProcessingJob,
} from '../src/lib/imageProcessingJobs.js';

const panelSource = fs.readFileSync(new URL('../src/components/ProductLoaderPanel.jsx', import.meta.url), 'utf8');
const nutstoreSource = fs.readFileSync(new URL('../src/components/productLoader/ProductLoaderNutstore.jsx', import.meta.url), 'utf8');
const uploadSource = fs.readFileSync(new URL('../src/components/productLoader/ProductLoaderUpload.jsx', import.meta.url), 'utf8');
const adminSource = fs.readFileSync(new URL('../src/pages/AdminPage.jsx', import.meta.url), 'utf8');
const sidebarSource = fs.readFileSync(new URL('../src/components/GroupedSidebar.jsx', import.meta.url), 'utf8');

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Image Processing Centre API adapter', () => {
  it('normalizes worker response variants for a stable review UI', () => {
    expect(normalizeImageProcessingJob({
      job_id: 42,
      product_code: 'ABC1',
      source_image: { name: 'ABC1.jpg', url: '/before.jpg', source: 'nutstore' },
      processed_image: { preview_url: '/after.png' },
      quality_report: { score: 91, flags: ['edge_halo'] },
      cost: { zar: 0.18 },
    })).toMatchObject({
      id: '42', sku: 'ABC1', filename: 'ABC1.jpg', beforeUrl: '/before.jpg',
      afterUrl: '/after.png', qualityScore: 91, qualityFlags: ['edge_halo'], estimatedCost: 0.18,
    });
  });

  it('creates Nutstore batches through the flat collection endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ jobs: [{ id: 'j1', status: 'queued' }] }));
    await createNutstoreImageJobs([{ path: '/PTR-photos/ABC1.jpg', filename: 'ABC1.jpg' }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/image-processing-jobs', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      source: 'nutstore',
      items: [{ path: '/PTR-photos/ABC1.jpg', filename: 'ABC1.jpg' }],
    });
  });

  it('uses a query id for Vercel flat-function job actions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ job: { id: 'job/7', status: 'approved' } }));
    await updateImageProcessingJob('job/7', 'publish', { imageSlot: 3, publishToExistingSlot: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/image-processing-jobs?id=job%2F7', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ action: 'publish', imageSlot: 3, publishToExistingSlot: true }),
    }));
  });

  it('clears an unpublished image through an explicit queue action', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ removed: 'job-7~image-2' }));
    await expect(clearImageProcessingJob('job-7~image-2')).resolves.toBe('job-7~image-2');
    expect(fetchMock).toHaveBeenCalledWith('/api/image-processing-jobs?id=job-7~image-2', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ action: 'clear' }),
    }));
  });

  it('summarizes queue state and estimated Rand cost', () => {
    expect(summarizeImageProcessingJobs([
      { status: 'processing', estimatedCost: 0.12 },
      { status: 'ready', estimatedCost: 0.18 },
      { status: 'published', estimatedCost: 0.2 },
      { status: 'failed', estimatedCost: 0 },
    ])).toEqual({ total: 4, processing: 1, review: 1, approved: 1, failed: 1, cost: 0.5 });
  });
});
describe('Product Loader handoff and owner visibility', () => {
  it('shows the centre tab only for owners', () => {
    expect(panelSource).toContain("...(isOwner ? [{ id: 'image-processing'");
    expect(adminSource).toContain("isOwner={customer?.role === 'owner'}");
  });

  it('turns a stalled queue request into a retryable error', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new globalThis.DOMException('Aborted', 'AbortError')));
    }));
    const pending = fetchImageProcessingJobs();
    const assertion = expect(pending).rejects.toThrow('The image queue did not respond. Please retry.');
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    vi.useRealTimers();
  });

  it('does not abort a legitimate paid execution at the generic 15-second queue timeout', async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new globalThis.DOMException('Aborted', 'AbortError'));
      }, { once: true });
      setTimeout(() => resolve(jsonResponse({
        job: { id: 'job-async', status: 'review', after_url: '/processed/job-async.png' },
      })), 20_000);
    }));

    const execution = executeImageProcessingJob('job-async')
      .then((job) => ({ job }), (error) => ({ error }));

    await vi.advanceTimersByTimeAsync(15_000);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await execution).toMatchObject({
      job: { id: 'job-async', status: 'review', afterUrl: '/processed/job-async.png' },
    });
    vi.useRealTimers();
  });

  it('queues local uploads through the JSON API path used by Vercel functions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ jobs: [{ id: 'j-upload', status: 'queued' }] }));
    const file = {
      name: 'DISPOSABLE.png', type: 'image/png', size: 4,
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    };
    await createUploadedImageJobs([file]);
    expect(fetchMock).toHaveBeenCalledWith('/api/image-processing-jobs', expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      source: 'upload',
      items: [{ filename: 'DISPOSABLE.png', contentType: 'image/png', base64: 'iVBORw==' }],
    });
  });

  it('offers a dedicated sidebar entry without replacing the legacy Image Replace screen', () => {
    expect(sidebarSource).toContain("{ id: 'image-processing', label: 'Image Processing Centre'");
    expect(sidebarSource).toContain("{ id: 'image-replace', label: 'Image Replace'");
    expect(adminSource).toContain("activeSection === 'image-processing'");
    expect(adminSource).toContain('initialTab="image-processing"');
  });

  it('hands off selected Nutstore paths and selected upload files', () => {
    expect(nutstoreSource).toContain('onProcessSelected(selectedPaths.map');
    expect(nutstoreSource).toContain('Improve selected');
    expect(uploadSource).toContain('onProcessFiles(sourceFiles)');
    expect(uploadSource).toContain('Improve selected');
  });

  it('keeps approval separate from explicit slot publishing', () => {
    expect(panelSource).toContain('<ImageProcessingCentre');
    const centre = fs.readFileSync(new URL('../src/components/productLoader/ImageProcessingCentre.jsx', import.meta.url), 'utf8');
    expect(centre).toContain("runAction(selectedJob, 'approve')");
    expect(centre).toContain("runAction(job, 'publish'");
    expect(centre).toContain('publishToExistingSlot: true');
    expect(centre).toContain("runBulkReviewAction('approve')");
    expect(centre).toContain("runAction(selectedJob, 'restore')");
    expect(centre).toContain('Clear from queue');
    expect(centre).toContain('manual human review');
  });

  it('hands an approved image to an exact Product Manager destination', () => {
    const centre = fs.readFileSync(new URL('../src/components/productLoader/ImageProcessingCentre.jsx', import.meta.url), 'utf8');
    expect(centre).toContain('Send to Product Manager');
    expect(centre).toContain('Main product image');
    expect(centre).toContain('Gallery image 2');
    expect(centre).toContain("normalizedSku(product.sku) !== sku");
    expect(centre).toContain('No exact Product Manager product matches SKU');
    expect(centre).toContain('This position already has an image and will be replaced only after confirmation.');
  });
});
