---
name: files360
description: Upload images and documents to a self-hosted Files360 instance and get public CDN URLs back. Use when the user wants to upload, import, list or delete files on Files360, needs a CDN URL or a responsive srcset for an image, or is writing backend code that integrates with the Files360 API (/v1/files, f360_ keys, FILES360_API_URL).
---

# Files360

Files360 is a self-hosted upload API. Images are optimised into every size the app has configured; documents and archives are stored byte for byte with a short preview. Everything lands on the operator's own S3-compatible bucket and comes back as CDN URLs.

If the `files360_*` MCP tools are available, prefer them. Otherwise use the curl recipes below.

## Configuration

Two environment variables, both required:

```bash
FILES360_API_URL=https://files.example.com   # base address, no /v1
FILES360_API_KEY=f360_<12 hex>_<48 hex>
```

If either is missing, ask the user for it rather than guessing. Never print the key back, write it into a file that will be committed, or put it in browser or mobile code: browsers upload to the user's backend, and the backend calls Files360.

Every request sends `Authorization: Bearer $FILES360_API_KEY`. Errors are always JSON: `{ "error": { "code": "...", "message": "..." } }`. Branch on `code`, show `message` to the user.

## Recipes

Check the key and read the app's settings (formats, max size, configured sizes):

```bash
curl -s "$FILES360_API_URL/v1/me" -H "Authorization: Bearer $FILES360_API_KEY"
```

Upload a local file. `folder` and `ref` are optional:

```bash
curl -s -X POST "$FILES360_API_URL/v1/files" \
  -H "Authorization: Bearer $FILES360_API_KEY" \
  -F "file=@./photo.jpg" \
  -F "folder=products" \
  -F "ref=product-1042"
```

- `folder`: lowercase `a-z`, `0-9`, `-`, `_`, up to 5 levels separated by `/`, e.g. `users/avatars`.
- `ref`: the caller's own id for the record the file belongs to, up to 120 characters.

Import from a public URL (private and internal addresses are refused):

```bash
curl -s -X POST "$FILES360_API_URL/v1/files/from-url" \
  -H "Authorization: Bearer $FILES360_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/photo.jpg", "folder": "products"}'
```

List, newest first (`limit` up to 200; filter by `folder` or `ref`):

```bash
curl -s "$FILES360_API_URL/v1/files?page=1&limit=50&ref=product-1042" \
  -H "Authorization: Bearer $FILES360_API_KEY"
# { "page": 1, "limit": 50, "total": 132, "items": [ ... ] }
```

Get one, or delete one (delete answers `204` with no body and cannot be undone; confirm with the user first):

```bash
curl -s "$FILES360_API_URL/v1/files/$ID" -H "Authorization: Bearer $FILES360_API_KEY"
curl -s -X DELETE "$FILES360_API_URL/v1/files/$ID" -H "Authorization: Bearer $FILES360_API_KEY"
```

## Reading a response

Always check `kind` before reading anything else.

- `"image"`: `variants.<name>` has `url`, `width`, `height`, `bytes`, `format` for each configured size. `srcset` is ready for an `<img>` tag; cropped sizes are left out of it because their aspect ratio differs. SVG uploads also carry `file.url`, the sanitised vector.
- `"document"`: `file` has `url`, `name`, `mime`, `bytes`. There are no variants and no srcset. `preview` holds a summary such as `pages`, `rows`, `slides` or `words`.

Images are never upscaled, so a size can come out smaller than its name suggests. Use the returned `width` and `height`.

Responsive image:

```html
<img src="{variants.large.url}" srcset="{srcset}" sizes="(max-width: 768px) 100vw, 800px"
     width="{variants.large.width}" height="{variants.large.height}" loading="lazy" alt="...">
```

Store `id` alongside the URLs you use, so the file can be deleted when its record is. URLs never change and are cached for a year: to replace a file, upload the new one, switch to its URLs, then delete the old id.

## Duplicates

Uploading the same bytes into the same folder returns the existing record with status `200` and `"duplicate": true` instead of `201`. Retrying an upload is always safe. Mention a duplicate to the user rather than presenting it as a new upload.

## Errors worth handling

| Status | Code | What to do |
| --- | --- | --- |
| 400 | `invalid_folder`, `invalid_ref`, `missing_file`, `invalid_url`, `blocked_url`, `fetch_failed` | Fix the request; the message says how. |
| 401 | `missing_api_key`, `invalid_api_key` | The key is missing, wrong or revoked. Ask the user for a valid one. |
| 403 | `app_disabled` | The app is switched off in the dashboard. |
| 404 | `not_found` | Wrong id, or it belongs to another app. |
| 413 | `file_too_large`, `image_too_large` | Over the size or megapixel limit. Check `maxUploadMB` from `/v1/me`; resize or compress first. |
| 415 | `unsupported_image`, `unsupported_format`, `unsupported_document`, `heic_not_supported`, `documents_disabled`, `archives_disabled` | The type is decided from the bytes, so renaming will not help. Convert (HEIC to JPEG, for example) or tell the user the app does not accept it. |
| 429 | `rate_limited` | Wait 60 seconds, then retry. |
| 502 | `storage_error` | Retry with backoff. |
| 503 | `busy` | Image queue is full. Retry after 1, 2, then 4 seconds; stop after 4 attempts. |
| 503 | `storage_unconfigured` | No bucket is connected. The operator must add storage in the dashboard; retrying will not help. |

Use a timeout of about 60 seconds on uploads; large photos take a few seconds to process.
