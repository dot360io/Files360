# Launch posts

## Show HN

**Title**
> Show HN: Files360 – Self-hosted Cloudinary alternative that writes to your own S3 bucket

**Text**
> Files360 is an upload API and media library you run yourself. Your backend sends a file to one endpoint; images come back optimized into the sizes you configured (WebP, AVIF or JPEG, with a srcset), documents are stored as uploaded with a preview, and everything lives in your own S3-compatible bucket with URLs on your own domain. It is never in the read path, so delivery costs are whatever your bucket and CDN charge (zero egress on R2, 1 TB included on Hetzner).
>
> It does less than Cloudinary on purpose. There are no on-the-fly transformation URLs yet (signed ones are next on the roadmap), no video and no AI tagging. The comparison page says where the hosted services win: https://files360.dev/comparison
>
> Some details HN might care about: file types are decided from bytes; the ZIP, compound-file and SVG parsers behind document previews are hand-written, dependency-free and capped, because they parse hostile input (write-up: https://files360.dev/blog/hostile-uploads); object keys contain a hash of the file and the render settings, so URLs are immutable and cache for a year; it runs on SQLite by default, or Postgres/MySQL, and a first-run wizard is locked behind a token printed to the server log.
>
> `docker compose up` gets you running: https://files360.dev/install. AGPL-3.0, Node.js, no telemetry. There is also an MCP server so agents can upload directly.
>
> I would especially like feedback on the API shape before it is frozen, and from anyone who has migrated off Cloudinary.

## r/selfhosted

**Title**
> Files360: self-hosted upload API and media library for your apps, writes to your own S3 bucket (Docker, SQLite, no telemetry)

**Text**
> I built Files360 to replace Cloudinary for the apps I run. It is one Docker container: your apps upload images and documents to it, it optimizes images into the sizes you set per app and stores documents with a preview, and it writes everything to a bucket you own (Hetzner, R2, B2, Wasabi, MinIO, Garage, SeaweedFS, AWS…). Browsers fetch files straight from the bucket or your CDN, never through the container.
>
> - `docker compose up -d`, then a setup wizard in the browser (database, admin, storage, first app). SQLite by default; compose files for Postgres and MySQL included.
> - Media library with folders, search and previews of spreadsheets, Word files, decks and ZIPs.
> - Per-app API keys, sizes, formats and limits, and a generated integration guide per app.
> - amd64 and arm64 images, runs happily on a Hetzner CAX11.
> - No telemetry, no phoning home, AGPL-3.0.
>
> What it is not: no video, no AI tagging, no on-the-fly transformation URLs yet, not an S3 server itself.
>
> Docs: https://files360.dev · Code: https://github.com/dot360io/Files360

## Lobsters

**Title** Files360: a self-hosted upload API with hand-written, capped parsers for hostile uploads
**URL** https://files360.dev/blog/hostile-uploads
**Tags** `release` `security` `javascript`
