# Files360 — open source plan

Working document. Read [ARCHITECTURE.md](ARCHITECTURE.md) first for what the code
does today.

## Decisions already made

| | |
| --- | --- |
| **Name** | Files360 |
| **License** | AGPL-3.0 (`LICENSE` is in place) |
| **Repo** | New repo, fresh history. A clean start: no data, keys or API paths are carried over from any earlier install |
| **Default database** | SQLite. Postgres and MySQL optional |
| **First-run** | Setup wizard in the browser, not a hand-edited `.env` |

### Scope, decided

**It does:** one upload endpoint for images, documents and archives; image
optimization into configured variants; document storage with readable previews;
any S3-compatible bucket; media library with folders, search and bulk delete;
per-app API keys and settings; generated integration guides.

**Roadmap, not v1:**
- Docker Hub image alongside GHCR.
- Signed on-the-fly transform URLs (`/t/w_800,q_80/<id>.webp`) — the one feature
  that closes the gap with Cloudinary. Say so publicly; roadmaps attract contributors.
- Upload webhooks.
- More than one admin account, with roles.

**Never, and say so in the README:**
- Video transcoding.
- AI tagging, moderation or auto-alt-text.
- Being an object store itself. It writes to *your* bucket; it is not an S3 server.
- A hosted SaaS run by the maintainer. That is what AGPL is there to prevent.
- In-browser image editing.

Writing the "never" list down is what keeps the issue tracker sane.

---

## Done already (first migration pass)

- [x] Code copied to a clean folder, `.env` left behind. `.env` was never committed
      to the old repo's history either — verified.
- [x] AGPL-3.0 `LICENSE` added.
- [x] Renamed throughout: package name, PM2 app, session cookie, log prefix, user
      agent, storage probe key, `APP_NAME` default.
- [x] `TIMEZONE` default `Europe/Athens` → `UTC`.
- [x] Integration guide now suggests `FILES360_API_URL` / `FILES360_API_KEY`.
- [x] `ARCHITECTURE.md`, `AGENTS.md`, this plan.
- [x] `test/` seeded with the parser tests, fixtures and all, on `node:test`.

---

## Phase 1 — Housekeeping before anyone looks ✓

