# Launch kit

Everything that has to happen outside the code to publish Files360, in order. The texts to paste are in [listings.md](listings.md) and [posts.md](posts.md). This folder is not part of the Docker image or the docs site.

## 1. Publish the repository

- [ ] Create `github.com/dot360io/Files360` (public, no template, no README).
- [ ] `git remote add origin git@github.com:dot360io/Files360.git && git push -u origin main`
- [ ] Settings → General: description and website from [listings.md](listings.md); add the topics.
- [ ] Settings → Security → **Private vulnerability reporting: enable.** SECURITY.md and the Code of Conduct rely on it.
- [ ] Issues → Labels: make sure `bug` and `enhancement` exist (the issue forms apply them).
- [ ] Optional: install the DCO GitHub App so sign-offs are checked on pull requests.

## 2. Docs site on files360.dev

- [ ] Settings → Pages → Source: **GitHub Actions**. The `Docs site` workflow deploys on every push to `main`.
- [ ] Custom domain `files360.dev` (already in `docs/public/CNAME`), then tick **Enforce HTTPS** once the certificate is issued.
- [ ] At the DNS provider for `files360.dev`: `A` records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` and `AAAA` to `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`, plus `CNAME www → dot360io.github.io`.
- [ ] Verify the domain under the `dot360io` organisation (Settings → Pages → Verified domains), so nobody else can claim it for their Pages site.

## 3. Before tagging v1.0.0

- [ ] CI green on `main`: Node 20/22/24, Postgres, MySQL, Docker boot, docs, MCP, audit.
- [ ] Re-check the Hetzner CAX11 price in `docs/comparison.md` by hand (the research could only confirm it from secondary sources).
- [ ] Screenshots of the library, a document preview and the settings page, and a 60-second GIF of the upload dialog: `docs/public/demo.gif`, then replace the TODO comment at the top of README.md.
- [ ] GitHub Sponsors and Buy Me a Coffee: create the accounts, then add `.github/FUNDING.yml` and a Sponsor line at the end of README.md.
- [ ] Referral links, if you join any programmes: fill `referral` in `utils/providers.js` and run `npm run docs:generate`. The disclosure sentence appears in the README by itself once one is set.
- [ ] Move the `Unreleased` section of CHANGELOG.md under `1.0.0` with the date.

## 4. Release

- [ ] `git tag -s v1.0.0 -m "Files360 1.0.0" && git push origin v1.0.0`. The `Docker image` workflow publishes `ghcr.io/dot360io/files360:1.0.0`, `:1.0` and `:latest` for amd64 and arm64.
- [ ] Packages → files360 → Package settings: change visibility to **Public** (GHCR packages start private).
- [ ] Releases → Draft a new release from the tag, body from CHANGELOG.md, attach the demo GIF.
- [ ] `cd mcp && npm publish` (check the name `files360-mcp` is still free with `npm view files360-mcp` first; publish from an npm account owned by Dot360 with 2FA on).

## 5. Tell people

Lead with the comparison and the one-command install, never the feature list.

- [ ] Show HN, r/selfhosted, Lobsters: [posts.md](posts.md). Post on a weekday morning US Eastern, and stay around to answer for the first few hours.
- [ ] AlternativeTo, OpenAlternative, LibHunt: [listings.md](listings.md).
- [ ] awesome-selfhosted: their rules ask for a first release at least four months old, so submit after that date.
- [ ] awesome-opensource-alternatives (Cloudinary section).
- [ ] Publish the write-up at https://files360.dev/blog/hostile-uploads and share it separately from the launch, a week or two later.
