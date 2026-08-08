import { requireOwner } from './_admin-auth.js';
import { fixImageFromBuffer, fixImageFromUrl, IMAGE_STYLES } from './_image-pipeline.js';
import { downloadNutstoreFile, isPathInLibrary } from './_nutstore-webdav.js';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } }, maxDuration: 60 };

/**
 * This route intentionally has no path to website_stock, staging promotion, or
 * product publishing.  It creates a disposable, versioned staging result for
 * a human to compare against the untouched source image.
 */
export function isPreviewOnlyEnvironment(env = process.env) {
  return String(env.VERCEL_ENV || '').toLowerCase() !== 'production';
}

export function buildPreviewProcessingPrompt({ instructions = '', productTitle = '' } = {}) {
  const context = productTitle ? ` Product: ${productTitle}.` : '';
  const request = String(instructions || '').trim();
  return `Create a clean, catalogue-quality preview of this exact product.${context}
Use a pure white background, centre the product with even padding, and preserve its exact shape, colours, proportions, branding and packaging.
Do not remove, obscure, alter, invent, or reinterpret any printed product label, barcode, sticker, logo, text, or product marking. Do not remove objects from the product in this preview. Do not add text, watermarks, props, or extra products.
This is a review-only preview: the original image remains the source of truth and a person must approve any later publishing.${request ? ` Additional non-destructive direction: ${request}` : ''}`;
}

export function normalizePreviewProcessingRequest(body = {}) {
  const sourceImageUrl = String(body.sourceImageUrl || body.originalUrl || '').trim();
  const nutstorePath = String(body.nutstorePath || '').trim();
  const sku = String(body.sku || '').trim().toUpperCase();
  const targetSlot = Math.min(4, Math.max(1, Number(body.targetSlot) || 1));
  if (!sourceImageUrl && !nutstorePath) throw new Error('sourceImageUrl or nutstorePath is required');
  if (sourceImageUrl && !/^https?:\/\//i.test(sourceImageUrl)) throw new Error('sourceImageUrl must be an http(s) URL');
  if (nutstorePath && !isPathInLibrary(nutstorePath)) throw new Error('nutstorePath must be within PTR Photos');
  if (!sku) throw new Error('sku is required');
  return {
    sourceImageUrl,
    nutstorePath,
    sku,
    targetSlot,
    productTitle: String(body.productTitle || '').trim(),
    instructions: String(body.instructions || '').trim(),
  };
}

export default async function handler(req, res) {
  if (!(await requireOwner(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (!isPreviewOnlyEnvironment()) {
    return res.status(403).json({ error: 'Image Processing Centre preview processing is disabled in production.' });
  }

  try {
    const input = normalizePreviewProcessingRequest(req.body || {});
    const prompt = buildPreviewProcessingPrompt(input);
    const result = input.nutstorePath
      ? await (async () => {
        const source = await downloadNutstoreFile(input.nutstorePath);
        return fixImageFromBuffer(source.buffer, source.contentType, input.nutstorePath.split('/').pop() || `${input.sku}.jpg`, {
          sku: input.sku, targetSlot: input.targetSlot, imageStyle: IMAGE_STYLES.standard, prompt, staging: true,
        });
      })()
      : await fixImageFromUrl(input.sourceImageUrl, {
        sku: input.sku, targetSlot: input.targetSlot, imageStyle: IMAGE_STYLES.standard, prompt, staging: true,
      });

    // `staging: true` creates a unique, dated storage object per run.  Nothing
    // in this route writes product records, changes source files, or promotes
    // the generated result to a live SKU slot.
    return res.status(200).json({
      ok: true,
      status: 'review',
      previewOnly: true,
      originalUrl: input.sourceImageUrl || `/api/nutstore-thumbnail?path=${encodeURIComponent(input.nutstorePath)}`,
      processedUrl: result.url,
      version: result.storagePath || result.url,
      targetSlot: input.targetSlot,
      model: result.model,
      message: 'Preview result is ready for before-and-after review. Publishing is disabled.',
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Preview image processing failed' });
  }
}
