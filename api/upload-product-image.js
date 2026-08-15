import { requireOwner } from './_admin-auth.js';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

const BUCKET = 'product-images';

function getStockAdminClient() {
  return createClient(
    process.env.VITE_STOCK_SUPABASE_URL,
    process.env.VITE_STOCK_SUPABASE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function handler(req, res) {
  if (!(await requireOwner(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();

  const { filename, contentType, base64, sku, imageSlot, requireNew = false } = req.body || {};
  if (!filename || !contentType || !base64) {
    return res.status(400).json({ error: 'filename, contentType, and base64 are required' });
  }

  const supabase = getStockAdminClient();

  const safeSku = String(sku || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (requireNew && safeSku) {
    const { data: existing, error: lookupError } = await supabase
      .from('website_stock')
      .select('sku')
      .eq('sku', safeSku)
      .maybeSingle();
    if (lookupError) return res.status(500).json({ error: lookupError.message });
    if (existing) {
      return res.status(409).json({
        error: 'This SKU already exists. Its images were not changed.',
        code: 'exists',
      });
    }
  }

  await supabase.storage.createBucket(BUCKET, { public: true }).catch(() => {});

  const buffer = Buffer.from(base64, 'base64');
  const slot = Math.min(4, Math.max(1, Number(imageSlot) || 1));
  const ext = String(filename).split('.').pop()?.toLowerCase() || 'jpg';
  const objectPath = safeSku
    ? `${safeSku}/${slot}.${ext.replace(/[^a-z0-9]/g, '')}`
    : `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, buffer, { contentType, upsert: Boolean(safeSku) && !requireNew });

  if (error) return res.status(400).json({ error: error.message });

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);

  return res.status(200).json({ url: publicUrl, path: objectPath });
}
