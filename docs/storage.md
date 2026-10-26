# Storage providers

Files360 writes to any bucket that speaks the S3 API. Presets fill in the endpoint, the region list and the public URL for the providers below, so connecting one is a bucket name and a key pair. Anything else works through **Other**.

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

**Other** covers Garage, SeaweedFS, Storj, iDrive e2, OVH, Linode, Google Cloud Storage with HMAC keys and anything else with an S3 endpoint. Self-hosted servers usually need path-style URLs, which the preset turns on.

## Making the bucket public

Files360 hands out public URLs and is never in the read path, so the bucket (or a CDN in front of it) must serve objects to anyone. Each provider's form says how. Saving a connection uploads a test file and fetches it back over the public URL, and warns if that fails.

## Providers without per-object permissions

Cloudflare R2, Backblaze B2 and Garage decide readability per bucket, not per file. On those, an app that keeps original uploads exposes the originals as publicly as the optimized sizes. Use a separate bucket for such an app if that matters.

## Moving an app to another bucket

Change the app's storage in its settings. New uploads go to the new bucket; everything already stored stays where it is, with the same URLs, because every record remembers the bucket it was written to. Deletes always go back to the right one.

## Checking every connection

```bash
npm run check-storage
```

Runs the same round trip against every connected bucket and exits non-zero if any fails, which suits a cron job or a monitoring check.
