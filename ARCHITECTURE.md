# Files360 — what this repo does

A self-hosted upload API and media library. One endpoint takes a file; images are
optimized into every size an app has configured, documents and archives are stored
untouched with a readable preview, and everything lands on an S3-compatible bucket
**you** own and comes back as a CDN URL.

Think of it as the part of Cloudinary most projects actually use, running on your
own box and writing to your own bucket.

- Runtime: Node.js 20+, Express 5, EJS, sharp, AWS SDK v3, MongoDB via Mongoose
- Size: ~7,500 lines of application code, no build step, no frontend framework
- Deployment today: PM2 behind Nginx (see `ecosystem.config.js`)

---

## The flow

```
your backend --POST /v1/images (Bearer key)--> Files360 --sharp------> sizes
                                                   |     \--as is----> documents
                                                   |--PUT--> your bucket --> CDN URLs
                                                   |--save--> database
browsers --GET file--> your bucket's CDN (never through this service)
```

The service is never in the read path. It writes objects once and hands back URLs;
every later request goes straight to the bucket's CDN.

## Two kinds of asset, one pipeline

`utils/assetPipeline.js` is the entry point for every upload, whatever the source:

1. **Detect.** `utils/svg.js` claims SVG; `utils/documents.js` claims PDF, Office
   files, CSV, text and ZIP by sniffing bytes, not file names. Anything else falls
   through to the image path.
2. **Gate.** Per app: `allowDocuments` (default on), `allowArchives` (default off).
3. **Dedupe.** SHA-256 of the upload; same hash in the same folder of the same app
   returns the existing record with `200` and `"duplicate": true`.
4. **Store.**
   - *Images* → `utils/optimizer.js` renders each configured variant with sharp.
   - *SVG* → sanitized first, then rasterized into the same variants, and the clean
     vector is published alongside them.
   - *Documents* → written byte for byte, plus a small preview read once at upload.
5. **Record.** One document in the `images` collection, whatever the kind.

## Directory map

| Path | What lives there |
| --- | --- |
| `server.js` | Express wiring: CSP, sessions, routes, error handler |
| `config/env.js` | Every environment variable, validated at boot |
| `config/database.js` | Mongo connection |
| `controllers/apiController.js` | Public API: upload, import from URL, list, get, delete |
| `controllers/libraryController.js` | Media library, folder tree, asset detail, deletes |
| `controllers/appController.js` | Apps, API keys, settings, integration guide, console uploads |
| `controllers/bucketController.js` | Connect, verify, default and remove buckets |
| `middleware/apiKey.js` | Bearer / `X-API-Key` authentication |
| `middleware/auth.js` | Session auth, CSRF, flash, sidebar data |
| `middleware/upload.js` | Multer, per-app size limit |
| `models/` | `App`, `ApiKey`, `Bucket`, `Image` |
| `utils/assetPipeline.js` | **Start here.** Ingest and delete, both kinds |
| `utils/optimizer.js` | sharp: inspect, resize, encode, concurrency queue |
| `utils/documents.js` | Type detection and preview extraction |
| `utils/zip.js` | ZIP reader behind `.xlsx`, `.docx`, `.pptx`, `.zip` |
| `utils/cfb.js` | Compound file reader behind `.doc`, `.xls`, `.ppt` |
| `utils/svg.js` | SVG allowlist sanitizer |
| `utils/storage.js` | S3 put/delete, public URLs, bucket verification |
| `utils/providers.js` | Connection presets per storage provider |
| `utils/secretBox.js` | AES-256-GCM for bucket credentials at rest |
| `utils/fetchRemote.js` | SSRF-guarded download for URL imports |
| `utils/docs.js` | Generates the per-app integration guide |
| `views/` | EJS templates, server rendered |
| `public/css/app.css`, `public/js/app.js` | One stylesheet, one script, no framework |

## Data model

- **App** — a tenant. Owns a slug (its immutable folder), output format and quality,
  the list of variants, upload limits, which bucket it writes to, and its stats.
- **ApiKey** — belongs to an app. The prefix is stored in clear for lookup, the key
  itself only as a SHA-256 hash, shown once at creation.
- **Bucket** — an S3 connection. The secret is encrypted at rest. Carries
  `forcePathStyle` and `supportsAcl`, which differ per provider.
- **Image** — one stored asset, image or document. Holds `kind`, the content hash,
  the generated `variants[]`, the single stored `file` (documents and SVG vectors),
  and the `preview` read at upload time.

## Invariants worth knowing before you change anything

1. **URLs are immutable.** Objects live at
   `<app slug>/<folder>/<hash>/<name>`, where the hash covers the file *and* the
   app's render settings. Changing settings never rewrites or invalidates old files,
   so everything can be cached for a year with no purge.
2. **Every asset records the bucket it was written to.** Re-pointing an app at a new
   bucket never orphans what is already stored, and deletes go back to the right one.
3. **`utils/secretBox.js` SALT must never change.** It derives the key that encrypts
   stored bucket credentials; changing it makes every stored secret unreadable.
4. **Previews are read once and stored**, capped at roughly 96 KB per record, so
   listing a folder never touches the bucket.
5. **Documents are never re-encoded.** The bytes served are the bytes uploaded.
6. **SVG never reaches storage as uploaded.** It is sanitized first, and the raster
   sizes are rendered from the sanitized bytes.
7. **Only images use the sharp queue** (`MAX_CONCURRENT_JOBS` / `MAX_QUEUE`, answering
   `503 busy` when full). Documents cost milliseconds and bypass it.
8. **The CSP is built at request time** from the cached bucket origins, refreshed
   every 60 seconds, because buckets are added and removed at runtime.

## The code that deserves care

These are hand-written binary parsers with no dependencies. They run on
attacker-supplied bytes, so every one of them is written to fail closed and is
capped in what it will read:

- `utils/zip.js` — central directory parsing, per-entry inflate caps
- `utils/cfb.js` — FAT, mini-FAT and directory traversal, bounds-checked
- `utils/svg.js` — the allowlist that stands between an upload and stored XSS
- `utils/fetchRemote.js` — DNS-rebinding-safe URL import

Changes here need tests. See `test/`.

## Running it locally

```bash
npm install
cp .env.example .env     # set SESSION_SECRET, MONGO_URI, ADMIN_*
npm run hash-password -- 'your password'
npm run dev              # http://127.0.0.1:4360
npm test                 # parser and pipeline tests, no database needed
```

Storage is **not** configured in `.env`. Sign in, open **Storage**, and connect a
bucket; saving runs a real round trip (write, public read, delete) before marking
it usable.

## Where this is going

See [PLAN.md](PLAN.md). The short version: the database layer is being abstracted so
SQLite, Postgres and MySQL all work, a setup wizard replaces hand-edited `.env`
files, and the whole thing ships as a Docker image.
