# Files360 compared with Cloudinary, imgix and Uploadcare

This page compares self-hosted Files360 with three hosted media services:
Cloudinary, imgix and Uploadcare. They do not do the same job. The hosted services
transform images on request at the edge, and Files360 makes fixed sizes when a file
is uploaded. Every price was checked on **2026-10-16** from the public pages listed
under [Sources](#sources). Prices are in US dollars unless marked €, and Hetzner
prices exclude VAT. "Not published" means we could not find the figure in public,
not that it does not exist.

## At a glance

| | Files360 (self-hosted) | Cloudinary | imgix | Uploadcare |
|---|---|---|---|---|
| **Pricing model** | Free software. You pay for a server and a bucket. | Monthly plans with credits. 1 credit = 1 GB storage, 1 GB image bandwidth or 1,000 transformations. | Monthly plans with credits. 1 credit/GB delivered, 2 credits/GB/month cached, transformations "vary by feature". | Monthly plans with included operations, storage and traffic. Metered overage beyond them. |
| **Free tier** | All of it. The software has no limits. | 25 credits/month, 3 users. | No free plan. 30-day trial with 100 credits. | 1,000 operations, 1 GB storage, 5 GB traffic. Suspended until next month if you go over. |
| **Entry paid plan** | Not applicable. See the worked example for running costs. | Plus: $99/month ($89 annual), 225 credits. | Starter: $25/month, 100 credits (up to 50 GB media, 100 GB delivery). | Pro: $79/month ($66 annual), 5,000 operations, 10 GB storage, 25 GB traffic. |
| **What you pay for at scale** | Bucket storage and egress at your provider's rates, plus a bigger server if uploads outgrow it. | Credits. Pro PAYG costs $1,099/month for 2,750 credits, then $0.45 per credit. Free, Plus and Advanced have no published overage rate: you get warnings, then the account is disabled. | Credits. Plans run up to Growth Plus at $500/month for 3,570 credits. Overages exist, but the rate is not published. | Overage on Business: $0.80 per 1,000 operations, $0.25/GB storage, $0.25/GB traffic. |
| **Egress / bandwidth** | Your bucket's rate. Zero on Cloudflare R2, 1 TB included on Hetzner. See the storage costs section. | 1 credit per GB of images. Video gets 2 GB per credit on paid plans. | 1 credit per GB. | Included up to the plan limit, then per GB. |
| **Where files live** | Your bucket, in your account, on any S3-compatible provider. | Cloudinary's storage. Paid plans can back up to S3. | Your own origin bucket. imgix caches and serves the files. | Uploadcare's storage. Your own AWS S3 is an Enterprise feature. |
| **Lock-in** | Low. URLs point at your bucket or CDN domain, and the files are plain objects you already own. | High. URLs contain `res.cloudinary.com/<cloud>/...` and transformation syntax. A custom domain (CNAME) needs Advanced or above. Export is through their API. | Medium. Files stay in your bucket, but every URL carries imgix parameters. | High. Files sit in their storage and URLs use their CDN and operation syntax. A custom CDN CNAME costs $25/month on Pro. |
| **On-the-fly transformations** | **No.** Sizes are fixed per app and made at upload. Signed transform URLs are on the roadmap, not shipped. | **Yes**, and very extensive. They win here. | **Yes.** This is the core product. They win here. | **Yes**, through URL operations. They win here. |
| **Video** | **No**, and none is planned. | **Yes**: transcoding and adaptive streaming on every tier. They win here. | Some: resizing, cropping and image-to-video. | **Yes**: adaptive streaming and video processing. They win here. |
| **AI features** | **None**, and none are planned. | Auto-tagging, paid add-ons, DAM keywording. They win here. | Tags, alt text, generative edits and background removal. They win here. | Auto-tagging, unsafe content detection, background removal and content-aware crop. They win here. |
| **Documents and previews** | PDF, Word, Excel, PowerPoint (current and 97-2003), CSV, text and ZIP, stored as uploaded with a readable preview in the library. | Stores PDFs and raw files. Can render PDF pages as images. | Images first. Document support is not published on the pricing page. | Stores any file. Document conversion costs 100 operations per 50 MB. |
| **Global CDN** | **Not included.** You add one, such as Cloudflare in front of R2 or a CDN in front of your bucket. | Included. Multi-CDN on Enterprise. | Included. | Included. |
| **Support / SLA** | Community support through GitHub issues. No SLA. | Ticket support on every plan. Expedited on Plus. Enterprise SLAs. | Not published on the pricing page. | 99.9% SLA on all paid plans. |
| **Hosting / ops burden** | **Yours.** Server, updates, TLS, database backups and monitoring. | None. | Very little: you keep an origin bucket. | None. |
| **Licence** | AGPL-3.0 | Proprietary SaaS | Proprietary SaaS | Proprietary SaaS |

The short version: Files360 costs less and keeps the files in your account. The
hosted services do more and you do not have to run them. If you need images resized
on request, video, AI features or someone to call at 3 a.m., they are the better
choice, and this page does not pretend otherwise.

## Object storage costs for the self-hosted path

| Provider | Storage | Egress | Notes |
|---|---|---|---|
| Hetzner Object Storage | €6.49 ($7.99) per month includes 1 TB, then €6.26/TB-month | 1 TB included, then €1/TB | API calls and ingress are free. Objects smaller than 64 KB are billed as 64 KB. EU regions only. |
| Cloudflare R2 | $0.015/GB-month = $15/TB. First 10 GB free. | **Free** | Class A requests $4.50 per million, Class B $0.36 per million. First 1M Class A and 10M Class B free. |
| Backblaze B2 | $6.95/TB-month. First 10 GB free. | Free up to 3× what you store, then $0.01/GB = $10/TB | Egress through Cloudflare, Fastly, bunny.net and other partners is free. |

## Worked example

The workload: **50 GB stored, 500 GB delivered a month, 20,000 uploads a month**,
all images.

Assumptions:
- Each upload produces three sizes. The hosted services count each derived version
  as a transformation.
- The bucket holds originals and sizes.
- Delivered bytes are the same for every option, because all of them serve WebP or
  AVIF.

**Files360 on Hetzner.** CAX11 (2 Arm vCPU, 4 GB RAM, 40 GB disk, 20 TB traffic):
€5.99, plus €0.50 for an IPv4 address. The bucket costs €6.49, and 50 GB stored and
500 GB egress both fit inside its 1 TB allowances.
**Total: €12.98/month excluding VAT.** Two caveats:
- A Hetzner bucket sits in one EU region with no CDN in front. Adding one costs extra.
- 20,000 uploads is about 670 a day. That is comfortable for a CAX11 with two sharp
  jobs. AVIF on Arm is several times slower than WebP.

**Files360 with Cloudflare R2.** The CAX11 costs €6.49 as above. R2 storage is
(50 − 10 free) × $0.015 = $0.60. Writes are 20,000 × 4 objects = 80,000 Class A
requests, inside the free million. Reads at an average of about 100 KB per image are
5 million Class B requests, inside the free 10 million.
**Total: about €6.49 + $0.60/month**, served through Cloudflare's network.

**Cloudinary.** 50 credits for storage + 500 for bandwidth + 60 for transformations
(60,000 ÷ 1,000) = **610 credits**. Advanced includes 600 credits for $249/month
($224 annual), so it is just short. Two ways out: trim to two sizes, which brings
the total to 590 credits, or accept warnings, since no overage rate is published.
The next plan with metered overage is Pro PAYG at $1,099/month.
**Realistic figure: $249/month**, at the limit.

**imgix.** 500 credits for delivery + about 100 for 50 GB of cache (2 × 50) = 600,
plus transformation credits, whose rate is not published. Basic (375 credits) is too
small. **Midrange: $150/month** ($125 annual) gives 830 credits. You also keep and
pay for the origin bucket, which adds about €6.49 on Hetzner. imgix does not take
uploads in this setup, so your app writes to the bucket itself.

**Uploadcare Business** ($199/month):
- Storage: 50 GB, which the plan includes.
- Traffic: (500 − 125) × $0.25 = $93.75.
- Operations: each upload under 100 MB costs 3 (request, size, virus scan), so
  20,000 uploads = 60,000. First renders of 3 sizes add 60,000 more, or 120,000 if
  they are AVIF. That makes 120,000–180,000 operations; minus the 50,000 included,
  the overage is 70,000–130,000 × $0.80 per 1,000 = $56–$104.
- **Total: about $349–$397/month.** Pro works out dearer at this volume because its
  traffic and operations cost more per unit.

| Option | Monthly cost for this workload |
|---|---|
| Files360 + Hetzner bucket | €12.98 (no CDN) |
| Files360 + Cloudflare R2 | about €6.49 + $0.60 |
| imgix Midrange + origin bucket | $150 + about €6.49 |
| Cloudinary Advanced | $249, at the credit limit |
| Uploadcare Business | about $349–$397 |

What the self-hosted figures leave out: your time. Someone has to set up the server,
apply updates, back up the database, watch disk and queue limits and answer the
pager. If that is an hour a month at a normal contractor rate, the gap with imgix
narrows considerably. Also, the hosted figures include features that Files360 does
not have at any price.

## When to choose something else

- **You need arbitrary sizes on request.** That covers responsive `srcset` for any
  width, art direction and smart crops chosen in the template. Files360 only serves
  the sizes you configured, and changing them does not regenerate old files. Choose
  imgix or Cloudinary.
- **You handle video.** Files360 will not transcode video, now or later. Choose
  Cloudinary, Uploadcare or a dedicated video service.
- **You want AI features.** That means auto-tagging, moderation, alt text,
  background removal or generative fill. Files360 will not add them.
- **You want zero ops.** If nobody on the team wants to own a server, a hosted
  service is cheaper than the time.
- **You need an SLA, support contracts, SSO or compliance paperwork.** The hosted
  services sell these, and Files360 is a community project.
- **Your audience is global and you do not want to assemble a CDN.** The hosted
  services include one. With Files360 you bring your own.
- **Your volume fits in a free tier.** If 25 Cloudinary credits or Uploadcare's
  free plan covers you, that may be simpler than running anything.

Files360 fits best when you want files in a bucket you own, URLs that never change,
predictable costs at your storage provider's rates, document previews alongside
images, and no per-transformation billing. In return you give up on-request
transforms and run the service yourself.

## Sources

All checked 2026-10-16 unless noted.

- Cloudinary plans and credits: https://cloudinary.com/pricing
- Cloudinary overage behaviour and Pro PAYG: https://cloudinary.com/documentation/pricing.md
- imgix plans and credit rates: https://www.imgix.com/pricing
- imgix credit consumption (per-feature transformation credits not shown in public
  text): https://www.imgix.com/credit-consumption
- imgix overages are mentioned but not priced: https://www.imgix.com/blog/credit-pricing
  (post dated 2025-11-14)
- Uploadcare plans, overage and SLA: https://uploadcare.com/pricing/
- Uploadcare operation counting: https://uploadcare.com/docs/billing/
- Hetzner Object Storage price and allowances, read from the page's embedded price
  calculator data: https://www.hetzner.com/storage/object-storage/
- Hetzner Object Storage billing rules: https://docs.hetzner.com/storage/object-storage/overview/
- Hetzner CAX11 at €5.99 + €0.50 IPv4. Hetzner's own page loads prices with a
  script, so this comes from secondary sources: https://kimmo.suominen.com/stuff/cpc-2026-08.txt
  (retrieved early August 2026) and
  https://privatedevops.com/news/hetzner-june-2026-cloud-price-increase-what-to-do
  (€4.49 → €5.99 from 2026-06-15). Confirm at https://www.hetzner.com/cloud/cost-optimized/
- Cloudflare R2: https://developers.cloudflare.com/r2/pricing/
- Backblaze B2: https://www.backblaze.com/cloud-storage/pricing
