const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { version } = require('../package.json');

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** A thin wrapper over the Files360 HTTP API. One instance per key. */
class Files360Client {
  constructor({ apiUrl, apiKey, timeoutMs = 60_000, uploadDir = null, fetchImpl = globalThis.fetch }) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.uploadDir = uploadDir;
    this.fetch = fetchImpl;
  }

  async request(method, route, { query, json, form } = {}) {
    const url = new URL(this.apiUrl + '/v1' + route);
    for (const [name, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    }

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': `files360-mcp/${version}`,
    };
    let body;
    if (json) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }

    let res;
    try {
      res = await this.fetch(url, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      if (err.name === 'TimeoutError') {
        throw new ApiError(0, 'timeout', `Files360 did not answer within ${Math.round(this.timeoutMs / 1000)} seconds. Large images take a few seconds to process; try again, or check that the instance is up.`);
      }
      throw new ApiError(0, 'unreachable', `Could not reach Files360 at ${this.apiUrl}: ${err.cause?.message || err.message}. Check FILES360_API_URL and that the instance is running.`);
    }

    if (res.status === 204) return null;

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // a proxy or load balancer in front of the API can answer with HTML
    }

    if (!res.ok) {
      const error = data && data.error;
      if (error && error.message) throw new ApiError(res.status, error.code || 'error', error.message);
      throw new ApiError(res.status, 'http_error', `Files360 answered with status ${res.status} and no error details. Something between this machine and the API may be failing.`);
    }
    if (data === null) {
      throw new ApiError(res.status, 'invalid_response', `Files360 answered with status ${res.status} but the body was not JSON. Check that FILES360_API_URL points at the API and not at another site.`);
    }
    return data;
  }

  getConfig() {
    return this.request('GET', '/me');
  }

  async uploadFile(filePath, { folder, ref } = {}) {
    const resolved = await this.resolveUploadPath(filePath);
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) throw new ApiError(0, 'not_a_file', `${resolved} is not a regular file.`);

    // openAsBlob streams from disk, so a large file never sits in memory whole
    const blob = await fs.openAsBlob(resolved);
    const form = new FormData();
    form.append('file', blob, path.basename(resolved));
    if (folder) form.append('folder', folder);
    if (ref) form.append('ref', ref);
    return this.request('POST', '/files', { form });
  }

  importUrl(url, { folder, ref } = {}) {
    return this.request('POST', '/files/from-url', { json: { url, folder, ref } });
  }

  listFiles({ page, limit, folder, ref } = {}) {
    return this.request('GET', '/files', { query: { page, limit, folder, ref } });
  }

  getFile(id) {
    return this.request('GET', '/files/' + encodeURIComponent(id));
  }

  deleteFile(id) {
    return this.request('DELETE', '/files/' + encodeURIComponent(id));
  }

  async resolveUploadPath(filePath) {
    const expanded = filePath.startsWith('~/') || filePath === '~'
      ? path.join(os.homedir(), filePath.slice(1))
      : filePath;
    const absolute = path.resolve(expanded);

    let real;
    try {
      real = await fs.promises.realpath(absolute);
    } catch (err) {
      if (err.code === 'ENOENT') throw new ApiError(0, 'file_not_found', `No file at ${absolute}. Pass an absolute path to a file on this machine.`);
      throw new ApiError(0, 'file_unreadable', `Could not read ${absolute}: ${err.message}`);
    }

    if (this.uploadDir) {
      // realpath on both sides, so a symlink inside the folder cannot point out of it
      const root = await fs.promises.realpath(this.uploadDir).catch(() => this.uploadDir);
      const relative = path.relative(root, real);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new ApiError(0, 'outside_upload_dir', `${absolute} is outside ${root}. This server only uploads files from that folder (FILES360_UPLOAD_DIR).`);
      }
    }
    return real;
  }
}

module.exports = { Files360Client, ApiError };
