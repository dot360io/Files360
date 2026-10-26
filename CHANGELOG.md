# Changelog

All notable changes to Files360. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [semantic versioning](https://semver.org): the `/v1/files` API and its response fields do not break within a major version.

## Unreleased

## 1.0.0 - 2026-10-26

The first public release.

### Upload API
- `POST /v1/files` for images, documents and ZIP archives, `POST /v1/files/from-url`, `GET /v1/files`, `GET /v1/files/{id}`, `DELETE /v1/files/{id}` and `GET /v1/me`.
- API keys of the form `f360_<prefix>_<secret>`, stored as SHA-256 hashes, rate limited per app.
- Deduplication: the same file in the same folder returns the first record with `"duplicate": true`.
- `/openapi.json` and `/llms.txt` on every instance.

### Images
- Named sizes per app in WebP, AVIF or JPEG with cover, contain, inside, outside and fill; a ready `srcset`; never upscaled; metadata stripped.
- SVG rewritten through an allowlist before it is stored or rasterized.
- Optional private copy of the original.

### Documents
- PDF, Word, Excel and PowerPoint (current and 97-2003), CSV and text, stored byte for byte with a preview read once at upload.
- ZIP archives, off per app by default, listed from the central directory without unpacking.

### Storage
- Any S3-compatible bucket, with presets for Hetzner, DigitalOcean, AWS, Cloudflare R2, Backblaze B2, Wasabi, Scaleway and MinIO, and a generic one for Garage, SeaweedFS and others.
- Every connection verified with a real write, public read and delete; credentials encrypted at rest.
- Immutable object keys containing a hash of the file and the render settings.

### Running it
- SQLite, Postgres or MySQL, with migrations at every start.
- First-run setup wizard, locked behind a one-time token.
- Docker image for amd64 and arm64, compose files for SQLite, Postgres and MySQL.
- Administrator from the environment for unattended deployments.

### Around it
- Media library with folders, search, sorting, bulk delete and document previews.
- Per-app integration guide, generated from the app's settings.
- `files360-mcp`, an MCP server for Claude, Cursor and other agents.
- `scripts/import-from-cloudinary.js` to bring an existing Cloudinary library across.
