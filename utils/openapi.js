/**
 * The public API as OpenAPI 3.1, and the same facts as llms.txt. Built from
 * code so the running instance, the docs site and agents read one description.
 * Served at /openapi.json and /llms.txt, and written into the docs site by
 * scripts/build-docs.js.
 */
const documents = require('./documents');
const { version } = require('../package.json');

const error = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const asset = {
  description: 'An image (with variants) or a document (with one file). Branch on `kind`.',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Asset' } } },
};

const folderParam = {
  type: 'string',
  maxLength: 100,
  pattern: '^[a-z0-9][a-z0-9_-]*(/[a-z0-9][a-z0-9_-]*){0,4}$',
  description: 'Sub folder inside the app folder, up to 5 levels, e.g. products or users/avatars.',
};
const refParam = { type: 'string', maxLength: 120, description: 'Your own reference, e.g. a product or user id.' };

function spec(serverUrl) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Files360 API',
      version,
      summary: 'Upload images and documents; get back CDN URLs on your own bucket.',
      description:
        'Images are optimized into every size the app has configured. Documents (PDF, Word, Excel, PowerPoint, CSV, text) and ZIP archives are stored as uploaded with a short preview. Uploading the same file into the same folder twice returns the first record with `duplicate: true`.',
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
    },
    externalDocs: { url: 'https://files360.dev', description: 'Documentation' },
    servers: [{ url: serverUrl }],
    security: [{ bearer: [] }],
    paths: {
      '/v1/me': {
        get: {
          operationId: 'getConfig',
          summary: 'The app this key belongs to, and its current settings',
          responses: { 200: { description: 'App configuration', content: { 'application/json': { schema: { $ref: '#/components/schemas/Me' } } } }, 401: error('Missing or invalid key') },
        },
      },
      '/v1/files': {
        post: {
          operationId: 'uploadFile',
          summary: 'Upload a file: an image is optimized, a document is stored as is',
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: { file: { type: 'string', format: 'binary' }, folder: folderParam, ref: refParam },
                },
              },
            },
          },
          responses: {
            201: asset,
            200: { ...asset, description: 'The same file was already in this folder; the existing record, with `duplicate: true`.' },
            400: error('Missing file or invalid folder or ref'),
            401: error('Missing or invalid key'),
            413: error('Above the size or pixel limit'),
            415: error('Not an accepted image, document or archive, or not enabled for this app'),
            429: error('Rate limited'),
            502: error('The storage bucket rejected the files'),
            503: error('Processing queue full, or no storage connected'),
          },
        },
        get: {
          operationId: 'listFiles',
          summary: 'List files, newest first',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
            { name: 'folder', in: 'query', schema: folderParam, description: 'Exact folder; subfolders are not included.' },
            { name: 'ref', in: 'query', schema: refParam },
          ],
          responses: { 200: { description: 'One page', content: { 'application/json': { schema: { $ref: '#/components/schemas/List' } } } }, 401: error('Missing or invalid key') },
        },
      },
      '/v1/files/from-url': {
        post: {
          operationId: 'importFromUrl',
          summary: 'Download a file from a public URL and handle it like an upload',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' }, folder: folderParam, ref: refParam } },
              },
            },
          },
          responses: { 201: asset, 200: asset, 400: error('Invalid, blocked or unreachable URL'), 401: error('Missing or invalid key'), 504: error('The download timed out') },
        },
      },
      '/v1/files/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } }],
        get: { operationId: 'getFile', summary: 'One file', responses: { 200: asset, 404: error('Not found, or it belongs to another app') } },
        delete: {
          operationId: 'deleteFile',
          summary: 'Delete the record and every object stored for it',
          responses: { 204: { description: 'Deleted. CDN edges may serve cached copies until they expire.' }, 404: error('Not found') },
        },
      },
    },
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'An app API key, f360_<prefix>_<secret>. X-API-Key is accepted too.' } },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' } } } },
        },
        Variant: {
          type: 'object',
          properties: { url: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' }, bytes: { type: 'integer' }, format: { enum: ['webp', 'avif', 'jpeg'] } },
        },
        StoredFile: {
          type: 'object',
          properties: { url: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, bytes: { type: 'integer' }, sanitizedAway: { type: 'array', items: { type: 'string' } } },
        },
        Asset: {
          type: 'object',
          required: ['id', 'kind', 'folder', 'hash', 'createdAt'],
          properties: {
            id: { type: 'string' },
            kind: { enum: ['image', 'document'] },
            folder: { type: 'string' },
            ref: { type: ['string', 'null'] },
            hash: { type: 'string', description: 'SHA-256 of the uploaded bytes' },
            input: { type: 'object', properties: { name: { type: ['string', 'null'] }, format: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' }, bytes: { type: 'integer' } } },
            variants: { type: 'object', additionalProperties: { $ref: '#/components/schemas/Variant' }, description: 'Images only, keyed by size name' },
            srcset: { type: 'string', description: 'Images only. Cropped sizes are left out.' },
            file: { $ref: '#/components/schemas/StoredFile', description: 'Documents, and the cleaned vector of an SVG' },
            preview: { type: ['object', 'null'], description: 'Documents only: pages, rows, columns, sheets, words, lines, slides, entries, unpackedBytes, macros' },
            bytesOut: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            duplicate: { type: 'boolean', description: 'Upload responses only' },
          },
        },
        List: {
          type: 'object',
          properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, items: { type: 'array', items: { $ref: '#/components/schemas/Asset' } } },
        },
        Me: {
          type: 'object',
          properties: {
            app: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                folder: { type: 'string' },
                format: { enum: ['webp', 'avif', 'jpeg'] },
                quality: { type: 'integer' },
                keepOriginal: { type: 'boolean' },
                maxUploadMB: { type: 'integer' },
                allowDocuments: { type: 'boolean' },
                allowArchives: { type: 'boolean' },
                accepts: { type: 'object', properties: { images: { type: 'array', items: { type: 'string' } }, documents: { type: 'array', items: { type: 'string' } }, archives: { type: 'array', items: { type: 'string' } } } },
                variants: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, width: { type: ['integer', 'null'] }, height: { type: ['integer', 'null'] }, fit: { type: 'string' } } } },
              },
            },
            key: { type: 'object', properties: { label: { type: 'string' } } },
          },
        },
      },
    },
  };
}

