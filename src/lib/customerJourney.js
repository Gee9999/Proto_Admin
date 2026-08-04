export async function fetchCustomerJourneySummary(days = 30) {
  const response = await fetch(`/api/customer-journey-control?days=${days}`, { cache: 'no-store' });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Could not load customer journey information');
  return json;
}
