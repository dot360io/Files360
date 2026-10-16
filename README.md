# Files360

> **Status: being prepared for open source.** The code below is what runs today.
> The database abstraction, the setup wizard and the Docker image are planned but not
> built yet — see [PLAN.md](PLAN.md). Architecture notes are in [ARCHITECTURE.md](ARCHITECTURE.md).

Self-hosted image optimization for your apps, in the spirit of Cloudinary. An app sends an image to the API, the service resizes and converts it with sharp, stores every size on an object storage bucket you connect from the dashboard, and returns the CDN URLs. The console manages apps, API keys and sizes, has a media library with folders, search and bulk delete, and generates a downloadable integration guide per app.

The same endpoints also take **documents**: PDF, Word, Excel, PowerPoint, CSV and text, in both the current formats and the 97-2003 ones, plus **ZIP archives**. Those are stored exactly as uploaded on the same bucket, with one public URL each, and the library shows a preview of what is inside — the PDF itself, the first rows of a sheet, the first paragraphs of a Word file, the text of each slide, the entries of an archive. Documents are on per app by default; archives are off.

**SVG** is accepted as an image. It is rewritten through a strict allowlist before anything is stored, then rasterized into the app's normal sizes, so consumers get WebP or AVIF as usual and the cleaned vector as well.

Stack: Node.js 20+, Express 5, MongoDB (Mongoose), EJS, sharp, AWS SDK v3, PM2, Nginx. Runs on Hetzner CAX (arm64).

Storage is not configured in `.env`. Connect one or more buckets under **Storage** in the dashboard — Hetzner, DigitalOcean Spaces, AWS S3, Cloudflare R2, Backblaze B2, Wasabi, Scaleway, MinIO, or any other S3-compatible provider — and point each app at the bucket it should use.

## Project structure

```
server.js                  Express app: security headers, sessions, routes, errors
config/
  env.js                   Environment variables
  database.js              MongoDB connection
controllers/
  apiController.js         Public API: upload, import, list, get, delete
  authController.js        Sign in and out
  dashboardController.js   Usage overview
  libraryController.js     Media library, asset details, deletes
  appController.js         Apps, API keys, settings, integration guide, console uploads
  bucketController.js      Storage buckets: connect, test, default, enable, remove
middleware/
  apiKey.js                API key authentication
  auth.js                  Session auth, CSRF, flash messages, sidebar data
  loadApp.js               Loads the app for /apps/:id routes
  upload.js                Multer, per-app size limit
  rateLimits.js            API and login rate limits
  errorHandler.js          JSON errors for the API, error page for the console
models/
  App.js  ApiKey.js  Image.js
routes/
  api.js  auth.js  dashboard.js  library.js  apps.js
utils/
  assetPipeline.js         Dedupe, optimize or store as is, record, delete
  optimizer.js             sharp: inspect, resize, encode, processing queue
  documents.js             Documents and archives: detection and previews
  zip.js                   Small ZIP reader behind .xlsx, .docx, .pptx and .zip
  cfb.js                   Compound file reader behind .doc, .xls and .ppt
  svg.js                   SVG allowlist: what may be stored and rasterized
  storage.js               Put, delete, CDN URLs
  fetchRemote.js           Safe URL download for imports
  docs.js                  Integration guide generator
  validate.js  keys.js  format.js  icons.js  limiter.js  errors.js
views/
  partials/  auth/  dashboard/  library/  apps/  buckets/  errors/
public/
  css/app.css  js/app.js
docs/
  integration-template.md  Template of the per-app integration guide
public/
  img/providers/           Provider logos, populated by npm run fetch-logos
scripts/
  hash-password.js  check-storage.js  fetch-logos.js
```

## How it fits together

```
App backend --POST /v1/images (Bearer key)--> Files360  --sharp------> sizes
                                                  |     \--as is----> documents
                                                  |--PUT--> the app's bucket --> CDN URLs
                                                  |--save--> MongoDB
Browsers --GET file--> that bucket's CDN
```

Each app writes to its own bucket, or to the one marked default. Every record keeps
the bucket it was written to, so re-pointing an app never orphans the files already
stored, and deletes always go back to the right provider.

Bucket layout, one folder per app:

```
<bucket>/<app folder>/<optional sub folder>/<content hash>/<size>.webp
my-images/transfer-360/vehicles/3f9a1c7e5b2d8a4f6e0c9b1d/large.webp
my-images/transfer-360/contracts/8b1f0c2ad4e69137aa02c5be/rental-terms.pdf
```

The hash covers the file and the app settings, so a URL never points to different content. Files are cached for a year and never need a CDN purge. A document keeps its own name in the last segment, so the download arrives with a sensible file name.

## Setup

1. **Install**

   ```bash
   npm install
   cp .env.example .env
   openssl rand -hex 32                                  # SESSION_SECRET
   npm run hash-password -- 'your dashboard password'    # ADMIN_PASSWORD_HASH
   ```

   Use single quotes around the password so the shell does not expand `$`.
2. **Run**: `pm2 start ecosystem.config.js && pm2 save`
3. **Nginx**: copy `nginx.conf.example`, set the domain, run certbot. Keep `client_max_body_size` above `MAX_UPLOAD_MB`.
4. **Connect storage**: sign in, open **Storage**, pick a provider and paste a bucket
   name plus an access key pair. The endpoint, region list and public URL come from the
   preset. Saving runs a real round trip — it uploads a file, reads it back over the
   public URL and deletes it — so a bucket is never marked working until it is.

   Make the bucket itself public at the provider, otherwise the files 403.
   `npm run check-storage` re-tests every connected bucket from the command line.
