export function isOrderTrashEnabled(env = globalThis.process?.env || {}) {
  return String(env.ORDER_TRASH_ENABLED || '').trim().toLowerCase() === 'true';
}

export function normalizeOrderTrashReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 8) throw new Error('Provide a deletion reason of at least 8 characters.');
  if (reason.length > 500) throw new Error('Deletion reason must be 500 characters or fewer.');
  return reason;
}
