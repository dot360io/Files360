# Security

Files360 accepts files from the internet and parses them, so most of its design is about what an upload is allowed to become.

## What reaches storage

- **File types are decided from the bytes,** never the file name or the declared MIME type.
- **SVG is rewritten through an allowlist** before it is stored and before it is rasterized: scripts, event handlers, `foreignObject`, entity declarations and any reference that is not a document anchor or a `data:` image are removed. The library records what was taken out.
- **Images are re-encoded** with metadata stripped, below a pixel limit that defeats decompression bombs. HEIC is refused.
- **Documents are stored byte for byte.** Their previews come from hand-written ZIP and compound-file readers that cap every read, so a crafted archive cannot expand without bound. Macro-enabled OOXML is refused. Archives are off per app until turned on.
- **URL imports** refuse private and link-local addresses and re-check every redirect and every resolved address, against DNS rebinding.

The parsers are written without dependencies on purpose: each library would be another supply-chain surface on a service that parses hostile input.

## Keys and secrets

- API keys are shown once and stored only as SHA-256 hashes. They are rate limited per app and can be revoked from the app's Keys tab.
- Bucket credentials are encrypted with AES-256-GCM before they reach the database.
- The session secret and the storage key are generated on first start into `data/secrets.json`, readable only by the service's user.

## The dashboard

- One administrator account, bcrypt-hashed, with a login rate limit.
- CSRF tokens on every form, `SameSite` cookies, Helmet headers and a Content-Security-Policy that only admits your buckets' origins.

## The setup wizard

An unconfigured install is the most dangerous moment in a self-hosted app's life. The wizard only answers to a browser that has entered the one-time token printed in the server log, writes nothing until its last step, and closes for good once there is a configuration and an administrator. After that `/setup` is a 404.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on [dot360io/Files360](https://github.com/dot360io/Files360/security/advisories/new). Please do not open a public issue. See [SECURITY.md](https://github.com/dot360io/Files360/blob/main/SECURITY.md) for scope and response times.