- [x] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` with a real contact.
      You accept arbitrary uploads; you will receive vulnerability reports.
      *Contact is GitHub private vulnerability reporting: switch it on in the repo
      settings when publishing. Add a security email to SECURITY.md if you want one.
      CONTRIBUTING asks for a DCO sign-off, which covers the licensing trap above.*
- [x] Issue and PR templates.
- [x] **API path is `/v1/files`.** No `/v1/images` alias: nothing was ever published
      under it.
- [x] API keys start `f360_`. Nothing else is accepted.
- [x] `utils/secretBox.js` SALT renamed to `files360.storage.v1` while no stored secret
      exists anywhere. From here on it never changes.
- [x] Genericise the examples that still say `drive360` / `transfer-360`.
- [x] Add Garage and SeaweedFS to the "Other S3-compatible" blurb in
      `utils/providers.js` — they already work through it, they just need naming
      so people find them. (Garage has no per-object ACLs, so an app that keeps
      original uploads should use a bucket where that is acceptable.)

## Phase 2 — Database portability ✓

The one invasive refactor: Mongoose out, SQL in.

- [x] **`db/` repository layer.** Controllers call `db.assets.list(...)`, never a
      model directly. This is what makes multiple engines possible without
      multiple code paths.
- [x] **Knex** as the query builder — one API over `postgres`, `mysql2` and
      `better-sqlite3`. Not a full ORM; the queries here are simple.
- [x] **Keep the ID shape:** generate `crypto.randomBytes(12).toString('hex')`, the
      same 24-hex format the routes already validate (`ID_RE`).
- [x] **JSON columns** for `variants` and `preview`. All three engines support JSON
      (SQLite via JSON1), so the nested shapes carry over nearly unchanged.
- [x] The 5 aggregations become `GROUP BY`:
      `libraryController` folder tree, `dashboardController` daily chart (watch
      timezone handling per engine), `appController` key counts, two in
      `bucketController`. *Times are epoch-ms `BIGINT`; the chart groups by UTC quarter
      hour, which lines up with every real offset, and folds into local days in JS.*
- [x] Sessions: `connect-mongo` → `connect-session-knex`, one table, all engines.
- [x] Schema migrations with `knex migrate`, run automatically at boot.
- [x] Rename `Image` → `Asset` and the collection/table to `assets` while you are
      in here. Do it now or never.

**Test matrix:** every test runs against SQLite, Postgres and MySQL in CI.
*`test/db.test.js` runs on in-memory SQLite and takes `TEST_DATABASE_URL` for the
other two; only SQLite has been run so far. Wiring the matrix into CI is Phase 5.*

~2–3 focused days.

## Phase 3 — Setup wizard ✓

Until this phase `config/env.js` threw at require time when a variable is missing, so the
app cannot boot far enough to show a wizard. That is the first thing to change.

- [x] **Bootstrap mode.** Required variables become optional; if any are missing
      and no config file exists, `config.setupNeeded = true`.
- [x] **`server.js`:** in setup mode, mount only the wizard and static assets.
      Everything else redirects to `/setup`; the API answers `503 setup_needed`.
      Finishing swaps the wizard for the app in place, without a restart.
- [x] **Generate `SESSION_SECRET` automatically** on first boot and persist it.
      Never ask a human for a random string. *Goes to `data/secrets.json` (0600) with a
      separate generated `STORAGE_KEY`, so rotating sessions never locks buckets away.*
- [x] **Steps:**
  1. **Database** — SQLite (default, no inputs), Postgres or MySQL with host, port,
     user, password, database and a **Test connection** button. Reuse the pattern
     from bucket verification: a real round trip that names the failing step.
     On success, run migrations.
  2. **Admin account** — email and password, bcrypt-hashed into the database.
     This moves the admin out of the environment entirely, which Docker wants anyway.
  3. **Storage** — reuse the existing provider picker and `storage.verify()`. Skippable.
  4. **First app** — name and slug only. No API key is generated here: keys are
     made on demand from the app's Keys tab, once the operator has read the guide.
- [x] **Persist to `data/config.json`**, not by rewriting `.env`: no parsing or
      escaping bugs, and it sits on the Docker volume. Environment variables keep
      priority, so an env-only deployment never sees the wizard.
- [x] **Lock it.** The wizard answers only while there is no config file *and* no
      admin row; afterwards it 404s. While open, require the one-time token printed
      to stdout at startup. An exposed, unauthenticated setup page is exactly how
      self-hosted apps get taken over, and "it's only open for a minute" is how it
      happens anyway. *Nothing is written until the last step, and the admin row last
      of all, so a failure or restart midway leaves the wizard able to try again.*
- [x] `scripts/hash-password.js` becomes optional, and `.env.example` shrinks a lot.
      *`ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` already create the first admin when the
      database has none (half of the Phase 4 env bootstrap); plain `ADMIN_PASSWORD` is
      still to do.*

## Phase 4 — Packaging ✓

- [x] Multi-stage `Dockerfile` on `node:22-slim` — **not** alpine, sharp's prebuilt
      binaries want glibc.
- [x] Multi-arch build, **amd64 and arm64**, published to `ghcr.io/dot360io/files360`
      on tag by `.github/workflows/docker.yml`.
- [x] `docker-compose.yml` — one service, one volume, SQLite, no database container.
      Plus `docker-compose.postgres.yml` and `docker-compose.mysql.yml`.
- [x] Healthcheck pointed at the existing `/health`.
- [x] Bootstrap from env when present (`ADMIN_EMAIL`, `ADMIN_PASSWORD` or
      `ADMIN_PASSWORD_HASH`), so an unattended deployment skips the wizard.

*Not built locally (no Docker on the dev machine): the CI `docker` job is the first
real build and boots the image into the wizard.*

> **Not doing:** baking Postgres into the application image. It loses data when the
> image is replaced, cannot be upgraded independently, and reviewers will flag it.
> SQLite-by-default already gives the "one command, no database" experience; compose
> gives a real database to anyone who needs one.

## Phase 5 — Tests and CI ✓

- [x] `test/pipeline.test.js`: ingest with storage mocked, dedupe, settings changing
      the folder, keep-original, documents, archives, SVG, the per-app gates, storage
      failure clean-up, delete.
- [x] GitHub Actions (`ci.yml`): Node 20/22/24, Postgres and MySQL repository tests,
      a Docker build that must boot into the wizard, docs drift check, MCP tests and
      `npm audit`. *sharp moved to 0.35.5 to clear its libvips advisories.*
- [x] `test/smoke.test.js` boots the server against SQLite and walks the wizard to a
      working API key.

## Phase 6 — README and docs ✓

- [x] **README order that converts:** one-line pitch → animated GIF of the upload
      dialog → "Run it in 30 seconds" → comparison table → features → *What it is
      not* → storage providers → sponsor. *GIF and sponsor line still to add, see
      `launch/README.md`.*
- [x] **Docs site:** Markdown in `docs/`, VitePress, deployed to files360.dev by
      `.github/workflows/docs.yml`. Install, Configure, Storage providers, API
      reference (generated from `utils/docs.js`), Migrating from Cloudinary, Security,
      AI agents, the comparison and a blog post.
- [ ] Screenshots of the library, the document previews and the settings page.
      *Deferred by decision; listed in the launch checklist.*

## Phase 7 — Positioning as the Cloudinary alternative ✓

- [x] GitHub description and topics: written in `launch/listings.md` with the `gh`
      command to apply them once the repository exists.
- [x] **Comparison table** against Cloudinary, imgix and Uploadcare in
      `docs/comparison.md`, with sources checked on 2026-10-16 and the rows where the
      hosted services win. *Re-check the Hetzner CAX11 price by hand.*
- [x] **`scripts/import-from-cloudinary.js`**: resumable, re-runnable, writes a
      `cloudinary-map.csv` for rewriting URLs. Not yet run against a real account.
- [x] "Migrating from Cloudinary" docs page mapping their transformations onto
      named variants.

## Phase 8 — Funding, done tastefully

- [ ] `.github/FUNDING.yml` → GitHub Sponsors button and Buy Me a Coffee.
      *At the end, once the accounts exist.*
- [x] **One source of truth for referrals:** `referral` on each entry in
      `utils/providers.js`; `npm run docs:generate` writes the storage table into the
      README and the docs site. All empty for now.
- [x] **Disclosure** sentence is generated under the table automatically as soon as
      any referral is set, and not before.
- [x] Referrals stay **out of the dashboard**: the app never reads the field.

## Phase 9 — Making AI agents know about it ✓

**So agents can use it:**
- [x] OpenAPI 3.1 from `utils/openapi.js`: `GET /openapi.json` on every instance and
      `docs/public/openapi.json` on the site. *JSON rather than YAML, which would
      have needed a YAML library; JSON is valid YAML anyway.*
- [x] `GET /llms.txt` served by the app, and `llms.txt` + `llms-full.txt` on the
      docs site, generated.
- [x] **MCP server** `files360-mcp` in `mcp/`, with an upload-folder restriction
      (`FILES360_UPLOAD_DIR`). *Publish to npm at release.*
- [x] `AGENTS.md`.
- [x] `integrations/` with a Claude skill and a Cursor rule.

**So agents recommend it:**
- [ ] Submit to `awesome-selfhosted`, `awesome-opensource-alternatives`,
      AlternativeTo, OpenAlternative, LibHunt. *Texts ready in `launch/listings.md`;
      awesome-selfhosted wants a release at least four months old.*
- [x] JSON-LD `SoftwareApplication` on the landing page (VitePress head).
- [x] Technical write-up: `docs/blog/hostile-uploads.md`, at
      files360.dev/blog/hostile-uploads.

## Phase 10 — Launch

- [ ] Tag `v1.0.0`, real release notes (`CHANGELOG.md` drafted), a 60-second demo GIF.
- [ ] r/selfhosted, Show HN, Lobsters: texts in `launch/posts.md`.
      Lead with the comparison and the one-command install, never the feature list.

---

## Minimum viable launch

Phases 1, 2, 4 and 6, plus a light pass at 7. Everything else can land after v1
while people are watching. The setup wizard (Phase 3) is what makes the difference
between a project people try and a project people abandon at step two — do not cut
it, but it can ship as v1.1 if Docker lands with sane environment defaults.

## Known traps

- **`secretBox.js` SALT** — see above. Never change it.
- **Timezone in the daily chart** — no time zone function means the same on all
  three engines. Bucket in SQL as UTC quarter hours and fold into local days in JS.
- **sharp on alpine** — use `node:22-slim`.
- **SQLite and concurrent writes** — enable WAL mode; the write load here is tiny,
  but the upload-and-update-stats path writes twice per file.
- **Published API paths never break** — `/v1/files` and its response fields are a contract.
