import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Jimp } from 'jimp';
import { describe, expect, it } from 'vitest';
import { parseImageProcessingRequest } from '../api/_image-processing-request.js';
import {
  analyzeImageQuality,
  estimatedImageCostUsd,
  markImageApproved,
  publishApprovedImage,
  restorePublishedOriginal,
} from '../api/_image-processing-service.js';
import {
  deriveJobStatus,
  imageFieldForSlot,
  jobFingerprint,
  normalizeCreateImage,
  PRODUCT_MANAGER_TABLE,
  productManagerDestination,
  qualityScoreFromMetrics,
  stableJobId,
  summarizeJob,
} from '../lib/image-processing-centre.mjs';

const ROOT = join(import.meta.dirname, '..');

function productManagerStock({ productRows = [], updateRows = productRows } = {}) {
  const calls = { copies: [], updates: [], filters: [] };
  const productTable = {
    select() {
      const query = {
        eq(field, value) {
          calls.filters.push(['select.eq', field, value]);
          return query;
        },
        limit(value) {
          calls.filters.push(['select.limit', value]);
          return Promise.resolve({ data: productRows, error: null });
        },
      };
      return query;
    },
    update(patch) {
      calls.updates.push(patch);
      const query = {
        eq(field, value) {
          calls.filters.push(['update.eq', field, value]);
          return query;
        },
        is(field, value) {
          calls.filters.push(['update.is', field, value]);
          return query;
        },
        select() {
          return Promise.resolve({ data: updateRows, error: null });
        },
      };
      return query;
    },
  };
  return {
    calls,
    client: {
      from(table) {
        if (table === 'website_stock') return productTable;
        if (table === 'product_publish_audit') return { insert: async () => ({ error: null }) };
        throw new Error(`Unexpected table ${table}`);
      },
      storage: {
        from() {
          return {
            copy: async (from, to) => {
              calls.copies.push([from, to]);
              return { error: null };
            },
            getPublicUrl(path) {
              return { data: { publicUrl: `https://images.example/${path}` } };
            },
          };
        },
      },
    },
  };
}

function approvedImage(overrides = {}) {
  return {
    id: 'img_1',
    sku: 'AB12',
    slot: 1,
    targetTable: 'website_stock',
    destination: productManagerDestination({ sku: 'AB12', slot: 1 }),
    status: 'approved',
    source: { type: 'local_upload', filename: 'AB12.jpg' },
    outputStoragePath: 'staging/image-processing/outputs/ipc_1/img_1.png',
    ...overrides,
  };
}

