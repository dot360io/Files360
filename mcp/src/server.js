const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { Files360Client, ApiError } = require('./client');
const { version } = require('../package.json');

const FOLDER_HINT = 'Optional sub folder inside the app folder, e.g. "products" or "users/avatars". Lowercase a-z, 0-9, "-" and "_", up to 5 levels separated by "/".';
const REF_HINT = 'Optional reference of your own, such as a product or user id (up to 120 characters). Files can be found again by it with files360_list_files.';

const folder = z.string().max(100).optional().describe(FOLDER_HINT);
const ref = z.string().max(120).optional().describe(REF_HINT);
const id = z.string().min(1).max(64).describe('The file id returned by an upload or a listing, 24 hex characters.');

function formatBytes(bytes) {
  if (typeof bytes !== 'number') return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function describeAsset(asset) {
  const where = asset.folder ? ` in ${asset.folder}` : '';
  const tag = asset.ref ? ` (ref ${asset.ref})` : '';
  const lines = [];

  if (asset.kind === 'document') {
    const f = asset.file || {};
    lines.push(`Document ${asset.id}${where}${tag}: ${f.name || 'unnamed'}, ${f.mime || 'unknown type'}, ${formatBytes(f.bytes)}`);
    lines.push(`URL: ${f.url}`);
    const preview = asset.preview && Object.entries(asset.preview)
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    if (preview) lines.push(`Preview: ${preview}`);
    return lines.join('\n');
  }

  const input = asset.input || {};
  const size = input.width && input.height ? `, original ${input.width}x${input.height}` : '';
  lines.push(`Image ${asset.id}${where}${tag}${size}`);
  for (const [name, v] of Object.entries(asset.variants || {})) {
    lines.push(`- ${name}: ${v.width}x${v.height} ${v.format}, ${formatBytes(v.bytes)}, ${v.url}`);
  }
  if (asset.file && asset.file.url) lines.push(`Vector (SVG): ${asset.file.url}`);
  if (asset.srcset) lines.push(`srcset: ${asset.srcset}`);
  return lines.join('\n');
}

function describeUpload(asset) {
  const note = asset.duplicate
    ? 'Already stored: the same file was uploaded to this folder before, so the existing record is returned.'
    : 'Uploaded.';
  return `${note}\n${describeAsset(asset)}`;
}

function describeConfig(data) {
  const app = data.app || {};
  const accepts = app.accepts || {};
  const variants = (app.variants || [])
    .map((v) => `${v.name} (${v.width || 'auto'}x${v.height || 'auto'}, ${v.fit})`)
    .join(', ');
  return [
    `App "${app.name}", folder ${app.folder}`,
    `Output: ${app.format} at quality ${app.quality}, max upload ${app.maxUploadMB} MB`,
    `Sizes: ${variants || 'none'}`,
    `Images: ${(accepts.images || []).join(', ') || 'none'}`,
    `Documents: ${(accepts.documents || []).join(', ') || 'not accepted'}`,
    `Archives: ${(accepts.archives || []).join(', ') || 'not accepted'}`,
  ].join('\n');
}

function describeList(data) {
  const items = data.items || [];
  if (!items.length) return `No files on page ${data.page} (${data.total} in total).`;
  const first = (data.page - 1) * data.limit + 1;
  const header = `Files ${first}-${first + items.length - 1} of ${data.total} (page ${data.page}, ${data.limit} per page)`;
  const rows = items.map((a) => {
    const where = a.folder ? ` ${a.folder}` : '';
    const tag = a.ref ? ` ref=${a.ref}` : '';
    if (a.kind === 'document') return `- ${a.id} document${where}${tag} ${a.file?.name || ''} ${a.file?.url || ''}`.trimEnd();
    const largest = Object.values(a.variants || {}).sort((x, y) => (y.width || 0) - (x.width || 0))[0];
    return `- ${a.id} image${where}${tag} ${a.input?.name || ''} ${largest ? largest.url : ''}`.trimEnd();
  });
  return [header, ...rows].join('\n');
}

const ok = (text, structuredContent) => ({ content: [{ type: 'text', text }], structuredContent });

const fail = (err) => {
  const text = err instanceof ApiError && err.code && err.status
    ? `Files360 error ${err.status} ${err.code}: ${err.message}`
    : err.message;
  return {
    content: [{ type: 'text', text }],
    structuredContent: { error: { status: err.status || null, code: err.code || 'error', message: err.message } },
    isError: true,
  };
};

// every handler goes through here, so a failure always reaches the model as a tool error
const run = (fn) => async (args) => {
  try {
    return await fn(args || {});
  } catch (err) {
    return fail(err);
  }
};

function createServer({ client, config } = {}) {
  client = client || new Files360Client(config);
  const server = new McpServer({ name: 'files360', version });

  server.registerTool('files360_get_config', {
    title: 'Get Files360 app configuration',
    description: 'Returns the settings of the Files360 app this key belongs to: name, base folder, output format and quality, maximum upload size in MB, the image sizes (variants) every upload is turned into, and which document and archive formats are accepted. Call it before uploading if you need to know whether a file type or size will be accepted.',
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, run(async () => {
    const data = await client.getConfig();
    return ok(describeConfig(data), data);
  }));

  server.registerTool('files360_upload_file', {
    title: 'Upload a local file to Files360',
    description: 'Uploads a file from this machine to Files360 and returns its public CDN URLs. Images (JPEG, PNG, WebP, GIF, AVIF, TIFF, SVG) are optimised into every configured size and come back with kind "image", a URL per size in "variants" and a ready-made "srcset". Documents and archives are stored unchanged and come back with kind "document" and a single "file.url". The type is decided from the file contents, not its name. Uploading the same file into the same folder again is safe: it returns the existing record with "duplicate": true. The URLs are public as soon as this returns, so do not upload private files unless the user asked for it.',
    inputSchema: {
      path: z.string().min(1).describe('Absolute path of the file on this machine. "~/" is expanded to the home folder; relative paths are resolved against the server\'s working directory, which is often not the project folder.'),
      folder,
      ref,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, run(async ({ path, folder, ref }) => {
    const asset = await client.uploadFile(path, { folder, ref });
    return ok(describeUpload(asset), asset);
  }));

  server.registerTool('files360_import_url', {
    title: 'Import a file into Files360 from a URL',
    description: 'Makes Files360 download a file from a public http or https URL and store it exactly like an upload: images are optimised into every configured size, documents are stored as they are. Useful for moving files that are already online. Private or internal addresses are refused by the server. The response has the same shape as files360_upload_file, including "duplicate": true when the same file is already in that folder.',
    inputSchema: {
      url: z.string().url().describe('Public http or https URL of the file.'),
      folder,
      ref,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, run(async ({ url, folder, ref }) => {
    const asset = await client.importUrl(url, { folder, ref });
    return ok(describeUpload(asset), asset);
  }));

  server.registerTool('files360_list_files', {
    title: 'List files in Files360',
    description: 'Lists the app\'s files, newest first, with their ids and URLs. Images and documents come back together, told apart by "kind". Filter by folder (exact match) or by the ref given at upload time. The result includes "total" so you can page through with "page".',
    inputSchema: {
      page: z.number().int().min(1).optional().describe('Page number, starting at 1.'),
      limit: z.number().int().min(1).max(200).optional().describe('Files per page, up to 200. The server default is 50.'),
      folder: z.string().max(100).optional().describe('Only files in this folder.'),
      ref: z.string().max(120).optional().describe('Only files uploaded with this ref.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, run(async (args) => {
    const data = await client.listFiles(args);
    return ok(describeList(data), data);
  }));

  server.registerTool('files360_get_file', {
    title: 'Get one Files360 file',
    description: 'Returns one file by id, in the same shape as an upload: kind "image" with variants and srcset, or kind "document" with file.url and a preview summary.',
    inputSchema: { id },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, run(async ({ id }) => {
    const asset = await client.getFile(id);
    return ok(describeAsset(asset), asset);
  }));

  server.registerTool('files360_delete_file', {
    title: 'Delete a Files360 file',
    description: 'Permanently deletes a file and every size stored for it. Its URLs stop working, apart from copies the CDN edge may serve for a short while, and any page that still uses them will show a broken image or link. This cannot be undone. Only call it when the user has clearly asked for this file to be removed.',
    inputSchema: { id },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, run(async ({ id }) => {
    await client.deleteFile(id);
    return ok(`Deleted ${id}.`, { id, deleted: true });
  }));

  return server;
}

module.exports = { createServer, describeAsset, describeList, describeConfig };
