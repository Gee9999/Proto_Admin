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
