---
layout: home

hero:
  name: Files360
  text: Upload API and media library on your own bucket
  tagline: Send a file, get CDN URLs. Images are optimized into the sizes you choose, documents are stored with a preview, and everything lands on storage you own. Self-hosted, open source, no per-transformation bill.
  actions:
    - theme: brand
      text: Run it in 30 seconds
      link: /install
    - theme: alt
      text: Compare with Cloudinary
      link: /comparison
    - theme: alt
      text: GitHub
      link: https://github.com/dot360io/Files360

features:
  - title: One endpoint for everything
    details: Images, PDFs, Office files, CSV, text and ZIP archives all go to POST /v1/files. File types are decided from the bytes, not the name.
  - title: Sizes, not URLs to remember
    details: Each app has named sizes in WebP, AVIF or JPEG. Every upload comes back with a URL per size and a ready srcset.
  - title: Your bucket, your CDN
    details: Hetzner, Cloudflare R2, Backblaze B2, AWS, Wasabi, DigitalOcean, Scaleway, MinIO, Garage or any S3 API. Files360 is never in the read path.
  - title: URLs that never change
    details: Object keys contain a hash of the file and the settings, so everything is cached for a year and never needs a purge.
  - title: A library you can actually browse
    details: Folders, search, bulk delete, and previews of what is inside a spreadsheet, a Word file, a deck or an archive.
  - title: Built for hostile input
    details: SVG allowlist, pixel limits, capped hand-written parsers, SSRF-guarded imports and a setup wizard locked behind a one-time token.
---

## Who is behind it

Files360 is built and maintained by [Dot360](https://dot360.io), a custom software studio. It started as the upload service behind our own products and is now open source under the AGPL. Issues and pull requests are answered by the people who write it. If you want help running Files360 or building on top of it, [talk to us](https://dot360.io).

## What it is not

Files360 does not transcode video, tag or moderate images with AI, act as an object store itself, or run as a hosted service. It does not edit images in the browser. On-the-fly transformation URLs are on the [roadmap](https://github.com/dot360io/Files360/blob/main/PLAN.md); today you configure named sizes per app.
