# {{SERVICE_NAME}} API for {{APP_NAME}}

Integration guide generated on {{DATE}}. The values below (folder, sizes, limits) are the current settings of the **{{APP_NAME}}** app.

## Contents

1. How it works
2. Authentication
3. Your configuration
4. Endpoints
5. Code examples
6. Errors
7. Good practices

---

## 1. How it works

Your backend sends a file to the API. For an **image** the service:

1. checks the file and fixes its rotation,
2. creates every size configured for your app in {{FORMAT}},
3. removes metadata (EXIF, GPS),
4. stores the files on the CDN under your folder `{{FOLDER}}/`,
5. answers with the public CDN URL of every size.

For a **document** ({{DOC_LIST}}) nothing is re-encoded. The file is stored as it arrived, under the same folder, and you get back one public URL plus a short summary of what is inside it (pages, rows, slides, words).

**SVG** is the exception on the image side: it is rewritten through a strict allowlist first, so scripts, event handlers, external references and entity declarations never reach storage. What is published is the cleaned vector plus the usual raster sizes, drawn at whatever resolution each size needs.

You store the returned `id` and URLs in your own database and use the URLs directly in your pages or apps. File requests go straight to the CDN, never through this API.

Every response has a `kind` field, `"image"` or `"document"`. Check it before you read `variants`.

| | |
| --- | --- |
| API base URL | `{{BASE_URL}}/v1` |
| CDN base URL | `{{CDN_BASE}}` |
| Your folder | `{{FOLDER}}` |

## 2. Authentication

Every request needs your API key in the `Authorization` header:

```
Authorization: Bearer img_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`X-API-Key: <key>` is accepted as well.

- Keys are created in the {{SERVICE_NAME}} dashboard and shown **only once**. Store the key in an environment variable or secret manager.
- Use keys **only from your server**. Never put a key in browser JavaScript, a mobile app bundle or a public repository. Browsers and apps upload to your backend, and your backend calls this API.
- To rotate a key: create a new key in the dashboard, deploy it, then revoke the old one.

Suggested environment variables:

```
FILES360_API_URL={{BASE_URL}}
FILES360_API_KEY=img_...
```

Test the connection:

```bash
curl -s "$FILES360_API_URL/v1/me" -H "Authorization: Bearer $FILES360_API_KEY"
```

## 3. Your configuration

Every upload produces these sizes:

{{VARIANTS_TABLE}}

Images are never upscaled, so a size can come out smaller than its box. A 600 px wide photo stays 600 px wide in the larger sizes.

| Setting | Value |
| --- | --- |
| Output format | {{FORMAT}} |
| Quality | {{QUALITY}} |
| Max file size | {{MAX_MB}} MB |
| Max resolution | {{MAX_MP}} megapixels |
| Accepted images | JPEG, PNG, WebP, GIF, AVIF, TIFF, SVG |
| Accepted documents | {{DOCUMENTS}} |
| Accepted archives | {{ARCHIVES}} |
| Original kept | {{KEEP_ORIGINAL}} |
| Rate limit | {{RATE}} requests per minute |

HEIC files from iPhones are not accepted. Web browsers on iOS usually convert photos to JPEG when uploading through a file input. Native apps should export JPEG before sending.

Settings can change over time. Call `GET /v1/me` to read the current configuration from code.

## 4. Endpoints

| Method | Path | What it does |
| --- | --- | --- |
| `GET` | `/v1/me` | Returns your app configuration. Use it to test a key. |
| `POST` | `/v1/images` | Uploads a file (multipart): an image is optimized, a document is stored as is. |
| `POST` | `/v1/images/from-url` | Downloads a file from a public URL and handles it the same way. |
| `GET` | `/v1/images` | Lists your files, newest first. |
| `GET` | `/v1/images/:id` | Returns one file. |
| `DELETE` | `/v1/images/:id` | Deletes a file and everything stored for it. |

### Upload a file

`POST /v1/images` with `multipart/form-data`:

| Field | Required | Description |
| --- | --- | --- |
| `file` | yes | The image or document file. |
| `folder` | no | Sub folder inside your app folder, e.g. `products` or `users/avatars`. Lowercase `a-z`, `0-9`, `-`, `_`, up to 5 levels. |
| `ref` | no | Your own reference, e.g. a product or user id (max 120 characters). Lets you find files later with `GET /v1/images?ref=`. |

```bash
curl -X POST "$FILES360_API_URL/v1/images" \
  -H "Authorization: Bearer $FILES360_API_KEY" \
  -F "file=@./IMG_2231.jpg" \
  -F "folder=products" \
  -F "ref=product-1042"