describe('Image Processing Centre backend contracts', () => {
  it('normalizes a real local-folder upload without retaining base64 in the image manifest', () => {
    const result = normalizeCreateImage({
      sku: ' ab 12 ',
      imageSlot: 2,
      source: {
        type: 'local_upload',
        filename: 'product.png',
        contentType: 'image/png',
        base64: Buffer.from('small image fixture').toString('base64'),
      },
    });

    expect(result.ok).toBe(true);
    expect(result.image).toMatchObject({
      sku: 'AB12',
      slot: 2,
      targetTable: 'website_stock',
      destination: {
        system: 'product_manager',
        table: 'website_stock',
        sku: 'AB12',
        slot: 2,
        field: 'image_url_two',
        label: 'Gallery image 2',
      },
      source: { type: 'local_upload', filename: 'product.png' },
    });
    expect(result.uploadBytes).toBeGreaterThan(0);
    expect(result.image.source).not.toHaveProperty('base64');
    expect(result.base64).toBeTruthy();
  });

  it('accepts a Nutstore path but only allows a Product Manager website destination', () => {
    expect(normalizeCreateImage({
      sku: '86136',
      slot: 1,
      sourceType: 'nutstore',
      nutstorePath: '/PTR-photos/seed beads/86136.jpg',
    }).ok).toBe(true);

    expect(normalizeCreateImage({
      sku: '86136',
      sourceType: 'remote_url',
      sourceUrl: 'https://example.com/x.jpg',
      targetTable: 'customers',
    }).errors).toEqual(expect.arrayContaining([
      'source type is not supported',
      'target table is not supported',
    ]));
    expect(normalizeCreateImage({
      sku: '86136',
      sourceType: 'nutstore',
      nutstorePath: '/PTR-photos/86136.jpg',
      targetTable: 'archived_products',
    }).errors).toContain('target table is not supported');
  });

  it('names the exact Product Manager SKU, database field, and customer-facing position', () => {
    expect(PRODUCT_MANAGER_TABLE).toBe('website_stock');
    expect(productManagerDestination({ sku: ' ab 12 ', slot: 1 })).toEqual({
      system: 'product_manager',
      table: 'website_stock',
      sku: 'AB12',
      slot: 1,
      field: 'image_url_one',
      label: 'Main product image',
    });
    expect(productManagerDestination({ sku: 'AB12', slot: 5 }).field).toBeNull();
  });

  it('creates deterministic item and job identities for idempotent retries', () => {
    const first = normalizeCreateImage({
      sku: 'ABC1',
      source: { type: 'local_upload', filename: 'one.jpg', contentType: 'image/jpeg', base64: 'aGVsbG8=' },
    }).image;
    const second = normalizeCreateImage({
      sku: 'ABC1',
      source: { type: 'local_upload', filename: 'one.jpg', contentType: 'image/jpeg', base64: 'aGVsbG8=' },
    }).image;
    const fingerprint = jobFingerprint([first]);

    expect(first.id).toBe(second.id);
    expect(stableJobId('folder-2026-08-06', fingerprint)).toBe(stableJobId('folder-2026-08-06', fingerprint));
    expect(stableJobId('different-request', fingerprint)).not.toBe(stableJobId('folder-2026-08-06', fingerprint));
  });

  it('derives queue, review, failure and closed states with cost totals', () => {
    expect(deriveJobStatus([{ status: 'queued' }, { status: 'queued' }])).toBe('queued');
    expect(deriveJobStatus([{ status: 'approved' }, { status: 'review' }])).toBe('review');
    expect(deriveJobStatus([{ status: 'approved' }, { status: 'failed' }])).toBe('partially_failed');
    expect(deriveJobStatus([{ status: 'approved' }, { status: 'rejected' }])).toBe('closed');
    expect(deriveJobStatus([{ status: 'restored' }, { status: 'published' }])).toBe('complete');
    expect(summarizeJob([
      { status: 'approved', cost: { usd: 0.55, zar: 10.1 } },
      { status: 'rejected', cost: { usd: 0.04, zar: 0.75 } },
    ])).toMatchObject({ total: 2, approved: 1, rejected: 1, costUsd: 0.59, costZar: 10.85 });
  });

  it('estimates the fal.ai BRIA per-image charge', () => {
    expect(estimatedImageCostUsd({ sku: 'ABC1', slot: 1 })).toBe(0.018);
  });

  it('maps only the four allowlisted product image columns', () => {
    expect([1, 2, 3, 4].map(imageFieldForSlot)).toEqual([
      'image_url_one',
      'image_url_two',
      'image_url_three',
      'image_url_four',
    ]);
    expect(imageFieldForSlot(5)).toBeNull();
  });

  it('scores clean 800px white-background output higher than noisy clipped output', () => {
    const clean = qualityScoreFromMetrics({
      width: 800,
      height: 800,
      whiteBorderRatio: 0.99,
      borderNoise: 0.01,
      clippedEdgeRatio: 0,
    });
    const noisy = qualityScoreFromMetrics({
      width: 400,
      height: 500,
      whiteBorderRatio: 0.2,
      borderNoise: 0.7,
      clippedEdgeRatio: 0.3,
    });
    expect(clean.score).toBeGreaterThan(90);
    expect(noisy.score).toBeLessThan(60);
  });

  it('treats transparent canvas edges as a clean unclipped background', async () => {
    const png = new Jimp({ width: 800, height: 800, color: 0x00000000 });
    for (let y = 200; y < 600; y += 1) {
      for (let x = 250; x < 550; x += 1) png.setPixelColor(0x204060ff, x, y);
    }
    const quality = await analyzeImageQuality(await png.getBuffer('image/png'));

    expect(quality.whiteBorderRatio).toBe(1);
    expect(quality.borderNoise).toBe(0);
    expect(quality.clippedEdgeRatio).toBe(0);
  });

  it('keeps flat Vercel routes and separates owner and worker authentication', () => {
    const ownerRoute = readFileSync(join(ROOT, 'api/image-processing-jobs.js'), 'utf8');
    const workerRoute = readFileSync(join(ROOT, 'api/image-processing-worker.js'), 'utf8');
    expect(ownerRoute).toContain('requireOwner(req, res)');
    expect(ownerRoute).toContain('req.query?.id');
    expect(workerRoute).toContain('requireImageProcessor(req, res)');
    expect(workerRoute).not.toContain('requireOwner(req, res)');
  });

  it('parses real multipart folder uploads into bounded base64 ingestion items', async () => {
    const boundary = 'proto-image-boundary-AaB03x';
    const binary = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x42]);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="source"\r\n\r\nupload\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="images"; filename="supplier/ABC1.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      binary,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const req = Readable.from([body]);
    req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };

    const parsed = await parseImageProcessingRequest(req);
    expect(parsed.source).toBe('upload');
    expect(parsed.items).toEqual([{
      filename: 'supplier/ABC1.jpg',
      contentType: 'image/jpeg',
      base64: binary.toString('base64'),
    }]);
  });

  it('records approval without publishing or changing the review URL', () => {
    const reviewed = { id: 'img_1', status: 'review', reviewUrl: '/staging/result.jpg' };
    expect(markImageApproved(reviewed, { actor: 'owner@proto.co.za' })).toMatchObject({
      status: 'approved',
      reviewUrl: '/staging/result.jpg',
      approvedBy: 'owner@proto.co.za',
    });
    expect(markImageApproved(reviewed, { actor: 'owner@proto.co.za' })).not.toHaveProperty('publishedUrl');
  });

  it('sends only to one exact Product Manager SKU and retains the original URL for restore', async () => {
    const { client, calls } = productManagerStock({
      productRows: [{ sku: 'AB12', title: 'Black Jar', image_url_one: 'https://old.example/jar.jpg' }],
      updateRows: [{ sku: 'AB12' }],
    });
    const image = approvedImage();
    const published = await publishApprovedImage({ id: 'ipc_1', images: [image] }, image, {
      actor: 'owner@proto.co.za',
      allowOverwrite: true,
      stockClient: client,
    });

    expect(published).toMatchObject({
      status: 'published',
      destination: productManagerDestination({ sku: 'AB12', slot: 1 }),
      publication: {
        sku: 'AB12',
        table: 'website_stock',
        field: 'image_url_one',
        originalUrl: 'https://old.example/jar.jpg',
      },
    });
    expect(calls.copies).toEqual([[
      'staging/image-processing/outputs/ipc_1/img_1.png',
      expect.stringMatching(/^AB12\/1-/),
    ]]);
    expect(calls.updates).toHaveLength(1);
    expect(calls.filters).toContainEqual(['update.eq', 'image_url_one', 'https://old.example/jar.jpg']);
  });

  it('does not send a result when there is no exact Product Manager SKU', async () => {
    const { client, calls } = productManagerStock({ productRows: [] });
    const image = approvedImage();

    await expect(publishApprovedImage({ id: 'ipc_1', images: [image] }, image, {
      actor: 'owner@proto.co.za',
      stockClient: client,
    })).rejects.toMatchObject({ code: 'ipc_product_not_found' });
    expect(calls.copies).toEqual([]);
    expect(calls.updates).toEqual([]);
  });

  it('blocks duplicate targets in the same batch before an image can replace the wrong position', async () => {
    const { client, calls } = productManagerStock({
      productRows: [{ sku: 'AB12', title: 'Black Jar', image_url_two: null }],
    });
    const image = approvedImage({ slot: 2, destination: productManagerDestination({ sku: 'AB12', slot: 2 }) });
    const conflicting = approvedImage({ id: 'img_2', slot: 2, status: 'queued' });

    await expect(publishApprovedImage({ id: 'ipc_1', images: [image, conflicting] }, image, {
      actor: 'owner@proto.co.za',
      stockClient: client,
    })).rejects.toMatchObject({ code: 'ipc_job_destination_conflict' });
    expect(calls.copies).toEqual([]);
    expect(calls.updates).toEqual([]);
  });

  it('refuses to restore when Product Manager has a newer image in that position', async () => {
    const { client, calls } = productManagerStock({
      productRows: [{ sku: 'AB12', title: 'Black Jar', image_url_one: 'https://newer.example/jar.jpg' }],
    });
    const image = approvedImage({
      status: 'published',
      publishedUrl: 'https://images.example/AB12/1-processed.png',
      publication: {
        ...productManagerDestination({ sku: 'AB12', slot: 1 }),
        originalUrl: 'https://old.example/jar.jpg',
        liveUrl: 'https://images.example/AB12/1-processed.png',
      },
    });

    await expect(restorePublishedOriginal({ id: 'ipc_1' }, image, {
      actor: 'owner@proto.co.za',
      stockClient: client,
    })).rejects.toMatchObject({ code: 'ipc_restore_conflict' });
    expect(calls.updates).toEqual([]);
  });

  it('contains the catalogue update only in the explicit approval service', () => {
    const route = readFileSync(join(ROOT, 'api/image-processing-jobs.js'), 'utf8');
    const worker = readFileSync(join(ROOT, 'api/image-processing-worker.js'), 'utf8');
    const service = readFileSync(join(ROOT, 'api/_image-processing-service.js'), 'utf8');
    expect(route).not.toMatch(/from\([^)]*website_stock[^)]*\)\.update/);
    expect(worker).not.toMatch(/\.from\([^)]*(website_stock|archived_products)[^)]*\)/);
    expect(service).toContain('export async function publishApprovedImage');
    expect(service).toContain("if (image.status !== 'approved')");
    expect(service).toContain("if (image.status !== 'review')");
    expect(service).toContain('productManagerDestination');
    expect(service).toContain('ipc_product_not_found');
    expect(service).toContain('ipc_product_image_conflict');
    expect(service).toContain('ipc_restore_conflict');
    expect(service).toContain('originalUrl: previousUrl');
    expect(service).toContain('conditionalImageUpdate');
    expect(service).toContain("endsWith('.png') ? 'png' : 'jpg'");
    expect(service).toContain('export async function restorePublishedOriginal');
    expect(route).toContain("action === 'process'");
    expect(route).toContain('target_field: destination.field');
    expect(route).toContain('destination,');
    expect(route).toContain("'clear'");
    expect(service).toContain('export async function clearUnpublishedImage');
    expect(service).toContain("if (image.publishedUrl || image.publishedAt || image.approvedAt)");
    expect(route).not.toContain("action === 'process_next'");
  });
});
