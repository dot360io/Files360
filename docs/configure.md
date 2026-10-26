# Configure

Nothing has to be configured by hand: the setup wizard writes `data/config.json` and generates its own secrets. Environment variables are for deployments that want to decide things up front, and they always win over the file.

## Environment variables

| Variable | Default | What it does |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:4360` | The address people reach the service at. Used in the generated integration guides and `openapi.json`. |
| `HOST` / `PORT` | `127.0.0.1` / `4360` | Where to listen. The Docker image listens on `0.0.0.0`. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Holds `config.json`, `secrets.json` and the SQLite database. |
| `DATABASE_URL` | none | `sqlite:files360.sqlite`, `postgres://user:pass@host:5432/db` or `mysql://user:pass@host:3306/db`. When set, the wizard skips its database step. |
| `ADMIN_EMAIL` | none | With `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH`, creates the first administrator when the database has none. |
| `SESSION_SECRET` | generated | Signs the dashboard session cookie. |
| `STORAGE_KEY` | generated | Encrypts stored bucket credentials. Changing it makes them unreadable. |
| `APP_NAME` | `Files360` | The name shown in the dashboard and the guides. |
| `TIMEZONE` | `UTC` | The time zone the dashboard's daily chart counts in. |
| `MAX_UPLOAD_MB` | `25` | Hard limit for every app. Per-app limits can only be lower. |
| `MAX_INPUT_PIXELS` | `60000000` | Images above this many pixels are refused, a guard against decompression bombs. |
| `MAX_CONCURRENT_JOBS` | `2` | Images processed at once. |
| `MAX_QUEUE` | `50` | Images allowed to wait. Beyond that the API answers `503 busy`. Documents never queue. |
| `SHARP_THREADS` | `2` | libvips threads per image. |
| `API_RATE_LIMIT_PER_MIN` | `120` | Requests per minute per app. |

Storage is never configured in the environment. Buckets are connected in the dashboard, verified with a real round trip, and their secrets are encrypted before they reach the database.

## Apps

An app is one website or service that uploads. Each app has:

- **A folder**, fixed at creation. Every object it stores lives under `<folder>/` in the bucket.
- **Sizes.** Up to eight named variants, each with a width, a height or both, and a fit: `cover` (crop to fill), `contain` (pad), `inside` (fit within, keep ratio), `outside` (cover, keep ratio) or `fill` (stretch). Images are never upscaled.
- **Format and quality.** WebP, AVIF or JPEG.
- **Document and archive switches.** Documents are on by default; ZIP archives are off, because a public bucket serves whatever is inside them.
- **Keep original.** Stores the upload privately next to the sizes, on providers with per-object permissions.
- **A bucket,** or the default one.
- **API keys,** created on demand and shown once.

Changing settings only affects new uploads. Object keys contain a hash of the file and the settings, so existing URLs never change and can be cached for a year.

## Backups

Back up `DATA_DIR` and, if you use one, your Postgres or MySQL database. The files themselves are already in your bucket; the database is what knows which file belongs to which app.
