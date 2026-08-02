function has(value) {
  return String(value || '').trim().length > 0;
}

export function traderVerificationSummary(customer = {}) {
  const evidence = [];
  let score = 0;

  const historicalSales = Number(customer.sales_last_12_months || 0);
  const invoices = Number(customer.invoice_count || 0);
  if (historicalSales > 0 || invoices > 0) {
    score += 50;
    evidence.push({ tone: 'strong', label: 'Proto history found', detail: `${invoices || 'Previous'} invoices${historicalSales ? ` · R${historicalSales.toLocaleString('en-ZA')} in 12-month sales` : ''}` });
  } else {
    evidence.push({ tone: 'neutral', label: 'Proto history not linked', detail: 'Check the old customer code, email or phone in SQL.' });
  }

  if (has(customer.business_type)) {
    score += 14;
    evidence.push({ tone: 'positive', label: 'Business category supplied', detail: customer.business_type });
  }
  if (has(customer.website)) {
    score += 12;
    evidence.push({ tone: 'positive', label: 'Public business lead supplied', detail: customer.website });
  } else {
    evidence.push({ tone: 'neutral', label: 'No public business link', detail: 'This is not a reason to decline an informal trader.' });
  }
  if (has(customer.vat_number)) {
    score += 8;
    evidence.push({ tone: 'positive', label: 'VAT number supplied', detail: customer.vat_number });
  }
  if (has(customer.company_address) && has(customer.delivery_address)) score += 8;
  if (has(customer.phone) && has(customer.email)) score += 8;

  const confidence = Math.min(score, 100);
  const recommendation = confidence >= 70
    ? 'Strong trader evidence'
    : confidence >= 40
      ? 'Some trader evidence'
      : 'More information needed';

  return {
    confidence,
    recommendation,
    tone: confidence >= 70 ? 'strong' : confidence >= 40 ? 'review' : 'weak',
    evidence,
  };
}

export function businessSearchUrl(customer = {}) {
  const query = [customer.business_name || customer.name, customer.city, customer.province, 'South Africa business']
    .filter(has)
    .join(' ');
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
