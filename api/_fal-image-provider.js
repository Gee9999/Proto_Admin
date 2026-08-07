import { fal } from '@fal-ai/client';
import { Jimp, HorizontalAlign, VerticalAlign, cssColorToHex } from 'jimp';

export const FAL_BACKGROUND_MODEL = 'fal-ai/bria/background/remove';
export const FAL_BACKGROUND_COST_USD = 0.018;
export const FAL_USD_TO_ZAR = 18;
const MAX_FAL_OUTPUT_BYTES = 24 * 1024 * 1024;

function falKey() {
  const key = String(process.env.FAL_KEY || '').trim();
  if (!key) throw new Error('FAL_KEY is not configured for this preview environment');
  return key;
}

export function validateFalOutputUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error('fal.ai returned an invalid output URL');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !(hostname === 'fal.media' || hostname.endsWith('.fal.media'))) {
    throw new Error('fal.ai returned an unexpected output host');
  }
  return parsed.toString();
}

export async function removeBackgroundWithFal(imageUrl, { client = fal, credentials } = {}) {
  const key = credentials || (client === fal ? falKey() : 'mock-client');
  if (typeof client.config === 'function') client.config({ credentials: key });
  const result = await client.subscribe(FAL_BACKGROUND_MODEL, {
    input: { image_url: imageUrl },
    logs: false,
    mode: 'polling',
    startTimeout: 90,
  });
  const outputUrl = result?.data?.image?.url || result?.image?.url;
  return {
    outputUrl: validateFalOutputUrl(outputUrl),
    requestId: result?.requestId || result?.request_id || null,
  };
}

export async function downloadFalOutput(outputUrl, { fetchImpl = fetch } = {}) {
  const url = validateFalOutputUrl(outputUrl);
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Could not download fal.ai output (HTTP ${response.status})`);
  const declaredLength = Number(response.headers.get('content-length')) || 0;
  if (declaredLength > MAX_FAL_OUTPUT_BYTES) throw new Error('fal.ai output exceeds the 24 MB safety limit');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('fal.ai returned an empty image');
  if (buffer.length > MAX_FAL_OUTPUT_BYTES) throw new Error('fal.ai output exceeds the 24 MB safety limit');
  return buffer;
}

function alphaBounds(image, threshold = 16) {
  const { width, height, data } = image.bitmap;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[((y * width) + x) * 4 + 3] < threshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('fal.ai output did not contain a visible product');
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function hasDetachedForeground(image, threshold = 48) {
  const sample = image.clone();
  sample.contain({
    w: 192,
    h: 192,
    align: HorizontalAlign.CENTER | VerticalAlign.MIDDLE,
    background: cssColorToHex('#00000000'),
  });
  const { width, height, data } = sample.bitmap;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components = [];

  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || data[(start * 4) + 3] < threshold) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const current = queue[head++];
      area += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      const neighbours = [
        x > 0 ? current - 1 : -1,
        x + 1 < width ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y + 1 < height ? current + width : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || visited[next] || data[(next * 4) + 3] < threshold) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    if (area >= 8) components.push(area);
  }

  components.sort((a, b) => b - a);
  return components.length > 1 && components[1] >= Math.max(12, components[0] * 0.0025);
}

export async function standardizeFalOutput(buffer, { size = 1600, paddingRatio = 0.08 } = {}) {
  const image = await Jimp.read(buffer);
  const detachedForeground = hasDetachedForeground(image);
  const bounds = alphaBounds(image);
  image.crop(bounds);

  const padding = Math.max(40, Math.round(size * Math.max(0.04, Math.min(0.2, paddingRatio))));
  const innerSize = size - (padding * 2);
  image.contain({
    w: innerSize,
    h: innerSize,
    align: HorizontalAlign.CENTER | VerticalAlign.MIDDLE,
    background: cssColorToHex('#00000000'),
  });
  const canvas = new Jimp({ width: size, height: size, color: cssColorToHex('#00000000') });
  canvas.composite(image, padding, padding);
  const transparentMasterBuffer = await canvas.getBuffer('image/png');
  // Keep the cleaned cut-out as the master.  The website derivative is a
  // separate, deliberately opaque asset so the catalogue has a consistent
  // white canvas without throwing away the transparent version.
  const websiteCanvas = new Jimp({ width: size, height: size, color: cssColorToHex('#FFFFFFFF') });
  websiteCanvas.composite(canvas, 0, 0);
  const websiteReadyBuffer = await websiteCanvas.getBuffer('image/jpeg');
  return {
    // `buffer` remains for older callers; it is always the transparent master.
    buffer: transparentMasterBuffer,
    transparentMasterBuffer,
    transparentMaster: { width: size, height: size, format: 'image/png', background: 'transparent' },
    websiteReadyBuffer,
    websiteReady: { width: size, height: size, format: 'image/jpeg', background: '#FFFFFF' },
    warnings: detachedForeground
      ? ['possible_detached_label_or_barcode', 'manual_label_barcode_review_required']
      : [],
  };
}
