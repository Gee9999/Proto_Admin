const EMPTY_TAB_COUNTS = Object.freeze({
  all: 0,
  new: 0,
  handed: 0,
  progress: 0,
  sent: 0,
  paid: 0,
  unpaid: 0,
});

export function normalizeOrderTabCounts(row) {
  if (!row) return { ...EMPTY_TAB_COUNTS };
  return {
    all: Number(row.all_count || 0),
    new: Number(row.new_count || 0),
    handed: Number(row.handed_count || 0),
    progress: Number(row.progress_count || 0),
    sent: Number(row.sent_count || 0),
    paid: Number(row.paid_count || 0),
    unpaid: Number(row.unpaid_count || 0),
  };
}

export function countOrderTabs(orders, { isConfirmationSent } = {}) {
  const counts = { ...EMPTY_TAB_COUNTS };
  for (const order of orders || []) {
    const status = String(order?.status || '').trim().toLowerCase();
    const confirmationSent = isConfirmationSent
      ? isConfirmationSent(order)
      : Boolean(order?.confirmation_sent_at);

    counts.all += 1;
    if (status === 'pending') counts.new += 1;
    if (status === 'handed over') counts.handed += 1;
    if (status === 'order in progress') counts.progress += 1;
    if (status === 'order sent' && !confirmationSent) counts.sent += 1;
    if (status === 'payment received' || (status === 'order sent' && confirmationSent)) {
      counts.paid += 1;
    }
    if (status !== 'payment received' && status !== 'paid') counts.unpaid += 1;
  }
  return counts;
}