/** llms.txt (https://llmstxt.org): what an agent needs to use this instance. */
function llmsTxt(serverUrl) {
  return `# Files360

> Self-hosted upload API and media library. Send a file, get CDN URLs on the operator's own S3-compatible bucket. Images are optimized into named sizes; documents and ZIP archives are stored as uploaded with a preview.

This instance: ${serverUrl}

## Using the API

- Authenticate every request with \`Authorization: Bearer f360_<prefix>_<secret>\` (an app API key, created in the dashboard). Keys belong on servers, never in browser code.
- \`POST /v1/files\` multipart: \`file\` (required), \`folder\` (optional, lowercase a-z 0-9 - _, up to 5 levels), \`ref\` (optional, your own id). 201 on create, 200 with \`"duplicate": true\` when the same file is already in that folder, so retries are safe.
- \`POST /v1/files/from-url\` JSON \`{"url", "folder", "ref"}\`.
- \`GET /v1/files?page=&limit=&folder=&ref=\`, \`GET /v1/files/{id}\`, \`DELETE /v1/files/{id}\`.
- \`GET /v1/me\` returns the app's sizes, format and limits.
- Every response has \`kind\`: \`image\` gives \`variants.<size>.url\` and \`srcset\`; \`document\` gives \`file.url\` and a \`preview\` summary.
- Errors are \`{"error": {"code", "message"}}\`. Retry 429, 502, 503 and 504 with backoff; do not retry 4xx otherwise.
- Accepted: JPEG, PNG, WebP, GIF, AVIF, TIFF, SVG (sanitized); documents ${documents.DOCUMENT_FORMATS.join(', ')} when the app allows them; ZIP when the app allows archives. Not HEIC, not video.

## Reference

- [OpenAPI description](${serverUrl}/openapi.json)
- [Documentation](https://files360.dev)
- [API reference](https://files360.dev/api)
- [MCP server](https://files360.dev/agents): \`npx files360-mcp\`
`;
}

module.exports = { spec, llmsTxt };