```

Response `201 Created`:

```json
{{EXAMPLE_RESPONSE}}
```

- `variants.<size>.url` is the public CDN URL of each size.
- `srcset` is ready to use in an `<img>` tag. Cropped sizes are left out because their aspect ratio differs.
- Uploading the **same file into the same folder again** returns the existing record with status `200` and `"duplicate": true`. Retrying an upload is always safe.

### Upload a document

{{DOCUMENTS_INTRO}}

```bash
curl -X POST "$FILES360_API_URL/v1/images" \
  -H "Authorization: Bearer $FILES360_API_KEY" \
  -F "file=@./rental-terms.pdf" \
  -F "folder=contracts" \
  -F "ref=booking-5521"
```

Response `201 Created`:

```json
{{DOCUMENT_RESPONSE}}
```

- `file.url` is the public CDN URL. It is the only URL a document has: there are no sizes and no `srcset`.
- The file is byte for byte the one you sent. PDFs open in the browser, the other types download.
- `preview` is a summary read once at upload time. Its fields depend on the type:

| Type | What `preview` holds |
| --- | --- |
| PDF | `pages` |
| XLSX, CSV | `rows`, `columns`, and `sheets` for a workbook |
| DOCX | `words`, paragraph count |
| PPTX | `slides` |
| TXT | `lines` |
| ZIP | `entries`, `unpackedBytes` |
| DOC, XLS, PPT | `pages`, `words`, `slides` when the file carries document properties, plus `macros: true` when it holds VBA |

The 97-2003 formats are stored and served like any other file; only their properties are read, so the library shows a summary card rather than the contents.
- The last part of the URL is your file name, cleaned up to lowercase letters, digits, `.`, `-` and `_`.

### Import from a URL

`POST /v1/images/from-url` with a JSON body. Useful for migrating files you already host somewhere.

```bash
curl -X POST "$FILES360_API_URL/v1/images/from-url" \
  -H "Authorization: Bearer $FILES360_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/photo.jpg", "folder": "products", "ref": "product-1042"}'
```

The URL must be public (http or https). Images and documents both work: what comes back is decided by the bytes that arrive, not by the extension in the URL. The response is the same as for a file upload.

### List files

`GET /v1/images?page=1&limit=50&folder=products&ref=product-1042`

All parameters are optional. `limit` goes up to 200. Images and documents come back in the same list, told apart by `kind`.

```json
{ "page": 1, "limit": 50, "total": 132, "items": [ { "id": "...", "variants": { } } ] }
```

### Get one file

`GET /v1/images/:id` returns the same object as the upload, image or document.

### Delete a file

```bash
curl -X DELETE "$FILES360_API_URL/v1/images/66f1c2a9e4b0a1d2c3f4e5a6" \
  -H "Authorization: Bearer $FILES360_API_KEY"
```

Response `204 No Content`. Every size, or the document itself, is removed from storage. Copies already cached by the CDN edge can stay reachable for a short time.

## 5. Code examples

### Node.js 20+: upload a file from disk

```js
const fs = require('node:fs/promises');
const path = require('node:path');

async function uploadImage(filePath, { folder, ref } = {}) {
  const form = new FormData();
  form.append('file', new Blob([await fs.readFile(filePath)]), path.basename(filePath));
  if (folder) form.append('folder', folder);
  if (ref) form.append('ref', ref);

  const res = await fetch(process.env.FILES360_API_URL + '/v1/images', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.FILES360_API_KEY },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error.code + ': ' + data.error.message);
  return data;
}

uploadImage('./IMG_2231.jpg', { folder: 'products', ref: 'product-1042' })
  .then((image) => console.log(image.variants.{{V_LARGE}}.url));
```

### Node.js with Express: forward a user upload

The browser uploads to your app as usual, your route forwards the file.

```js
const express = require('express');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: {{MAX_MB}} * 1024 * 1024 },
});

const router = express.Router();

router.post('/products/:id/photos', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo received' });

  const form = new FormData();
  form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
  form.append('folder', 'products');
  form.append('ref', req.params.id);

  const apiRes = await fetch(process.env.FILES360_API_URL + '/v1/images', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.FILES360_API_KEY },
    body: form,
  });
  const image = await apiRes.json();
  if (!apiRes.ok) return res.status(apiRes.status).json(image);

  // Save what you need on your own record, for example with Mongoose:
  // await Product.updateOne(
  //   { _id: req.params.id },
  //   { $push: { photos: { imageId: image.id, {{V_SMALL}}: image.variants.{{V_SMALL}}.url, {{V_LARGE}}: image.variants.{{V_LARGE}}.url, srcset: image.srcset } } }
  // );

  res.status(201).json(image);
});

