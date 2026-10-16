# Files360 — open source plan

Working document. Read [ARCHITECTURE.md](ARCHITECTURE.md) first for what the code
does today.

## Decisions already made

| | |
| --- | --- |
| **Name** | Files360 |
| **License** | AGPL-3.0 (`LICENSE` is in place) |
| **Repo** | New repo, fresh history. No code is shared with the private instance — same codebase, one upstream |
| **Default database** | SQLite. Postgres and MySQL optional |
| **First-run** | Setup wizard in the browser, not a hand-edited `.env` |

### Scope, decided

**It does:** one upload endpoint for images, documents and archives; image
optimization into configured variants; document storage with readable previews;
any S3-compatible bucket; media library with folders, search and bulk delete;
per-app API keys and settings; generated integration guides.

**Roadmap, not v1:**
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
- [x] `utils/secretBox.js` SALT **deliberately left as the old string**, with a
      comment. Changing it makes every stored bucket secret unreadable.
- [x] `ARCHITECTURE.md`, `AGENTS.md`, this plan.
- [x] `test/` seeded with the parser tests, fixtures and all, on `node:test`.

---

## Phase 1 — Housekeeping before anyone looks

- [ ] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` with a real contact.
      You accept arbitrary uploads; you will receive vulnerability reports.
- [ ] Issue and PR templates.
- [ ] **Rename the API path.** `/v1/files` becomes canonical, `/v1/images` stays
      forever as an alias. One router line; the work is in the docs template.
- [ ] API key prefix `img_` → `f360_`, accepting both on lookup.
- [ ] Genericise the examples that still say `drive360` / `transfer-360`.
- [ ] Add Garage and SeaweedFS to the "Other S3-compatible" blurb in
      `utils/providers.js` — they already work through it, they just need naming
      so people find them. (Garage has no per-object ACLs, so an app that keeps
      original uploads should use a bucket where that is acceptable.)

## Phase 2 — Database portability

The one invasive refactor. 12 files touch Mongo; there are 5 aggregations.

- [ ] **`db/` repository layer.** Controllers call `db.assets.list(...)`, never a
      model directly. This is what makes multiple engines possible without
      multiple code paths.
- [ ] **Knex** as the query builder — one API over `postgres`, `mysql2` and
      `better-sqlite3`. Not a full ORM; the queries here are simple.
- [ ] **Keep the ID shape:** generate `crypto.randomBytes(12).toString('hex')`, the
      same 24-hex format as an ObjectId. Then `OBJECT_ID_RE`, every URL and every
      stored ID survive untouched, and a Mongo→SQL migration is a straight copy.
- [ ] **JSON columns** for `variants` and `preview`. All three engines support JSON
      (SQLite via JSON1), so the nested shapes carry over nearly unchanged.
- [ ] The 5 aggregations become `GROUP BY`:
      `libraryController` folder tree, `dashboardController` daily chart (watch
      timezone handling per engine), `appController` key counts, two in
      `bucketController`.
- [ ] Sessions: `connect-mongo` → `connect-session-knex`, one table, all engines.
- [ ] Schema migrations with `knex migrate`, run automatically at boot.
- [ ] `scripts/migrate-from-mongo.js` — for the private instance, and for anyone
      else already running the Mongo version.
- [ ] Rename `Image` → `Asset` and the collection/table to `assets` while you are
      in here. Do it now or never.

**Test matrix:** every test runs against SQLite, Postgres and MySQL in CI.

~2–3 focused days.

## Phase 3 — Setup wizard

Today `config/env.js` throws at require time when a variable is missing, so the
app cannot boot far enough to show a wizard. That is the first thing to change.

- [ ] **Bootstrap mode.** Required variables become optional; if any are missing
      and no config file exists, `config.setupNeeded = true`.
- [ ] **`server.js`:** in setup mode, mount only the wizard and static assets.
      Everything else redirects to `/setup`.
- [ ] **Generate `SESSION_SECRET` automatically** on first boot and persist it.
      Never ask a human for a random string.
- [ ] **Steps:**
  1. **Database** — SQLite (default, no inputs), Postgres or MySQL with host, port,
     user, password, database and a **Test connection** button. Reuse the pattern
     from bucket verification: a real round trip that names the failing step.
     On success, run migrations.
  2. **Admin account** — email and password, bcrypt-hashed into the database.
     This moves the admin out of the environment entirely, which Docker wants anyway.
  3. **Storage** — reuse the existing provider picker and `storage.verify()`. Skippable.
  4. **First app** — name and slug, then show the API key once.
- [ ] **Persist to `data/config.json`**, not by rewriting `.env`: no parsing or
      escaping bugs, and it sits on the Docker volume. Environment variables keep
      priority, so an env-only deployment never sees the wizard.
- [ ] **Lock it.** The wizard answers only while there is no config file *and* no
      admin row; afterwards it 404s. While open, require the one-time token printed
      to stdout at startup. An exposed, unauthenticated setup page is exactly how
      self-hosted apps get taken over, and "it's only open for a minute" is how it
      happens anyway.
- [ ] `scripts/hash-password.js` becomes optional, and `.env.example` shrinks a lot.

## Phase 4 — Packaging

- [ ] Multi-stage `Dockerfile` on `node:22-slim` — **not** alpine, sharp's prebuilt
      binaries want glibc.
- [ ] Multi-arch build, **amd64 and arm64** (the private instance runs on Hetzner ARM).
      Publish to GHCR on tag.
- [ ] `docker-compose.yml` — one service, one volume, SQLite, no database container.
      Plus `docker-compose.postgres.yml` and `docker-compose.mysql.yml`.
- [ ] Healthcheck pointed at the existing `/health`.
- [ ] Bootstrap from env when present (`ADMIN_EMAIL`, `ADMIN_PASSWORD`), so an
      unattended deployment skips the wizard.

> **Not doing:** baking Postgres into the application image. It loses data when the
> image is replaced, cannot be upgraded independently, and reviewers will flag it.
> SQLite-by-default already gives the "one command, no database" experience; compose
> gives a real database to anyone who needs one.

## Phase 5 — Tests and CI

- [ ] Grow `test/` into the pipeline itself: ingest with storage mocked, dedupe,
      the per-app gates, delete.
- [ ] GitHub Actions: `node --test` on Node 20/22/24, the three database engines,
      a Docker build, and `npm audit`.
- [ ] A smoke test that boots the server against SQLite and walks the wizard.

## Phase 6 — README and docs

- [ ] **README order that converts:** one-line pitch → animated GIF of the upload
      dialog → "Run it in 30 seconds" → comparison table → features → *What it is
      not* → storage providers → sponsor.
- [ ] **Docs site:** Markdown in `docs/`, VitePress on GitHub Pages. Pages: Install,
      Configure, Storage providers, API reference, Migrating from Cloudinary,
      Security. Generate the API page from `utils/docs.js` so docs cannot drift.
- [ ] Screenshots of the library, the document previews and the settings page.

## Phase 7 — Positioning as the Cloudinary alternative

- [ ] GitHub description and topics: `cloudinary-alternative`, `self-hosted`,
      `image-optimization`, `digital-asset-management`, `s3`, `file-upload-api`.
      Topics are how both GitHub search and AI crawlers find a project.
- [ ] **Comparison table** against Cloudinary, imgix and Uploadcare: cost, egress,
      data ownership, lock-in — *including a column where Cloudinary wins*. Honesty
      is what gets upvoted; overclaiming is what gets torn apart in the comments.
- [ ] **`scripts/import-from-cloudinary.js`** pulling an existing Cloudinary library
      into your folders. The single best marketing asset you can ship.
- [ ] A "Migrating from Cloudinary" docs page mapping their transformations onto
      named variants.

## Phase 8 — Funding, done tastefully

- [ ] `.github/FUNDING.yml` → GitHub Sponsors button and Buy Me a Coffee.
- [ ] **One source of truth for referrals:** add a `referral` field to each entry in
      `utils/providers.js`, and generate the README's storage table from it with a
      small script. One file to update; the in-app provider cards already link `site`.
- [ ] **Disclose it once, plainly, in the README:** *"Links to storage providers are
      referral links. They cost you nothing, you still get the usual signup credit,
      and they help pay for the time that goes into this."* Undisclosed affiliate
      links are the fastest way to lose an open-source audience — and in several
      jurisdictions, including the US, disclosure is required, not optional.
- [ ] Keep referrals **out of the dashboard by default**, or removable in one file.
      People are forgiving about a README and hostile about monetized software they
      run on their own server. DigitalOcean, Hetzner, Vultr and Backblaze all have
      programmes; Cloudflare R2 does not.

## Phase 9 — Making AI agents know about it

Two different problems.

**So agents can use it:**
- [ ] `openapi.yaml` plus a `GET /openapi.json` endpoint on the running instance.
- [ ] `GET /llms.txt` served by the app, and `llms.txt` + `llms-full.txt` on the
      docs site.
- [ ] **An MCP server** (`files360-mcp`) so Claude, Cursor and the rest can upload to
      an instance directly. Highest-leverage item here: it turns the project from
      something agents read about into something they reach for.
- [ ] `AGENTS.md` (done) and `CLAUDE.md` so anyone pointing an AI at the codebase
      inherits the architecture, conventions and test command.
- [ ] `integrations/` with a copy-paste Claude skill and Cursor rule.

**So agents recommend it:**
- [ ] Submit to `awesome-selfhosted`, `awesome-opensource-alternatives`,
      AlternativeTo, OpenAlternative, LibHunt. These lists are scraped heavily and
      are what models end up repeating.
- [ ] JSON-LD `SoftwareApplication` on the landing page.
- [ ] One good technical write-up on your own domain — the kind of post that gets
      quoted back by models a year later.

## Phase 10 — Launch

- [ ] Tag `v1.0.0`, real release notes, a 60-second demo GIF.
- [ ] r/selfhosted (Docker, no telemetry, data ownership), Show HN, Lobsters.
      Lead with the comparison and the one-command install, never the feature list.

---

## Minimum viable launch

Phases 1, 2, 4 and 6, plus a light pass at 7. Everything else can land after v1
while people are watching. The setup wizard (Phase 3) is what makes the difference
between a project people try and a project people abandon at step two — do not cut
it, but it can ship as v1.1 if Docker lands with sane environment defaults.

## Known traps

- **`secretBox.js` SALT** — see above. Never change it.
- **Timezone in the daily chart** — Mongo's `$dateToString` with a timezone has no
  single SQL equivalent. Do the bucketing in SQL as UTC and shift in JS.
- **sharp on alpine** — use `node:22-slim`.
- **SQLite and concurrent writes** — enable WAL mode; the write load here is tiny,
  but the upload-and-update-stats path writes twice per file.
- **`/v1/images` must keep working** forever once published.
