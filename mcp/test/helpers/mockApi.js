const http = require('node:http');

const KEY = 'f360_0123456789ab_' + 'cd'.repeat(24);

const image = (overrides = {}) => ({
  id: '66f1c2a9e4b0a1d2c3f4e5a6',
  kind: 'image',
  folder: 'shop/products',
  ref: 'product-1042',
  hash: 'abc123',
  input: { name: 'photo.jpg', format: 'jpeg', width: 3000, height: 2000, bytes: 812345 },
  variants: {
    thumb: { url: 'https://cdn.example.com/shop/products/abc123/thumb.webp', width: 200, height: 200, bytes: 6100, format: 'webp' },
    large: { url: 'https://cdn.example.com/shop/products/abc123/large.webp', width: 1600, height: 1067, bytes: 120400, format: 'webp' },
  },
  srcset: 'https://cdn.example.com/shop/products/abc123/large.webp 1600w',
  bytesOut: 126500,
  createdAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const documentAsset = (overrides = {}) => ({
  id: '66f1c2a9e4b0a1d2c3f4e5b7',
  kind: 'document',
  folder: 'shop/contracts',
  ref: null,
  hash: 'def456',
  input: { name: 'terms.pdf', format: 'pdf', bytes: 40210 },
  file: { url: 'https://cdn.example.com/shop/contracts/def456/terms.pdf', name: 'terms.pdf', mime: 'application/pdf', bytes: 40210 },
  preview: { pages: 4 },
  bytesOut: 40210,
  createdAt: '2026-10-01T10:05:00.000Z',
  ...overrides,
});

/**
 * A small stand-in for the Files360 API. It records every request so tests can
 * assert on what the MCP server actually sent, and answers like the real routes.
 */
function startMockApi() {
  const requests = [];
  const seen = new Set();

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://localhost');
      requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });

      const send = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const error = (status, code, message) => send(status, { error: { code, message } });

      if (req.headers.authorization !== `Bearer ${KEY}`) return error(401, 'invalid_api_key', 'The API key is wrong or has been revoked');

      const route = `${req.method} ${url.pathname}`;
      if (route === 'GET /v1/me') {
        return send(200, {
          app: {
            name: 'Shop', folder: 'shop', format: 'webp', quality: 80, keepOriginal: false, maxUploadMB: 10,
            allowDocuments: true, allowArchives: false,
            accepts: { images: ['jpeg', 'png'], documents: ['pdf', 'csv'], archives: [] },
            variants: [{ name: 'thumb', width: 200, height: 200, fit: 'cover' }, { name: 'large', width: 1600, height: null, fit: 'inside' }],
          },
          key: { label: 'agent' },
        });
      }
      if (route === 'POST /v1/files') {
        const text = body.toString('latin1');
        if (!/name="file"; filename="/.test(text)) return error(400, 'missing_file', 'Send the file as multipart/form-data in a field named "file"');
        if (text.includes('TOO-BIG')) return error(413, 'file_too_large', 'File exceeds the 10 MB limit');
        const folder = /name="folder"\r\n\r\n([^\r]*)/.exec(text)?.[1] || null;
        const ref = /name="ref"\r\n\r\n([^\r]*)/.exec(text)?.[1] || null;
        const isPdf = text.includes('%PDF-');
        const key = `${folder}|${isPdf}`;
        const duplicate = seen.has(key);
        seen.add(key);
        const asset = isPdf ? documentAsset({ folder, ref }) : image({ folder, ref });
        return send(duplicate ? 200 : 201, { ...asset, duplicate });
      }
      if (route === 'POST /v1/files/from-url') {
        let json;
        try {
          json = JSON.parse(body.toString('utf8'));
        } catch {
          return error(400, 'invalid_json', 'The JSON body could not be parsed');
        }
        if (json.url.includes('internal')) return error(400, 'blocked_url', 'That address points at a private network and cannot be fetched');
        return send(201, { ...image({ folder: json.folder || null, ref: json.ref || null }), duplicate: false });
      }
      if (route === 'GET /v1/files') {
        return send(200, { page: Number(url.searchParams.get('page') || 1), limit: Number(url.searchParams.get('limit') || 50), total: 2, items: [image(), documentAsset()] });
      }
      const one = /^\/v1\/files\/([^/]+)$/.exec(url.pathname);
      if (one && req.method === 'GET') {
        if (one[1] === image().id) return send(200, image());
        if (one[1] === documentAsset().id) return send(200, documentAsset());
        return error(404, 'not_found', 'File not found');
      }
      if (one && req.method === 'DELETE') {
        if (one[1] !== image().id) return error(404, 'not_found', 'File not found');
        res.writeHead(204);
        return res.end();
      }
      if (route === 'GET /v1/slow') return; // never answers, for the timeout test
      if (route === 'GET /v1/html') {
        res.writeHead(502, { 'Content-Type': 'text/html' });
        return res.end('<html>Bad gateway</html>');
      }
      return error(404, 'not_found', 'Unknown endpoint');
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        key: KEY,
        requests,
        close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
      });
    });
  });
}

module.exports = { startMockApi, KEY, image, documentAsset };
