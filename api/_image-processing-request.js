const MAX_BODY_BYTES = 30 * 1024 * 1024;

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error('Image processing request exceeds 30 MB');
      error.code = 'body_too_large';
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseContentDisposition(value = '') {
  const name = value.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1] || '';
  const filename = value.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1] || '';
  return { name, filename };
}

function parseMultipart(buffer, boundary) {
  const marker = Buffer.from(`--${boundary}`);
  const separator = Buffer.from('\r\n\r\n');
  const fields = {};
  const files = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const start = buffer.indexOf(marker, cursor);
    if (start < 0) break;
    const partStart = start + marker.length;
    if (buffer.subarray(partStart, partStart + 2).toString() === '--') break;
    const headerStart = partStart + 2;
    const headerEnd = buffer.indexOf(separator, headerStart);
    if (headerEnd < 0) break;
    const next = buffer.indexOf(marker, headerEnd + separator.length);
    if (next < 0) break;

    const headerText = buffer.subarray(headerStart, headerEnd).toString('utf8');
    const headers = Object.fromEntries(headerText.split('\r\n').map((line) => {
      const colon = line.indexOf(':');
      return colon > 0 ? [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()] : ['', ''];
    }).filter(([key]) => key));
    const disposition = parseContentDisposition(headers['content-disposition']);
    const content = buffer.subarray(headerEnd + separator.length, Math.max(headerEnd + separator.length, next - 2));

    if (disposition.filename) {
      files.push({
        field: disposition.name,
        filename: disposition.filename.replace(/\\/g, '/'),
        contentType: headers['content-type'] || 'application/octet-stream',
        buffer: content,
      });
    } else if (disposition.name) {
      fields[disposition.name] = content.toString('utf8');
    }
    cursor = next;
  }
  return { fields, files };
}

export async function parseImageProcessingRequest(req) {
  if (req.body && !Buffer.isBuffer(req.body) && typeof req.body === 'object') return req.body;
  const rawContentType = String(req.headers['content-type'] || '');
  const contentType = rawContentType.toLowerCase();
  const raw = await readRawBody(req);
  if (!raw.length) return {};

  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw.toString('utf8')); } catch { throw new Error('Request JSON is invalid'); }
  }
  if (contentType.includes('multipart/form-data')) {
    const boundary = rawContentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean);
    if (!boundary) throw new Error('Multipart boundary is missing');
    const { fields, files } = parseMultipart(raw, boundary);
    return {
      ...fields,
      source: fields.source || 'upload',
      items: files.filter((file) => file.field === 'images').map((file) => ({
        filename: file.filename,
        contentType: file.contentType,
        base64: file.buffer.toString('base64'),
      })),
    };
  }
  throw new Error('Content-Type must be application/json or multipart/form-data');
}
