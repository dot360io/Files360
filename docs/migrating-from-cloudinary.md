# Migrating from Cloudinary

This guide moves an existing Cloudinary library into a Files360 app. Files are copied through the public Files360 API with `scripts/import-from-cloudinary.js`. That script also writes a mapping file, so you can rewrite the URLs your own database already holds.

## What moves and what does not

**Moves:**

- Images (JPEG, PNG, WebP, GIF, AVIF, TIFF, SVG). Each one is optimised into every size configured for the app.
- Raw files Files360 accepts as documents or archives (PDF, DOCX, XLSX, PPTX, CSV, TXT, ZIP and the 97-2003 Office formats, depending on the app's settings). They are stored byte for byte.
- Folder structure, mapped onto Files360 folder rules.
- The Cloudinary `public_id`, kept as each file's `ref` so you can find it again.

**Does not move:**

- **On-the-fly transformations.** Files360 renders a fixed set of named sizes when a file is uploaded. It does not build a new rendition from parameters in the URL. Signed transform URLs are on the roadmap, but until they arrive every size you need has to be configured on the app first.
- **Video and audio.** Files360 does not store video. The script lists these assets and reports them as skipped.
- **Private and authenticated assets.** They can only be downloaded with a signed URL, and the script lists `upload` delivery type assets only.
- **Tags, context metadata, moderation status and structured metadata.** Only the file, its folder and its `public_id` are carried over.
- **HEIC.** Files360 does not accept HEIC, so those uploads fail with `415` and are listed at the end of the run.

## Concept map

| Cloudinary | Files360 |
| --- | --- |
| Cloud (`cloud_name`) | A Files360 instance, with its own S3-compatible bucket |
| Upload preset, root folder | An app (one app folder, one set of sizes, one API key or more) plus an optional sub folder |
| Folder, `asset_folder` | `folder` on the file, up to 5 levels inside the app folder |
| `public_id` | `id` (assigned by Files360) plus `ref` (your own reference, here the old `public_id`) |
| Named transformations, eager transformations | Named variants configured per app, rendered once at upload |
| `f_auto`, `q_auto` | The app's output format (WebP, AVIF or JPEG) and quality setting |
| `secure_url` | `variants.<name>.url` for each size, plus `srcset` ready for an `<img>` tag; `file.url` for a document |
| Admin API listing | `GET /v1/files`, filtered by `folder` or `ref` |

## Mapping transformations onto variants

Look at the transformation strings your site actually uses (search your templates for `/upload/` URLs) and turn each distinct one into a variant on the app. A variant has a name, a width, a height and a fit.

| Cloudinary crop | Files360 fit | Notes |
| --- | --- | --- |
| `c_fill` | `cover` | Fills the box exactly and crops the overflow, centred. |
| `c_limit` | `inside` | Fits within the box, never upscaled. |
| `c_fit` | `inside` | Files360 never upscales, so `c_fit` and `c_limit` behave the same. |
| `c_pad` | `contain` | Fits within the box and pads the rest. |
| `c_scale` with width and height | `fill` | Stretches to the exact box, ignoring aspect ratio. |
| `c_scale` with one dimension | `inside` | Set only that dimension. |

Gravity options such as `g_face` or `g_auto` have no equivalent: cropped sizes are centred.

An example set of variants for a shop that used three Cloudinary transformations:

| Cloudinary transformation | Variant name | Width | Height | Fit |
| --- | --- | --- | --- | --- |
| `c_fill,w_320,h_320` | `thumb` | 320 | 320 | `cover` |
| `c_limit,w_800` | `medium` | 800 | | `inside` |
| `c_limit,w_1600` | `large` | 1600 | | `inside` |
| `c_pad,w_600,h_600,b_white` | `square` | 600 | 600 | `contain` |
| `f_auto,q_auto` | (app settings) | | | Output format WebP, quality 80 |

Cropped sizes (`cover`, `fill`) are left out of `srcset`, because their aspect ratio differs from the original.

Variants are part of the object key, so changing them later never rewrites a URL you have already published. Files uploaded after the change get the new sizes, and files already stored keep theirs.

## Step by step

### 1. Create the app and its variants

In the Files360 dashboard, create an app for the library and set its sizes, output format, quality and maximum upload size to match the table you drew up above. Do this **before** importing: sizes are rendered at upload time. If the library holds PDFs or ZIP files, turn on documents or archives on the app as well.

### 2. Generate an API key

Under the app, create a key and keep it somewhere safe; it is shown only once. Check it works:

```bash
curl -s "$FILES360_API_URL/v1/me" -H "Authorization: Bearer $FILES360_API_KEY"
```

### 3. Dry run

Your Cloudinary API environment variable is in the Cloudinary console under API Keys and looks like `cloudinary://<key>:<secret>@<cloud>`.

```bash
CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud> \
FILES360_API_URL=https://files.example.com \
FILES360_API_KEY=f360_... \
node scripts/import-from-cloudinary.js --type=all --dry-run
```

The dry run lists every asset and the Files360 folder it would land in, without calling Files360. Folder names are lowercased, anything other than `a-z`, `0-9`, `-` and `_` becomes `-`, empty segments are dropped, and the result is cut to 5 levels and 100 characters. If the mapping is not what you want, reorganise in Cloudinary first, or import one prefix at a time with `--prefix=`.

Listing uses the Cloudinary Admin API, which is rate limited per hour (500 calls an hour on the free plan). Each call returns up to 500 assets, so even a large library needs few calls. When the limit is hit, the script waits for the reset time Cloudinary reports and carries on.

### 4. Import

Run the same command without `--dry-run`:

```bash
node scripts/import-from-cloudinary.js --type=all --concurrency=3
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--prefix=folder/` | none | Only assets whose `public_id` starts with this |
| `--type=` | `image` | `image`, `raw`, or `all` (also lists video so it can be reported) |
| `--concurrency=` | `3` | Imports in parallel, 1 to 10. Keep it under your app's rate limit. |
| `--dry-run` | off | List only, nothing is imported |
| `--state=` | `.cloudinary-import.json` | Resume file |
| `--map=` | `cloudinary-map.csv` | Mapping file |
| `--restart` | off | List from the beginning again; files already done stay skipped |

Each asset is sent to `POST /v1/files/from-url` with its `secure_url`, the mapped folder and the `public_id` as `ref`. Responses `429`, `502`, `503` and `504` are retried with backoff. Permanent failures such as `415` (type not accepted) or `413` (too large) are logged and counted, and the run goes on. The run ends with a summary of imported, duplicates, skipped (video) and failed.

### 5. Rewrite your URLs

`cloudinary-map.csv` has one row per imported file:

| Column | Holds |
| --- | --- |
| `public_id` | The Cloudinary `public_id` |
| `resource_type` | `image` or `raw` |
| `files360_id` | The Files360 `id`; store it to fetch or delete the file later |
| `kind` | `image` or `document` |
| `primary_url` | The largest variant's URL for an image, `file.url` for a document |

Use it to update the URLs in your own database. For images, it is usually better to store the `id` and read the URL for each size from `GET /v1/files/:id`, or to replace each Cloudinary transformation in your templates with the matching variant. You can also look a file up by its old `public_id` with `GET /v1/files?ref=<public_id>`.

Values that start with `=`, `+`, `-` or `@` are written with a leading apostrophe, so a spreadsheet does not run them as formulas. Strip it if you read the file from code.

### 6. Switch over, then retire Cloudinary

Keep Cloudinary running until every URL in your database, templates, emails and cached pages points at Files360. Old links keep working until then. Once traffic to Cloudinary has stopped, run the script once more to pick up anything uploaded in the meantime, and only then delete the Cloudinary assets.

## FAQ

**Is it safe to run the script more than once?**
Yes. Files360 answers `200` with `"duplicate": true` for a file it already holds in the same folder, so nothing is stored twice. The state file also records the listing cursor and every `public_id` already done, so an interrupted run carries on from the last full page. Files that failed with a temporary error are retried first on the next run. Delete the state file to start over from scratch.

**What about private or authenticated Cloudinary assets?**
They are not covered. Files360 downloads from a public URL, and these assets need a signed delivery URL. Make them public for the duration of the import, or download them yourself and send them with `POST /v1/files`.

**Are SVG files safe to import?**
Yes. Every SVG is rewritten through a strict allowlist before it is stored and before it is rasterised, so scripts, event handlers, external references and entity declarations never reach your bucket. Raster sizes are rendered from the cleaned file.

**Why did my HEIC files fail?**
Files360 does not accept HEIC. Convert them to JPEG and upload them with `POST /v1/files`, or let Cloudinary deliver a JPEG by importing from a URL with `f_jpg` in it.

**Why are some files in a different folder from Cloudinary?**
Files360 folders allow lowercase `a-z`, `0-9`, `-` and `_` only, up to 5 levels and 100 characters. The dry run shows the mapping for every asset before anything is imported.

**Why are images that were small in Cloudinary still small?**
Files360 never upscales. A 600 px wide original stays 600 px wide in the larger sizes.