5. **Provider logos** (optional): `npm run fetch-logos` downloads each provider's
   icon from its own site into `public/img/providers/`, then restart. Without it
   the storage pages fall back to simplified marks drawn in each brand's colour.

Open `/login`, create an app, copy its first key, and download its integration guide from the Integration tab.

## Console

- **Dashboard**: totals, uploads per day for 30 days, storage per app, recent uploads.
- **Media library**: folder tree per app, subfolder tiles, grid and list views, search by file name or ref, sorting, multi-select bulk delete, upload dialog with progress. Documents show a coloured type tile instead of a thumbnail.
- **Image details**: preview on a checkerboard with a size switcher, savings, metadata, URLs of every size, responsive HTML snippet, srcset and API JSON.
- **Document details**: the PDF in a frame, spreadsheets and CSV as a table with sticky headers and row numbers, Word files as text with their headings, presentations as a slide list, text files with line numbers, archives as a file listing, and the 97-2003 formats as a properties card. Every one carries the public URL, media type and storage key.
- **Apps**: cards with previews and stats. Each app has Overview, API keys, Sizes and format, and Integration tabs.

## API

| Method | Path | |
| --- | --- | --- |
| `GET` | `/v1/me` | App configuration, key check |
| `POST` | `/v1/images` | Multipart upload: `file`, optional `folder`, `ref`. Images, documents and archives |
| `POST` | `/v1/images/from-url` | JSON `{ url, folder, ref }` |
| `GET` | `/v1/images` | List with `page`, `limit`, `folder`, `ref` |
| `GET` | `/v1/images/:id` | One record |
| `DELETE` | `/v1/images/:id` | Delete the record and its files |
| `GET` | `/health` | Mongo status and processing queue |

Every response carries `kind`. An image answers with `variants` and `srcset` exactly as before; a document answers with `file: { url, name, mime, bytes }` and a `preview` summary (pages, rows, columns, sheets, words). The full reference is the generated integration guide.

## Behaviour worth knowing

- **Duplicates**: the same file in the same folder of an app returns the existing record (`200`, `"duplicate": true`), so retries are safe.
- **Documents** are never re-encoded, so their bytes are the bytes you uploaded. The preview is read once at upload time and stored on the record, capped at roughly 40 rows, 60 paragraphs or 80 archive entries, so listing them never touches the bucket. PDFs and text are served `Content-Disposition: inline` and open in the browser; everything else is served as an attachment. Macro-enabled OOXML (`.xlsm`, `.docm`) and OpenDocument are refused with `415 unsupported_document`, because storing them under a `.xlsx` or `.zip` name would hand the owner back a file their office suite no longer opens.
- **The 97-2003 formats** (`.doc`, `.xls`, `.ppt`) are compound files. The container is read for the document properties — title, author, page, word and slide counts, and whether the file carries VBA, which the library flags — but their bodies are not parsed, so there is no text preview. They are stored and served like any other file.
- **Archives** are off per app until you turn them on, because the bucket is public and the URL hands over everything inside. The preview reads only the central directory, so nothing is ever decompressed to list an archive and a ZIP bomb has nothing to explode into.
- **SVG** never reaches storage as uploaded. It goes through an element and attribute allowlist first: scripts, event handlers, `foreignObject`, entity declarations and any reference that is not a document anchor or a `data:` image are removed, and the library records what was taken out. The cleaned vector is published next to the raster sizes, and those sizes are rendered at a resolution that suits each one rather than at the SVG's nominal size, so a 24 px icon still fills a 1600 px variant.
- **Settings** only affect new uploads.
- **Load**: at most `MAX_CONCURRENT_JOBS` images are processed at once and `MAX_QUEUE` wait, then the API answers `503 busy`. On a CAX11 keep 2 jobs and 2 sharp threads. AVIF is several times slower than WebP on ARM. Documents skip that queue: reading a preview costs a few milliseconds, no sharp involved.
- **Security**: API keys stored as SHA-256 hashes, per-app rate limit, pixel limit against decompression bombs, metadata stripped, SVG sanitized against an allowlist, URL imports blocked from private IP ranges, CSRF protection and login rate limit on the console, Helmet headers. File types are decided from the bytes, not the name or the declared type, and every entry a preview inflates out of an OOXML file is capped, so an archive cannot expand without bound.
- **HEIC**: the prebuilt sharp binary can't decode it, those uploads get `415 heic_not_supported`.
- **Deletes** remove files from the bucket, but CDN edges can serve cached copies until they expire.
- **Storage credentials** are encrypted with AES-256-GCM before they reach MongoDB, keyed from `STORAGE_KEY` (or `SESSION_SECRET` when that is unset). Changing that value makes stored secrets unreadable and the buckets have to be reconnected.
- **Per-object ACLs**: Cloudflare R2 and Backblaze B2 have none, so readability is a property of the whole bucket. On those providers an app that keeps original uploads exposes them as publicly as the optimized sizes; the dashboard says so where it matters.
- **Provider logos** are fetched from each provider's own site by `npm run fetch-logos` and written to `public/img/providers/<id>.(svg|png)`. Drop your own file there to override one. The directory is read at startup, so new files need a restart. Nothing external is fetched at request time.
- **Changing an app's bucket** only affects new uploads. Files already stored stay where they are, with the same URLs.
