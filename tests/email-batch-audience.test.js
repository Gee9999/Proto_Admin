import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const brevo = fs.readFileSync(new URL('../api/_brevo-email.js', import.meta.url), 'utf8');
const sender = fs.readFileSync(new URL('../api/_send-email-broadcast.js', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../api/customer-email-broadcast.js', import.meta.url), 'utf8');
const lib = fs.readFileSync(new URL('../src/lib/customers.js', import.meta.url), 'utf8');

/**
 * A pre-registration CSV upload is a group, and a broadcast has to be able to
 * target just that group. proto_active_customers carries no business_type, so
 * the import batch is the only way to segment this audience.
 */
describe('broadcast to one import batch', () => {
  it('filters the proto-active audience by batch', () => {
    expect(brevo).toMatch(/fetchCustomerAudience\(sb, audience, \{ businessTypes = \[\], importBatch = '' \} = \{\}\)/);
    expect(brevo).toMatch(/batch \? \(q\) => q\.eq\('import_batch', batch\) : undefined/);
  });

  it('applies the filter inside the paginated fetch, not after it', () => {
    // buildQuery runs before .range(), so a batch past the first page is kept.
    expect(brevo).toMatch(/if \(buildQuery\) q = buildQuery\(q\);/);
  });

  it('threads the batch from the client through to the resolver', () => {
    expect(lib).toMatch(/recipients, importBatch,/);
    expect(endpoint).toMatch(/importBatch: String\(importBatch \|\| ''\)\.trim\(\)/);
    expect(sender).toMatch(/importBatch = ''/);
    expect(sender).toMatch(/importBatch,\s*\}\);/);
  });

  it('leaves an unfiltered send unchanged', () => {
    // No batch means no .eq(), so the whole audience still resolves.
    expect(brevo).toMatch(/const batch = String\(importBatch \|\| ''\)\.trim\(\);/);
  });
});

describe('composer group picker', () => {
  const modal = fs.readFileSync(new URL('../src/components/CustomerEmailModal.jsx', import.meta.url), 'utf8');

  it('sends the batch on BOTH the test and the real send', () => {
    // The real send is the one that matters; an early edit reached only the
    // test payload, which would have filtered the preview and not the send.
    const hits = modal.match(/importBatch: audience === 'proto-active' \? importBatch : ''/g) || [];
    expect(hits.length).toBe(2);
  });

  it('lists each upload group inside the Audience dropdown', () => {
    // A separate "which upload?" field only appeared once Pre-registration was
    // already chosen, so nobody found it. One dropdown, groups visible in it.
    expect(modal).toMatch(/value: `proto-active::\$\{b\.label\}`/);
    expect(modal).toMatch(/label: `Pre-registration — \$\{b\.label\} \(\$\{b\.count\}\)`/);
    expect(modal).toMatch(/audienceOptions\.map\(\(opt\) =>/);
  });

  it('splits the composite value back into audience and batch', () => {
    expect(modal).toMatch(/const \[aud, batch = ''\] = String\(raw\)\.split\('::'\)/);
    expect(modal).toMatch(/setImportBatch\(batch\)/);
  });

  it('loads the groups when the modal opens, not only on one audience', () => {
    expect(modal).toMatch(/\}, \[open\]\);/);
  });

  it('names the group in the confirm dialog', () => {
    expect(modal).toMatch(/group: \$\{importBatch\}/);
  });
});
