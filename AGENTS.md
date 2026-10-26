# Working on Files360

Instructions for coding agents and new contributors. Read
[ARCHITECTURE.md](ARCHITECTURE.md) before changing anything, and [PLAN.md](PLAN.md)
for where the project is heading.

## What this is

A self-hosted upload API and media library: images are optimized into configured
sizes, documents and archives are stored as they arrive with a readable preview,
everything lands on the operator's own S3-compatible bucket.

## Commands

```bash
npm install
npm run dev              # watch mode on http://127.0.0.1:4360 (setup wizard on first run)
npm test                 # node:test, in-memory SQLite, no database server or network
npm run check-storage    # round-trips every connected bucket
npm run docs:generate    # rewrites the generated docs (API page, openapi.json, llms.txt, provider tables)
npm run docs:dev         # the files360.dev site, VitePress
```

## House style

The codebase has a voice. Match it rather than introducing a new one.

- **Plain JavaScript, CommonJS, no build step.** No TypeScript, no bundler, no JSX.
- **Dependencies are a last resort.** The ZIP, compound-file and SVG parsers are
  hand-written on purpose: every one of them would otherwise be a supply-chain
  surface on a service that parses untrusted uploads. Do not add a library to
  replace one without a strong reason.
- **Comments explain why, never what.** The existing comments are the model: short,
  lowercase-ish prose that tells you the reason a line exists, not a restatement of
  it. If a comment would just read the code aloud, leave it out.
- **Server-rendered EJS.** One stylesheet, one script, no framework, no client-side
  router.
- **Errors are for humans.** `HttpError(status, code, message)` where the message
  tells the operator what to do next. Look at `utils/documents.js` for the tone.
- **Every user-facing string is British-neutral plain English.** No exclamation
  marks, no "oops".

## Rules that are not negotiable

1. **Never change the SALT in `utils/secretBox.js`.** It derives the key that
   encrypts stored bucket credentials. Changing it makes every secret already in a
   database unreadable.
2. **Never widen what reaches storage.** Uploads are attacker-controlled. File types
   are decided from bytes, not names or declared MIME types. SVG is sanitized before
   it is stored *and* before it is rasterized.
3. **Never make published URLs mutable.** Object keys contain a hash of the content
   and the render settings. Changing settings must never rewrite an existing object.
4. **Parsers fail closed and stay capped.** Every read out of a ZIP or compound file
   is bounded. If you cannot bound it, do not read it.
5. **Published API paths never break.** `/v1/files` is the API; new behaviour is
   added alongside it, never by changing what an existing path or field means.
6. **Only `db/` talks to the database.** Controllers call repositories; anything
   engine-specific belongs in `db/` and needs a test in `test/db.test.js`.

## Testing

`test/` runs on the built-in `node:test` runner with no database server and no network:
repository tests use in-memory SQLite, and `TEST_DATABASE_URL` points them at Postgres
or MySQL instead.
Changes to `utils/zip.js`, `utils/cfb.js`, `utils/svg.js` or `utils/documents.js`
need tests — they parse hostile input for a living. There are no binary fixtures: `test/helpers/`
builds the ZIP and compound-file samples in memory from readable XML, so you can
see exactly what is being parsed.

## Before you open a PR

- `npm test` passes.
- `node --check` on every file you touched, or just run the tests.
- No new runtime dependency without saying why in the PR description.
- No personal data, credentials or real bucket names in fixtures or examples.
