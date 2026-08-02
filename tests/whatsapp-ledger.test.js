import fs from 'node:fs';
import { test } from 'vitest';
import assert from 'node:assert/strict';

/**
 * WhatsApp was reinstated deliberately (migration 060) after PR #179 removed the
 * original build. These tests pin the rules that make the rebuild different from
 * what was removed — if one of them fails, the feature has drifted back toward
 * the design that was deleted.
 */

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const migration = read('../migrations/060_whatsapp_messaging.sql');
const watiClient = read('../api/_wati-client.js');
const webhook = read('../api/wa-webhook.js');
const broadcast = read('../api/wa-broadcast.js');
const thread = read('../api/wa-thread.js');
const panel = read('../src/components/WhatsappPanel.jsx');

test('send results are parsed on WATI markers, not on HTTP 200', async () => {
  const { parseSendResult } = await import('../api/_wati-client.js');

  // HTTP 200 with an explicit rejection is a FAILURE. The whole point of this
  // helper: WATI answers 200 while refusing the message.
  const rejected = parseSendResult({
    ok: true, status: 200, json: { result: false, info: 'Not a valid WhatsApp number' },
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.error, 'Not a valid WhatsApp number');

  const invalidNumber = parseSendResult({ ok: true, status: 200, json: { validWhatsAppNumber: false } });
  assert.equal(invalidNumber.success, false);

  const optedOut = parseSendResult({ ok: true, status: 200, json: { info: 'Contact has opted out' } });
  assert.equal(optedOut.success, false);

  const sent = parseSendResult({ ok: true, status: 200, json: { result: true, messageId: 'wamid.1' } });
  assert.equal(sent.success, true);
  assert.equal(sent.messageId, 'wamid.1');

  // 200 with no markers at all: optimistic, but flagged, and delivery is still
  // decided by the webhook rather than this response.
  const ambiguous = parseSendResult({ ok: true, status: 200, json: {} });
  assert.equal(ambiguous.success, true);
  assert.equal(ambiguous.ambiguous, true);

  const httpError = parseSendResult({ ok: false, status: 500, json: {} });
  assert.equal(httpError.success, false);
});

test('template parameters are sanitised to what WhatsApp accepts', async () => {
  const { sanitizeTemplateParam } = await import('../api/_wati-client.js');
  // Newlines, tabs and 4+ spaces are rejected by WhatsApp inside a parameter.
  assert.equal(sanitizeTemplateParam('a\nb\tc'), 'a b c');
  assert.equal(sanitizeTemplateParam('a     b'), 'a   b');
  assert.ok(!/[\r\n\t]/.test(sanitizeTemplateParam('line1\r\nline2')));
  assert.equal(sanitizeTemplateParam('x'.repeat(50), 10).length, 10);
});

test('the 24h session window governs whether a free-form reply is legal', async () => {
  const { sessionOpen, sessionMsRemaining } = await import('../api/_whatsapp-db.js');
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const past = new Date(Date.now() - 1_000).toISOString();

  assert.equal(sessionOpen({ session_expires_at: future }), true);
  assert.equal(sessionOpen({ session_expires_at: past }), false);
  assert.equal(sessionOpen({ session_expires_at: null }), false);
  assert.equal(sessionOpen(null), false);
  assert.equal(sessionMsRemaining({ session_expires_at: past }), 0);
  assert.ok(sessionMsRemaining({ session_expires_at: future }) > 0);

  // Enforced server-side, not merely hinted at in the UI.
  assert.ok(thread.includes("error: 'session_closed'"), 'wa-thread rejects out-of-window free-form replies');
  assert.ok(thread.includes('status(409)'), 'and does so with a distinguishable status');
});

test('the webhook secret is compared in constant time, header-first, and fails closed', () => {
  assert.ok(webhook.includes("headers['x-webhook-secret']"), 'secret read from a header');
  assert.ok(webhook.includes('timingSafeEqual'), 'constant-time compare');
  // WATI's webhook UI exposes no custom-header field, so a query fallback is
  // permitted — but the header must be read FIRST, and the compare must still
  // be constant time. (Security review M2 objected to the plain !== compare as
  // much as to the query string; that part is non-negotiable.)
  const headerIdx = webhook.indexOf("headers['x-webhook-secret']");
  const queryIdx = webhook.indexOf('req.query?.secret');
  if (queryIdx !== -1) {
    assert.ok(headerIdx < queryIdx, 'header must take precedence over the query fallback');
    assert.ok(!/!==\s*expected|expected\s*!==/.test(webhook), 'never a plain !== compare');
  }
  assert.ok(
    webhook.includes('WA_WEBHOOK_SECRET is not configured'),
    'unset secret must fail closed, not accept unauthenticated writes to the ledger',
  );
  // Raw payload is stored before parsing so a wrong shape guess is recoverable.
  assert.ok(
    webhook.indexOf('storeWebhookEvent') < webhook.indexOf('statusForEvent(name)'),
    'the raw event must be persisted before any parsing decision',
  );
});

test('broadcasts queue rather than sending inside the request', () => {
  assert.ok(
    !/sendTemplate\s*\(/.test(broadcast),
    'wa-broadcast must not send — the old build looped sends in-request and timed out mid-broadcast',
  );
  assert.ok(broadcast.includes("status: 'queued'"), 'recipients are enqueued');
  const worker = read('../api/wa-broadcast-worker.js');
  assert.ok(worker.includes("eq('status', 'queued')"), 'the worker claims rows before sending');
  assert.ok(worker.includes('CONCURRENCY'), 'and sends with bounded concurrency');
});

test('broadcast audience is the customer opt-in, resolved in one place', () => {
  // Composer preview and worker send list must come from the same SQL function
  // or the number shown can differ from who actually receives.
  assert.ok(migration.includes('wa_broadcast_audience'));
  assert.ok(migration.includes('c.accept_whatsapp'), 'gate is customers.accept_whatsapp');
  assert.ok(migration.includes('NOT c.is_team'), 'fulfilment team numbers excluded');
  assert.ok(migration.includes('c.allow_broadcast'), 'STOP / opted-out contacts excluded');
  assert.ok(broadcast.includes('resolveAudience'), 'POST resolves through it');
  assert.match(broadcast, /GET[\s\S]*resolveAudience/, 'preview resolves through it too');
});

test('WATI contact attributes are never used to store state', () => {
  // The removed build kept join status in custom params and re-derived
  // "last message" from getMessages on every render. Both are the thing this
  // rebuild replaces; a reappearance here is a regression, not a feature.
  for (const [name, source] of Object.entries({ watiClient, webhook, broadcast, thread, panel })) {
    assert.ok(!/customParams/.test(source), `${name} must not read or write WATI custom params`);
    assert.ok(!/attribute_2|join_status/.test(source), `${name} must not use WATI join-status attributes`);
  }
  assert.ok(!/getMessages/.test(panel), 'the panel must not scrape WATI message history');
  // The replacement: stored columns on our own contact row.
  assert.ok(migration.includes('last_outbound_template'));
  assert.ok(migration.includes('last_outbound_status'));
  assert.ok(migration.includes('last_inbound_at'));
});

test('the status ladder cannot run backwards and failure is terminal', () => {
  // Out-of-order webhooks are normal; a late "sent" must not demote a "read"
  // message, or delivery analytics silently under-report.
  assert.ok(migration.includes('wa_status_rank'));
  assert.ok(
    migration.includes('wa_status_rank(p_status) <= public.wa_status_rank(v_cur)'),
    'lower-or-equal rungs are ignored',
  );
  assert.ok(migration.includes("IF p_status <> 'failed' AND v_cur = 'failed' THEN RETURN v_id"),
    'failed is terminal');
  // Replays must not inflate broadcast counters either.
  assert.ok(migration.includes('NEW.status IS DISTINCT FROM OLD.status'),
    'counters move only on a genuine transition');
  assert.ok(migration.includes('whatsapp_messages_wa_id_key'), 'duplicate webhook inserts are rejected');
});

test('order notifications stay email-only', () => {
  // Reinstating WhatsApp messaging must not quietly reinstate WhatsApp order
  // alerts, which were removed for a separate reason.
  const notifyCore = read('../api/_order-notify-core.js');
  assert.ok(!/wa-broadcast|_wati-client|sendTemplate/.test(notifyCore));
});

test('WATI dashboard event names map to the right ladder rung', async () => {
  const { statusForEvent } = await import('../api/wa-webhook.js');

  // The six events actually configured in the WATI dashboard (2026-08-02).
  // sentMessageDELIVERED / sentMessageREAD are the ones an exact-match table
  // silently dropped — delivery and read rates stayed at 0 with no error.
  assert.equal(statusForEvent('sentMessageDELIVERED'), 'delivered');
  assert.equal(statusForEvent('sentMessageREAD'), 'read');
  assert.equal(statusForEvent('templateMessageSent'), 'sent');
  assert.equal(statusForEvent('sessionMessageSent'), 'sent');
  assert.equal(statusForEvent('templateMessageFAILED'), 'failed');

  // Doc-style aliases must keep working too.
  assert.equal(statusForEvent('deliveredMessage'), 'delivered');
  assert.equal(statusForEvent('readMessage'), 'read');
  assert.equal(statusForEvent('undeliveredMessage'), 'failed');

  // "sent" appears inside the delivered/read/failed names — precedence must
  // resolve to the MORE specific rung, or everything collapses to 'sent'.
  assert.notEqual(statusForEvent('sentMessageDELIVERED'), 'sent');
  assert.notEqual(statusForEvent('sentMessageREAD'), 'sent');

  // Inbound names must not resolve to a status at all.
  assert.equal(statusForEvent('unknownFutureEvent'), null);
  assert.equal(statusForEvent(''), null);
  for (const inbound of ['message', 'newContactMessageReceived', 'messageReceived']) {
    assert.equal(statusForEvent(inbound), null, `${inbound} must not be read as a status event`);
  }
});
