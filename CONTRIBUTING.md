# Contributing to Files360

Thank you for taking the time. This page covers how to get a working copy, what the
codebase expects of a change, and what will not be accepted, so nobody spends a
weekend on a pull request that cannot be merged.

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing anything. It is short and
it explains where every upload goes.

## Getting set up

You need Node.js 20 or later.

```bash
npm install
npm run dev     # watch mode on http://127.0.0.1:4360
npm test        # node:test, no database server or network needed
```

On first run, `npm run dev` prints a one-time `/setup?token=...` link that opens a
setup wizard in the browser. It walks you
through the database, the admin account, storage and a first app. SQLite is the
default, so a local copy needs no database server at all.

`npm test` uses in-memory SQLite and never touches the network, so it runs the same
on a laptop, in CI or on a train.

## House style

The codebase has a voice. Match it rather than introducing a new one.
[AGENTS.md](AGENTS.md) has the full version; in short:

- Plain JavaScript, CommonJS, no build step. No TypeScript, no bundler, no JSX.
- Server-rendered EJS with one stylesheet and one script. No client-side framework.
- Comments explain why a line exists, never what it does.
- Errors are for humans: `HttpError(status, code, message)`, where the message tells
  the operator what to do next.
- User-facing strings are plain, British-neutral English. No exclamation marks.

## Rules that are not negotiable

These protect people who already run Files360. A pull request that breaks one will
be closed, however good the rest of it is.

1. **Never change the SALT in `utils/secretBox.js`.** It derives the key that
   encrypts stored bucket credentials. Changing it makes every secret already in a
   database unreadable.
2. **Never widen what reaches storage.** Uploads are attacker-controlled. File types
   are decided from bytes, not names or declared MIME types. SVG is sanitized before
   it is stored and before it is rasterized.
3. **Never make published URLs mutable.** Object keys contain a hash of the content
   and the render settings. Changing settings must never rewrite an existing object.
4. **Parsers fail closed and stay capped.** Every read out of a ZIP or compound file
   is bounded. If you cannot bound it, do not read it.
5. **Published API paths never break.** `/v1/files` is the API; new behaviour is
   added alongside it, never by changing what an existing path or field means.

## Tests

Changes to `utils/zip.js`, `utils/cfb.js`, `utils/svg.js` or `utils/documents.js`
need tests. Those files parse hostile input for a living, and a regression there is
a security bug, not a cosmetic one.

There are no binary fixtures. `test/helpers/` builds ZIP and compound-file samples
in memory from readable XML, so a reviewer can see exactly what is being parsed.
Build new samples the same way rather than committing a file.

Before opening a pull request:

- `npm test` passes.
- `node --check` passes on every file you touched, or the tests cover them.
- Fixtures and examples contain no personal data, credentials or real bucket names.

## Dependencies

No new runtime dependency without a reason in the pull request description. The
ZIP, compound-file and SVG parsers are hand-written on purpose: on a service that
parses untrusted uploads, every library is another supply-chain surface. A pull
request that swaps one of them for a package needs a very strong case.

## What Files360 will not do

The [PLAN.md](PLAN.md) "Never" list is settled. Please do not open issues or pull
requests for:

- Video transcoding.
- AI tagging, moderation or auto-generated alt text.
- Being an object store itself. Files360 writes to your bucket; it is not an S3
  server.
- A hosted SaaS run by the maintainer.
- In-browser image editing.

If you are not sure whether an idea fits, open a feature request first and ask.

## Sign your commits off

Every commit must carry a Developer Certificate of Origin sign-off. Add it with:

```bash
git commit -s
```

That appends a `Signed-off-by: Your Name <you@example.com>` line, which certifies
that you wrote the change or otherwise have the right to submit it under the
project's licence. The full text is at <https://developercertificate.org>.

The sign-off keeps the provenance of every contribution clear, which matters for
an AGPL project that may one day need to relicense or prove where code came from.

To sign off commits you have already made on a branch:

```bash
git rebase --signoff main
```

## Security issues

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Conduct

Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
