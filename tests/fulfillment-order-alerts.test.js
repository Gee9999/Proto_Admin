import fs from 'node:fs';
import { test } from 'vitest';
import assert from 'node:assert/strict';

const usersApiSource = fs.readFileSync(new URL('../api/fulfillment-users.js', import.meta.url), 'utf8');
const testApiSource = fs.readFileSync(new URL('../api/team-whatsapp-test.js', import.meta.url), 'utf8');
const modalSource = fs.readFileSync(new URL('../src/components/FulfillmentSettingsModal.jsx', import.meta.url), 'utf8');

test('fulfilment users default to active order alerts unless explicitly disabled', () => {
  assert.match(usersApiSource, /orderAlerts:\s*u\.orderAlerts !== false/);
  assert.match(modalSource, /orderAlerts:\s*u\.orderAlerts !== false/);
});

test('the team settings UI saves an explicit order-alert switch', () => {
  assert.match(modalSource, /Order alerts active/);
  assert.match(modalSource, /updateUser\(idx,\s*\{\s*orderAlerts:\s*e\.target\.checked\s*\}\)/);
  assert.match(modalSource, /u\.orderAlerts && !isValidWatiPhone/);
});

test('WhatsApp tests skip team members whose order alerts are disabled', () => {
  assert.match(testApiSource, /\.filter\(\(u\) => u\?\.orderAlerts !== false\)/);
});

// ── New-order alert hardening ────────────────────────────────────────────────
// PT_00099 (160 lines, R67 451.50) reached nobody. Two causes, both fixed here:
// the alert went to ONE address, so the cron sweep and the manual resend could
// only ever recover that one; and the stored PDF was awaited unguarded, so a
// missing or oversized file threw and killed the whole alert.

const notifySource = fs.readFileSync(new URL('../api/_order-notify-core.js', import.meta.url), 'utf8');
const brevoSource = fs.readFileSync(new URL('../api/_brevo-email.js', import.meta.url), 'utf8');

test('the new-order alert reaches the whole team, and config can only add', async () => {
  const { resolveOrderAlertRecipients } = await import('../api/_order-alert-recipients.js');
  const required = ['george@proto.co.za', 'online@proto.co.za', 'danieljoffeinfo@gmail.com'];
  assert.deepEqual(resolveOrderAlertRecipients(''), required);
  const withExtra = resolveOrderAlertRecipients('someone-else@example.com');
  for (const email of required) assert.ok(withExtra.includes(email), `${email} cannot be dropped`);
  assert.ok(withExtra.includes('someone-else@example.com'), 'configured extra is added');
  // Case-folded so an env value cannot duplicate a required address.
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