module.exports = router;
```

### Node.js: delete when your record is deleted

```js
async function deleteImage(imageId) {
  const res = await fetch(process.env.FILES360_API_URL + '/v1/images/' + imageId, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + process.env.FILES360_API_KEY },
  });
  if (res.status !== 204 && res.status !== 404) {
    const data = await res.json();
    throw new Error(data.error.message);
  }
}
```

### PHP (WordPress, Laravel or plain PHP) with cURL

```php
<?php
function upload_image(string $path, string $folder = '', string $ref = ''): array
{
    $fields = ['file' => new CURLFile($path, mime_content_type($path), basename($path))];
    if ($folder !== '') $fields['folder'] = $folder;
    if ($ref !== '') $fields['ref'] = $ref;

    $ch = curl_init(getenv('FILES360_API_URL') . '/v1/images');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . getenv('FILES360_API_KEY')],
        CURLOPT_POSTFIELDS => $fields,
    ]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if ($body === false) {
        throw new RuntimeException('Image API unreachable: ' . curl_error($ch));
    }
    $data = json_decode($body, true);
    if ($status >= 400) {
        throw new RuntimeException($data['error']['code'] . ': ' . $data['error']['message']);
    }
    return $data;
}

$image = upload_image('/tmp/IMG_2231.jpg', 'products', 'product-1042');
echo $image['variants']['{{V_LARGE}}']['url'];
```

### HTML: responsive image

```html
<img
  src="https://.../{{V_LARGE}}.{{FORMAT_LOWER}}"
  srcset="(value of image.srcset)"
  sizes="(max-width: 768px) 100vw, 800px"
  width="1600" height="1200"
  loading="lazy"
  alt="Describe the image">
```

Set `width` and `height` from the returned size to avoid layout shift.

## 6. Errors

Errors always return JSON in this shape:

```json
{ "error": { "code": "file_too_large", "message": "File exceeds the {{MAX_MB}} MB limit" } }
```

Use `code` in your logic, show or log `message`.

| Status | Code | Meaning | Retry? |
| --- | --- | --- | --- |
| 400 | `missing_file` | No `file` field in the multipart body | No |
| 400 | `invalid_upload` | More than one file or a wrong field name | No |
| 400 | `invalid_folder` / `invalid_ref` | Folder or ref has invalid characters or length | No |
| 400 | `invalid_url` / `blocked_url` / `fetch_failed` | URL import could not download the file | No |
| 400 | `invalid_json` | JSON body could not be parsed | No |
| 401 | `missing_api_key` / `invalid_api_key` | Key missing, wrong or revoked | No |
| 403 | `app_disabled` | The app is disabled in the dashboard | No |
| 404 | `not_found` | Image does not exist or belongs to another app | No |
| 413 | `file_too_large` / `image_too_large` | Above {{MAX_MB}} MB or {{MAX_MP}} megapixels | No |
| 415 | `unsupported_image` / `unsupported_format` / `heic_not_supported` | Not an accepted image | No |
| 415 | `unsupported_document` | A recognised but unsupported document, e.g. .pptx, .doc or a macro-enabled workbook | No |
| 415 | `documents_disabled` | This app takes images only | No |
| 415 | `archives_disabled` | This app does not accept ZIP archives | No |
| 422 | `processing_failed` | The image is corrupt | No |
| 429 | `rate_limited` | More than {{RATE}} requests in a minute | Yes, after 60 s |
| 502 | `storage_error` | Storage did not accept the files | Yes, with backoff |
| 503 | `busy` | Too many images in the processing queue. Documents never queue | Yes, with backoff |
| 504 | `fetch_timeout` | URL import timed out | Yes |

For retries, wait 1 s, then 2 s, then 4 s, and stop after 4 attempts. Uploads are deduplicated, so a retry never creates a second copy.

## 7. Good practices

- **Store the id.** Save `id` together with the URLs you use, so you can delete the file when your record is deleted.
- **Branch on `kind`.** `image` gives you `variants` and `srcset`, `document` gives you `file.url`.
- **URLs never change.** They are cached for a year. To replace a file, upload the new one, save its URLs, then delete the old record.
- **Use folders for structure,** e.g. `products`, `users/avatars`, `events/2026`. Folders only group files, they have no permissions.
- **Use `ref`** to link files to your own records and find them with `GET /v1/images?ref=...`.
- **Keep uploads server side** and protect your own upload route (auth, size limit, rate limit).
- **Set a timeout** of about 60 seconds on upload requests. Large photos take a few seconds to process.
