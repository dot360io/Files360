# Files360

**Self-hosted upload API and media library. Send a file, get CDN URLs on your own bucket.**

Images are optimized into the sizes you choose, documents are stored with a readable preview, and everything lands on S3-compatible storage you own. The part of Cloudinary most projects actually use, without the per-transformation bill.

[Documentation](https://files360.dev) · [Install](https://files360.dev/install) · [API](https://files360.dev/api) · [Compared with Cloudinary](https://files360.dev/comparison)

<!-- TODO: animated GIF of the upload dialog, docs/public/demo.gif -->

## Run it in 30 seconds

```bash
curl -O https://raw.githubusercontent.com/dot360io/Files360/main/docker-compose.yml
docker compose up -d
docker compose logs files360 | grep setup
```

Open the link it prints. A setup wizard asks for the database (SQLite by default, nothing to install), an administrator, a storage bucket and a first app. Then:

```bash
curl -X POST https://files.example.com/v1/files \
  -H "Authorization: Bearer $FILES360_API_KEY" \
  -F "file=@photo.jpg" -F "folder=products"
```

```json
{
  "id": "66f1c2a9e4b0a1d2c3f4e5a6",
  "kind": "image",
  "variants": {
    "thumb":  { "url": "https://cdn.example.com/my-shop/products/3f9a…/thumb.webp",  "width": 320,  "height": 320 },
    "medium": { "url": "https://cdn.example.com/my-shop/products/3f9a…/medium.webp", "width": 800,  "height": 600 },
    "large":  { "url": "https://cdn.example.com/my-shop/products/3f9a…/large.webp",  "width": 1600, "height": 1200 }
  },
  "srcset": "…/medium.webp 800w, …/large.webp 1600w"
}
```

Postgres and MySQL compose files, running from source and reverse proxy setups are in the [install guide](https://files360.dev/install).

## How it compares

| | Files360 | Cloudinary | imgix | Uploadcare |
| --- | --- | --- | --- | --- |
| Cost | Your server and bucket | From $99/month | From $25/month | From $79/month |
| Where files live | Your bucket | Their storage | Your bucket | Their storage |
| URLs | Your domain, plain paths | Their syntax | Their parameters | Their syntax |
| On-the-fly transforms | No (roadmap) | **Yes** | **Yes** | **Yes** |
| Video, AI tagging | No | **Yes** | Partly | **Yes** |
| Documents with previews | **Yes** | PDFs | No | Conversion |
| CDN and operations | Yours to run | **Included** | **Included** | **Included** |

The hosted services win on transformations, video, AI and having nothing to run. Files360 wins on cost, ownership and lock-in. Prices checked on 2026-10-16; the [full comparison](https://files360.dev/comparison) has the sources and a worked monthly example.

## Features

- **One endpoint** for images, PDFs, Word, Excel, PowerPoint (current and 97-2003), CSV, text and ZIP. File types are decided from the bytes, never the name.
- **Named sizes per app** in WebP, AVIF or JPEG, with crop, fit and pad modes and a ready `srcset`. Never upscaled, metadata stripped.
- **Any S3-compatible bucket**: Hetzner, Cloudflare R2, Backblaze B2, AWS, Wasabi, DigitalOcean, Scaleway, MinIO, Garage, SeaweedFS. Connections are verified with a real write, public read and delete.
- **Immutable URLs.** Keys contain a hash of the file and the settings, so files are cached for a year and never need a purge. Files360 is never in the read path.
- **Media library** with folders, search, bulk delete, and previews of what is inside a sheet, a document, a deck or an archive.
- **Per-app API keys and settings**, and a generated integration guide for each app.
- **Deduplication**: the same file in the same folder returns the first record, so retries are safe.
- **Built for hostile input**: SVG allowlist, pixel limits, capped hand-written parsers, SSRF-guarded URL imports. See [Security](https://files360.dev/security).
- **SQLite, Postgres or MySQL**, a browser setup wizard, and a multi-arch Docker image.
- **Agent-ready**: an MCP server (`npx files360-mcp`), `/openapi.json` and `/llms.txt` on every instance. See [AI agents](https://files360.dev/agents).
- **Leaving Cloudinary?** `npm run import-cloudinary` pulls your library into your folders. See [Migrating from Cloudinary](https://files360.dev/migrating-from-cloudinary).

## What it is not

These are decisions, not gaps waiting for a pull request:

- **Not a video transcoder.**
- **No AI tagging, moderation or auto-alt-text.**
- **Not an object store.** It writes to *your* bucket; it is not an S3 server.
- **Not a hosted service.** There is no Files360 cloud, and the AGPL licence is there to keep it that way.
- **Not an image editor.** No in-browser cropping or filters.

On-the-fly transformation URLs (`/t/w_800,q_80/<id>.webp`), upload webhooks and multiple admin accounts are on the [roadmap](PLAN.md).

## Storage providers

<!-- providers:start -->
| Provider | | Regions | Per-object ACLs |
| --- | --- | --- | --- |
| [Hetzner Object Storage](https://www.hetzner.com) | European buckets, low egress cost. | fsn1, nbg1, hel1 | Yes |
| [DigitalOcean Spaces](https://www.digitalocean.com) | Spaces with the built-in CDN edge. | 9 regions | Yes |
| [Amazon S3](https://aws.amazon.com) | The original. Pair it with CloudFront if you want. | 17 regions | Yes |
| [Cloudflare R2](https://www.cloudflare.com) | No egress fees. Needs a public r2.dev or custom domain. | auto | Bucket-wide only |
| [Backblaze B2](https://www.backblaze.com) | Cheapest per TB, free egress through Cloudflare. | 6 regions | Bucket-wide only |
| [Wasabi Hot Cloud Storage](https://wasabi.com) | Flat pricing, no egress charges. | 12 regions | Yes |
| [Scaleway Object Storage](https://www.scaleway.com) | French provider, S3 compatible. | fr-par, nl-ams, pl-waw | Yes |
| [MinIO Self-hosted](https://min.io) | Your own S3 server. Path-style URLs. | your own endpoint | Yes |
| Other S3-compatible | Any provider with an S3 API: Garage, SeaweedFS, Storj, iDrive e2, OVH, Linode, GCS. | your own endpoint | Yes |
<!-- providers:end -->

## Development

```bash
npm install
npm run dev          # http://127.0.0.1:4360, prints a setup link on first run
npm test             # no database server or network needed
npm run docs:dev     # the documentation site
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing anything, and [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Security reports go through [private vulnerability reporting](https://github.com/dot360io/Files360/security/advisories/new), never public issues.

## Licence

[AGPL-3.0](LICENSE). © Dot360.
