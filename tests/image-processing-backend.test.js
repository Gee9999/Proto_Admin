import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseImageProcessingRequest } from '../api/_image-processing-request.js';
import { estimatedImageCostUsd, markImageApproved } from '../api/_image-processing-service.js';
import {
  deriveJobStatus,
  imageFieldForSlot,
  jobFingerprint,
  normalizeCreateImage,
  qualityScoreFromMetrics,
  stableJobId,
  summarizeJob,
} from '../lib/image-processing-centre.mjs';

const ROOT = join(import.meta.dirname, '..');

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
      source: { type: 'local_upload', filename: 'product.png' },
    });
    expect(result.uploadBytes).toBeGreaterThan(0);
    expect(result.image.source).not.toHaveProperty('base64');
    expect(result.base64).toBeTruthy();
  });

  it('accepts a Nutstore path and rejects unsupported sources and tables', () => {
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

  it('uses the self-hosted processor without a per-image API charge', () => {
    expect(estimatedImageCostUsd({ sku: 'ABC1', slot: 1 })).toBe(0);
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

  it('contains the catalogue update only in the explicit approval service', () => {
    const route = readFileSync(join(ROOT, 'api/image-processing-jobs.js'), 'utf8');
    const worker = readFileSync(join(ROOT, 'api/image-processing-worker.js'), 'utf8');
    const service = readFileSync(join(ROOT, 'api/_image-processing-service.js'), 'utf8');
    expect(route).not.toMatch(/from\([^)]*website_stock[^)]*\)\.update/);
    expect(worker).not.toMatch(/\.from\([^)]*(website_stock|archived_products)[^)]*\)/);
    expect(service).toContain('export async function publishApprovedImage');
    expect(service).toContain("if (image.status !== 'approved')");
    expect(service).toContain("if (image.status !== 'review')");
    expect(service).toContain('.update({ [field]: liveUrl');
    expect(service).toContain('export async function restorePublishedOriginal');
    expect(route).not.toContain("action === 'process_next'");
  });
});
