export const HOLD_PREVIEW_ID = 'preview-hold-application';

const previewApplication = Object.freeze({
  id: HOLD_PREVIEW_ID,
  name: 'Preview Customer',
  business_name: 'Cape Hold Test Traders',
  business_type: 'Retailer',
  email: 'preview-hold@example.com',
  phone: '021 000 0000',
  city: 'Cape Town',
  province: 'Western Cape',
  country: 'South Africa',
  accept_whatsapp: true,
  created_at: '2026-08-12T08:00:00.000Z',
  is_approved: false,
  __previewOnly: true,
});

export function holdPreviewEnabled(search = '') {
  return new URLSearchParams(search).get('previewHoldApplication') === '1';
}

export function addHoldPreview(rows, { enabled, tab, status = 'pending', reason = '' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const belongsHere = (tab === 'requests' && status === 'pending') || (tab === 'on-hold' && status === 'on_hold');
  if (!enabled || !belongsHere || list.some((row) => row.id === HOLD_PREVIEW_ID)) return list;
  return [{
    ...previewApplication,
    application_status: status,
    application_hold_reason: status === 'on_hold' ? reason || 'Waiting for supporting information.' : null,
  }, ...list];
}
