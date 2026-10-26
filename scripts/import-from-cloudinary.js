// Copies an existing Cloudinary library into a Files360 app through the public API.
//
//   CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud> \
//   FILES360_API_URL=https://files.example.com \
//   FILES360_API_KEY=f360_... \
//   node scripts/import-from-cloudinary.js [--prefix=folder/] [--type=image|raw|all] [--dry-run] [--concurrency=3]
//
// Options:
//   --prefix=products/   only public_ids starting with this
//   --type=image         image (default), raw, or all; "all" also lists video so it can be reported
//   --dry-run            list what would be imported and where, without calling Files360
//   --concurrency=3      parallel imports, 1 to 10
//   --state=FILE         resume file, default .cloudinary-import.json in the current directory
//   --map=FILE           CSV mapping file, default cloudinary-map.csv in the current directory
//   --restart            forget the saved cursors and list from the start (done items stay skipped)
//
// Re-running is safe: Files360 answers "duplicate": true for a file it already holds in
// that folder, and the state file lets an interrupted run pick up where it stopped.
// Only "upload" delivery type assets are listed; private and authenticated ones need
// signed URLs and are not covered.

const fs = require('node:fs');
const path = require('node:path');

const MAX_FOLDER_LEVELS = 5;
const MAX_FOLDER_LENGTH = 100;
const MAX_REF_LENGTH = 120;
const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_ATTEMPTS = 6;

// Mirrors sanitizeFolder in utils/validate.js, but repairs instead of rejecting,
// because a Cloudinary folder name can hold anything a person ever typed into it
function mapFolder(input) {
  if (typeof input !== 'string' || !input) return '';
  const segments = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split('/')
    .map((s) => s.replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+/, '').replace(/-+$/, ''))
    .filter(Boolean)
    .slice(0, MAX_FOLDER_LEVELS);

  let folder = '';
  for (const segment of segments) {
    const next = folder ? `${folder}/${segment}` : segment;
    if (next.length <= MAX_FOLDER_LENGTH) {
      folder = next;
      continue;
    }
    // a cut segment still has to be a valid one, so trim what is left of it the same way
    const room = MAX_FOLDER_LENGTH - (folder ? folder.length + 1 : 0);
    const cut = segment.slice(0, room).replace(/-+$/, '');
    if (cut) folder = folder ? `${folder}/${cut}` : cut;
    break;
  }
  return folder;
}

// Dynamic folder accounts report asset_folder; fixed folder accounts encode it in the public_id
function sourceFolder(resource) {
  if (typeof resource.asset_folder === 'string') return resource.asset_folder;
  if (typeof resource.folder === 'string') return resource.folder;
  const id = String(resource.public_id || '');
  const slash = id.lastIndexOf('/');
  return slash === -1 ? '' : id.slice(0, slash);
}

function mapRef(publicId) {
  return String(publicId || '').slice(0, MAX_REF_LENGTH) || undefined;
}

// Leading = + - @ are quoted too, so a spreadsheet does not run a public_id as a formula
function csvEscape(value) {
  if (value === undefined || value === null) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== String(value) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values) {
  return values.map(csvEscape).join(',') + '\n';
}

function primaryUrl(file) {
  if (!file) return '';
  if (file.kind === 'document') return (file.file && file.file.url) || '';
  const variants = Object.values(file.variants || {});
  if (variants.length === 0) return '';
  variants.sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
  return variants[0].url || '';
}

