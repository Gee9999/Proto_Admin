export const TRADE_REQUEST_PREVIEW_ID = 'preview-trade-request';

export const tradeRequestPreviewCustomer = Object.freeze({
  id: TRADE_REQUEST_PREVIEW_ID,
  name: 'Preview Customer',
  contact_name: 'Preview Customer',
  business_name: 'Cape Test Traders',
  business_type: 'Retailer',
  email: 'preview@example.com',
  phone: '021 000 0000',
  city: 'Cape Town',
  province: 'Western Cape',
  country: 'South Africa',
  accept_whatsapp: true,
  created_at: '2026-08-12T08:00:00.000Z',
  is_approved: false,
  __previewOnly: true,
});

export function tradeRequestPreviewEnabled(search = '') {
  return new URLSearchParams(search).get('previewTradeRequest') === '1';
}

export function addTradeRequestPreview(rows, { enabled, approved = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!enabled || approved || list.some((row) => row.id === TRADE_REQUEST_PREVIEW_ID)) return list;
  return [tradeRequestPreviewCustomer, ...list];
}
