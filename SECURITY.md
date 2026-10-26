# Security policy

## Supported versions

Until v1.0.0, only the `main` branch receives security fixes. After that, only the
latest release does. Please check that an issue still reproduces on the latest
release or on `main` before reporting it.

| Version | Supported |
| --- | --- |
| Latest release, or `main` before v1.0.0 | Yes |
| Anything older | No |

## Reporting a vulnerability

Use GitHub private vulnerability reporting: open the repository's **Security** tab
and choose **Report a vulnerability**. The report is visible only to you and the
maintainers.

**Never open a public issue, discussion or pull request for a vulnerability.** That
publishes it to everyone running Files360 before a fix exists.

A useful report includes:

- the version or commit you tested,
- the steps or a sample file that reproduces it,
- what an attacker gains, and what access they need first.

## What to expect

- **Acknowledgement** within 3 working days.
- **A fix, or a plan with a timeline,** within 30 days.
- **Coordinated disclosure.** We agree a publication date with you once a fix is
  available. You are credited in the advisory unless you would rather not be.

## Why this matters here

Files360 accepts arbitrary uploads from the internet and does real work on them, so
its attack surface is larger than its size suggests:

- Uploads are parsed by hand-written ZIP, compound-file and SVG parsers.
- URL imports fetch remote files on the server, guarded against SSRF.
- Bucket credentials are stored in the database, encrypted at rest.
- A first-run setup wizard is reachable over HTTP until it is completed, protected
  by a one-time token printed at startup.

## Scope

**In scope:**

- The upload pipeline and the ZIP, compound-file, SVG and document parsers:
  memory or CPU exhaustion from a single small file, reads outside bounds, parser
  confusion that lets a file type through that should be refused.
- SSRF or redirect bypasses in URL imports.
- Exposure or weak protection of stored bucket credentials.
- The setup wizard: reaching it without the token, or reopening it once setup is
  complete.
- Authentication, sessions and API keys, including one app's key reaching another
  app's files.
- CSRF on any state-changing route.
- Stored XSS through SVG, file names, previews or any other uploaded content.

**Out of scope:**

- Issues that require an already-compromised admin account or server.
- Missing best-practice headers or settings with no demonstrated exploit.
- Denial of service by sheer volume of requests or uploads.
- Vulnerabilities in the operator's own bucket, CDN or reverse-proxy configuration.

If you are unsure whether something is in scope, report it privately anyway.