function parseCloudinaryUrl(value) {
  const match = /^cloudinary:\/\/([^:]+):([^@]+)@([^/?#]+)/.exec(String(value || '').trim());
  if (!match) return null;
  return { key: decodeURIComponent(match[1]), secret: decodeURIComponent(match[2]), cloud: match[3] };
}

function parseArgs(argv) {
  const args = { prefix: '', type: 'image', dryRun: false, concurrency: 3, restart: false,
    state: '.cloudinary-import.json', map: 'cloudinary-map.csv' };
  for (const arg of argv) {
    const [flag, ...rest] = arg.split('=');
    const value = rest.join('=');
    if (flag === '--prefix') args.prefix = value;
    else if (flag === '--type') args.type = value;
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--restart') args.restart = true;
    else if (flag === '--concurrency') args.concurrency = Number(value);
    else if (flag === '--state') args.state = value;
    else if (flag === '--map') args.map = value;
    else throw new Error(`Unknown option ${arg}. See the header of scripts/import-from-cloudinary.js for usage.`);
  }
  if (!['image', 'raw', 'all'].includes(args.type)) throw new Error('--type must be image, raw or all');
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 10) {
    throw new Error('--concurrency must be a whole number from 1 to 10');
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function backoff(attempt) {
  return Math.min(60_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
}

// Cloudinary sends the hourly reset as a date; Files360 sends Retry-After in seconds
function waitFromHeaders(headers, attempt) {
  const retryAfter = Number(headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const reset = Date.parse(headers.get('x-featureratelimit-reset') || '');
  if (Number.isFinite(reset) && reset > Date.now()) return reset - Date.now() + 1000;
  return backoff(attempt);
}

async function listPage(cloudinary, resourceType, { prefix, cursor }) {
  const params = new URLSearchParams({ max_results: '500' });
  if (prefix) params.set('prefix', prefix);
  if (cursor) params.set('next_cursor', cursor);
  const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinary.cloud)}/resources/${resourceType}/upload?${params}`;
  const auth = 'Basic ' + Buffer.from(`${cloudinary.key}:${cloudinary.secret}`).toString('base64');

  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: auth } });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw new Error(`Could not reach Cloudinary: ${err.message}`);
      await sleep(backoff(attempt));
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 420 || res.status === 429) {
      const wait = waitFromHeaders(res.headers, attempt);
      console.log(`Cloudinary rate limit reached, waiting ${Math.ceil(wait / 1000)} s before listing again.`);
      await sleep(wait);
      continue;
    }
    if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
      await sleep(backoff(attempt));
      continue;
    }
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('Cloudinary rejected the credentials. Check the key and secret in CLOUDINARY_URL.');
    throw new Error(`Cloudinary answered ${res.status} while listing ${resourceType} assets: ${body.slice(0, 300)}`);
  }
}

async function importOne(files360, payload) {
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(`${files360.url}/v1/files/from-url`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${files360.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) return { ok: false, transient: true, message: `network error: ${err.message}` };
      await sleep(backoff(attempt));
      continue;
    }
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data };
    if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
      await sleep(waitFromHeaders(res.headers, attempt));
      continue;
    }
    const error = (data && data.error) || {};
    if (res.status === 401) {
      throw new Error('Files360 rejected the API key. Check FILES360_API_KEY and that the key has not been revoked.');
    }
    return {
      ok: false,
      transient: RETRYABLE.has(res.status),
      message: `${res.status} ${error.code || ''} ${error.message || ''}`.replace(/\s+/g, ' ').trim(),
    };
  }
}

async function pool(items, limit, worker) {
  let next = 0;
  const run = async () => {
    while (next < items.length) await worker(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

function loadState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { cursors: state.cursors || {}, finished: state.finished || {}, done: state.done || [], retry: state.retry || [] };
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Could not read ${file}: ${err.message}. Delete it to start over.`);
    return { cursors: {}, finished: {}, done: [], retry: [] };
  }
}

// written through a temporary file so a crash mid-write cannot leave half a state behind
function saveState(file, state, done, retry) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...state, done: [...done], retry: [...retry.values()] }, null, 2));
  fs.renameSync(tmp, file);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cloudinary = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
  if (!cloudinary) throw new Error('Set CLOUDINARY_URL to cloudinary://<key>:<secret>@<cloud>, as shown in the Cloudinary console.');

  const files360 = {
    url: String(process.env.FILES360_API_URL || '').replace(/\/+$/, ''),
    key: process.env.FILES360_API_KEY || '',
  };
  if (!args.dryRun && (!files360.url || !files360.key)) {
    throw new Error('Set FILES360_API_URL and FILES360_API_KEY. Create the key in the Files360 dashboard under the app.');
  }

  const statePath = path.resolve(args.state);
  const mapPath = path.resolve(args.map);
  const state = args.dryRun ? { cursors: {}, finished: {}, done: [], retry: [] } : loadState(statePath);
  if (args.restart) {
    state.cursors = {};
    state.finished = {};
  }
  const done = new Set(state.done);
  const retry = new Map(state.retry.map((r) => [r.key, r]));
  const totals = { imported: 0, duplicates: 0, skippedVideo: 0, failed: 0, alreadyDone: 0 };
  const failures = [];
  const videos = [];

  if (!args.dryRun && !fs.existsSync(mapPath)) {
    fs.writeFileSync(mapPath, csvRow(['public_id', 'resource_type', 'files360_id', 'kind', 'primary_url']));
  }

  const handle = async (item) => {
    if (args.dryRun) {
      console.log(`${item.resourceType.padEnd(5)} ${item.publicId}  ->  ${item.folder || '(app folder)'}`);
      totals.imported += 1;
      return;
    }
    const result = await importOne(files360, { url: item.url, folder: item.folder || undefined, ref: item.ref });
    if (result.ok) {
      const file = result.data;
      if (file.duplicate) totals.duplicates += 1;
      else totals.imported += 1;
      fs.appendFileSync(mapPath, csvRow([item.publicId, item.resourceType, file.id, file.kind, primaryUrl(file)]));
      done.add(item.key);
      retry.delete(item.key);
    } else {
      totals.failed += 1;
      failures.push(`${item.publicId}: ${result.message}`);
      // only transient failures are kept for the next run; a 415 or 413 will not change
      if (result.transient) retry.set(item.key, item);
      else retry.delete(item.key);
      console.error(`FAIL  ${item.publicId}: ${result.message}`);
    }
  };

  if (retry.size > 0 && !args.dryRun) {
    console.log(`Retrying ${retry.size} file(s) that failed last time.`);
    await pool([...retry.values()], args.concurrency, handle);
    saveState(statePath, state, done, retry);
  }

  const types = args.type === 'all' ? ['image', 'raw', 'video'] : [args.type];
  for (const resourceType of types) {
    if (state.finished[resourceType]) {
      console.log(`${resourceType}: already listed in full by an earlier run, use --restart to list again.`);
      continue;
    }
    let cursor = state.cursors[resourceType];
    do {
      const page = await listPage(cloudinary, resourceType, { prefix: args.prefix, cursor });
      const items = [];
      for (const r of page.resources || []) {
        const key = `${resourceType}:${r.public_id}`;
        if (resourceType === 'video') {
          totals.skippedVideo += 1;
          videos.push(r.public_id);
          continue;
        }
        if (done.has(key)) {
          totals.alreadyDone += 1;
          continue;
        }
        items.push({
          key,
          resourceType,
          publicId: r.public_id,
          url: r.secure_url,
          folder: mapFolder(sourceFolder(r)),
          ref: mapRef(r.public_id),
        });
      }
      await pool(items, args.concurrency, handle);
      cursor = page.next_cursor || undefined;
      // the cursor only moves once the whole page is through, so a crash replays at most one page
      if (!args.dryRun) {
        state.cursors[resourceType] = cursor;
        if (!cursor) state.finished[resourceType] = true;
        saveState(statePath, state, done, retry);
      }
      if (!args.dryRun) {
        console.log(`${resourceType}: ${totals.imported} imported, ${totals.duplicates} duplicates, ${totals.failed} failed so far`);
      }
    } while (cursor);
  }

  if (videos.length > 0) {
    console.log(`\nSkipped ${videos.length} video or audio asset(s); Files360 does not store video:`);
    for (const id of videos.slice(0, 20)) console.log(`  ${id}`);
    if (videos.length > 20) console.log(`  and ${videos.length - 20} more`);
  }
  if (failures.length > 0 && failures.length <= 50) {
    console.log('\nFailed:');
    for (const line of failures) console.log(`  ${line}`);
  }

  console.log('\nSummary');
  if (args.dryRun) {
    console.log(`  would import      ${totals.imported}`);
  } else {
    console.log(`  imported          ${totals.imported}`);
    console.log(`  duplicates        ${totals.duplicates}`);
    if (totals.alreadyDone) console.log(`  done in earlier runs ${totals.alreadyDone}`);
  }
  console.log(`  skipped (video)   ${totals.skippedVideo}`);
  if (!args.dryRun) {
    console.log(`  failed            ${totals.failed}`);
    console.log(`\nMapping written to ${mapPath}`);
  }
  return totals.failed > 0 ? 1 : 0;
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.message);
      process.exit(1);
    }
  );
}

module.exports = { mapFolder, sourceFolder, mapRef, csvEscape, csvRow, primaryUrl, parseCloudinaryUrl, parseArgs };
