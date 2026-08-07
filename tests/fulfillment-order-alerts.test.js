import fs from 'node:fs';
import { test } from 'vitest';
import assert from 'node:assert/strict';

// New-order alert (email-only). WhatsApp/WATI order notifications were removed
// entirely — the alert email IS the notification, so it must reach the whole
// team and must never be blocked by the PDF. (PT_00099 — 160 lines — reached
// nobody under the old rules.)

const notifySource = fs.readFileSync(new URL('../api/_order-notify-core.js', import.meta.url), 'utf8');
const brevoSource = fs.readFileSync(new URL('../api/_brevo-email.js', import.meta.url), 'utf8');

test('the new-order alert reaches the whole team, and config can only add', async () => {
  const { resolveOrderAlertRecipients } = await import('../api/_order-alert-recipients.js');
  const required = ['george@proto.co.za', 'online@proto.co.za', 'danieljoffeinfo@gmail.com'];
  assert.deepEqual(resolveOrderAlertRecipients(''), required);
  const withExtra = resolveOrderAlertRecipients('someone-else@example.com');
  for (const email of required) assert.ok(withExtra.includes(email), `${email} cannot be dropped`);
  assert.ok(withExtra.includes('someone-else@example.com'), 'configured extra is added');
  assert.deepEqual(resolveOrderAlertRecipients('GEORGE@Proto.co.za'), required);
});

test('Brevo transactional sends accept a list of recipients', () => {
  assert.match(brevoSource, /Array\.isArray\(to\) \? to : \[to\]/);
});

test('a missing or oversized PDF never cancels the alert', () => {
  assert.match(notifySource, /MAX_ALERT_ATTACHMENT_BYTES/, 'oversized PDFs are detected');
  assert.match(notifySource, /attachment: pdf \?/, 'the attachment is conditional');
  assert.match(notifySource, /pdfProblem/, 'the email says why the PDF is absent');
  assert.doesNotMatch(notifySource, /^\s*const pdf = await loadStoredOrderPdf/m, 'the PDF load is guarded');
});

test('no WATI/WhatsApp sends remain in the order-notify path', () => {
  // The customer-facing alert path stays email-only. The one deliberate WATI
  // survivor is api/order-team-whatsapp.js, which broadcasts a new order to the
  // fulfilment team's own numbers (CLAUDE.md, "Exception — internal team
  // WhatsApp") and cannot reach a customer number.
  assert.doesNotMatch(notifySource, /watiSend|sendTemplateMessage|whatsappNumber/, 'no WATI calls');
  assert.ok(!fs.existsSync(new URL('../api/_wati.js', import.meta.url).pathname), '_wati.js deleted');
  assert.ok(!fs.existsSync(new URL('../api/team-whatsapp-test.js', import.meta.url).pathname), 'team WhatsApp test deleted');
  assert.match(notifySource, /email is the notification/i);
});

test('the internal team WhatsApp only ever reaches the fulfilment team', () => {
  const teamSource = fs.readFileSync(new URL('../api/order-team-whatsapp.js', import.meta.url), 'utf8');
  // Recipients come from the team roster file, never from the order's customer.
  assert.match(teamSource, /fulfillment\/users\.json/, 'recipients come from the team roster');
  assert.doesNotMatch(teamSource, /customers\?\.\s*phone|customer\.phone/, 'never a customer number');
});
