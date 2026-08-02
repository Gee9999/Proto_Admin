export function cataloguePublishEligibility(item = {}) {
  const reasons = [];
  const price = Number(item.erpPrice ?? item.price);
  const available = Number(item.erpAvailable ?? item.availableStock ?? item.stockOnHand ?? item.stockQty);
  const images = item.images || [item.image, item.secondaryImage, item.imageThree, item.imageFour];

  if (item.stockLinked === false || item.erpLinked === false) reasons.push('No verified ERP link');
  if (!Number.isFinite(price) || price <= 0) reasons.push('Price must be greater than zero');
  if (!Number.isFinite(available) || available <= 0) reasons.push('ERP available stock must be greater than zero');
  if (!String(item.name || item.title || '').trim()) reasons.push('Product title is required');
  if (!String(item.category || item.categoryId || item.categoryPath?.[0] || '').trim()) reasons.push('Category is required');
  if (!(images || []).some((value) => String(value || '').trim())) reasons.push('At least one image is required');
  if (item.duplicateLiveSku) reasons.push(`Barcode already live as ${item.duplicateLiveSku}`);

  return { eligible: reasons.length === 0, reasons };
}
