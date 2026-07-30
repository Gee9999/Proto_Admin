/**
 * Parse a customer CSV with headers:
 * Account, CompanyName, ContactName, EmailAddress, TotalSpend
 * Header matching is case/space-insensitive; extra columns are ignored.
 */

const HEADER_ALIASES = {
  account: 'account',
  accountcode: 'account',
  code: 'account',
  companyname: 'companyName',
  company: 'companyName',
  business: 'companyName',
  businessname: 'companyName',
  name: 'companyName',
  contactname: 'contactName',
  contact: 'contactName',
  emailaddress: 'email',
  email: 'email',
  totalspend: 'totalSpend',
  spend: 'totalSpend',
  saleslast12months: 'totalSpend',
};

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',' || ch === ';') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => String(c).trim() !== '')) rows.push(row);
  return rows;
}

function normalizeHeader(raw) {
  return HEADER_ALIASES[String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '')] || null;
}

/** Parse an array-of-arrays table (first row = headers) into customer rows. */
export function parseCustomerTable(table) {
  if (!table?.length) return { rows: [], errors: ['File is empty'] };

  const headers = table[0].map(normalizeHeader);
  if (!headers.includes('email')) {
    return { rows: [], errors: ['File must have an EmailAddress column (found headers: ' + table[0].join(', ') + ')'] };
  }

  const rows = [];
  const errors = [];
  for (let r = 1; r < table.length; r += 1) {
    const record = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c];
      if (key) record[key] = String(table[r][c] ?? '').trim();
    }
    if (!record.email || !record.email.includes('@')) {
      errors.push(`Row ${r + 1}: missing/invalid EmailAddress — skipped`);
      continue;
    }
    record.totalSpend = Number(String(record.totalSpend || '0').replace(/[R,\s]/gi, '')) || 0;
    rows.push(record);
  }
  return { rows, errors };
}

export function parseCustomerCsv(text) {
  return parseCustomerTable(parseCsvText(text));
}

/** Parse a customer file — .csv or .xlsx — into { rows, errors }. */
export async function parseCustomerFile(file) {
  if (/\.xlsx?$/i.test(file.name || '')) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return { rows: [], errors: ['Workbook has no sheets'] };
    const table = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    return parseCustomerTable(table);
  }
  return parseCustomerCsv(await file.text());
}
