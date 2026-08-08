import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOriginalPreviewUrl, normalizePreviewProcessingRequest } from '../api/image-processing-preview.js';

const route = readFileSync(new URL('../api/image-processing-preview.js', import.meta.url), 'utf8');

describe('Image Processing Centre manual preview processor', () => {
  it('is explicitly preview-only and cannot write live product records', () => {
    expect(route).toContain("String(env.VERCEL_ENV || '').toLowerCase() !== 'production'");
    expect(route).toContain("staging: true");
    expect(route).toContain("previewOnly: true");
    expect(route).not.toContain(".from('website_stock')");
    expect(route).not.toContain('promoteStagingUrlToLive');
  });

  it('preserves labels and returns both sides of the review', () => {
    expect(route).toContain('Do not remove, obscure, alter, invent, or reinterpret any printed product label');
    expect(route).toContain('originalUrl: input.sourceImageUrl');
    expect(route).toContain('processedUrl: result.url');
    expect(route).toContain("status: 'review'");
  });

  it('keeps a direct upload visible as the original during review', () => {
    const input = normalizePreviewProcessingRequest({
      sourceBase64: 'aGVsbG8=', sourceContentType: 'image/png', sku: 'TEST-001',
    });
    expect(buildOriginalPreviewUrl(input)).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('rejects unsupported or malformed direct-upload image data before processing', () => {
    expect(() => normalizePreviewProcessingRequest({ sourceBase64: 'not valid!', sourceContentType: 'text/plain', sku: 'TEST-001' })).toThrow('supported image type');
    expect(() => normalizePreviewProcessingRequest({ sourceBase64: 'not valid!', sourceContentType: 'image/png', sku: 'TEST-001' })).toThrow('valid image');
  });
});
