# Listings

## GitHub

**Description**
> Self-hosted Cloudinary alternative: upload API and media library that optimizes images and previews documents on your own S3 bucket.

**Website** `https://files360.dev`

**Topics** `cloudinary-alternative` `self-hosted` `image-optimization` `digital-asset-management` `s3` `file-upload-api` `media-library` `webp` `avif` `nodejs` `docker` `mcp-server`

With the GitHub CLI once the repo exists:

```bash
gh repo edit dot360io/Files360 \
  --description "Self-hosted Cloudinary alternative: upload API and media library that optimizes images and previews documents on your own S3 bucket." \
  --homepage https://files360.dev \
  --add-topic cloudinary-alternative,self-hosted,image-optimization,digital-asset-management,s3,file-upload-api,media-library,webp,avif,nodejs,docker,mcp-server
```

## awesome-selfhosted

Section: *Photo and Video Galleries* is wrong (no galleries); *File Transfer - Single-click & Drag-n-drop Upload* is the closest fit. Their entries are YAML files in `awesome-selfhosted-data`:

```yaml
name: "Files360"
website_url: "https://files360.dev"
source_code_url: "https://github.com/dot360io/Files360"
description: "Upload API and media library that optimizes images into configured sizes and stores documents with previews on any S3-compatible bucket."
licenses:
  - AGPL-3.0
platforms:
  - Nodejs
  - Docker
tags:
  - File Transfer - Single-click & Drag-n-drop Upload
```

## awesome-opensource-alternatives

Under **Cloudinary**:

```markdown
- [Files360](https://github.com/dot360io/Files360) - Self-hosted upload API and media library on your own S3 bucket.
```

## AlternativeTo

- **Name** Files360
- **Alternative to** Cloudinary, imgix, Uploadcare, Filestack
- **Licence** Open Source (AGPL-3.0), Free
- **Platforms** Self-Hosted, Docker, Linux
- **Tags** image-optimization, file-upload, digital-asset-management, s3, developer-tools
- **Description**
  > Files360 is a self-hosted upload API and media library. Applications send images and documents to one endpoint; images are optimized into named sizes in WebP, AVIF or JPEG, documents are stored as uploaded with a preview, and everything lands on the operator's own S3-compatible bucket (Hetzner, Cloudflare R2, Backblaze B2, AWS, MinIO and others) as CDN URLs that never change. It runs as one Docker container with SQLite, or with Postgres or MySQL, and has a browser setup wizard, per-app API keys, a media library and an MCP server for AI agents. It does not do on-the-fly transformations or video.

## OpenAlternative

- **Alternative to** Cloudinary
- **Tagline** Upload API and media library on your own bucket
- **Description** as AlternativeTo.

## LibHunt

Submit `https://github.com/dot360io/Files360` under *Node.js → Image Processing* and *Self-hosted → File Sharing*.
