---
title: Parsing hostile uploads without a parser library
description: How Files360 accepts PDFs, Office files, ZIPs and SVG from the internet, and why it reads them with code it wrote itself.
---

# Parsing hostile uploads without a parser library

*[Dot360](https://dot360.io) · October 2026*

An upload endpoint is a parser exposed to the internet. Whatever arrives at `POST /v1/files` was chosen by someone else, and Files360 does more with it than store it: it decides what it is, renders images, and reads a preview out of documents so the media library can show the first rows of a spreadsheet without downloading it again. This post is about how that is done safely, and why the reading is done by about 900 lines of code in the repository rather than by a library.

## Decide from the bytes

The first rule is that the file name and the declared `Content-Type` are opinions. Files360 sniffs the bytes: `%PDF-` is a PDF, `PK\x03\x04` is a ZIP container that might be an `.xlsx`, a `.docx`, a `.pptx` or just a ZIP, and `D0 CF 11 E0` is a compound file, the container behind the 97-2003 Office formats. A ZIP is only an `.xlsx` if its directory contains `xl/workbook.xml` and a content-types entry that says so. A file called `report.pdf` that starts with `PK` is not a PDF, and the stored name gets the extension the bytes deserve.

This closes a class of problems before they start: a renamed HTML file cannot become a "document" served from your CDN with an attacker-chosen type.

## Every read is capped

A ZIP's central directory states how big each entry is. That number is a claim. The ZIP reader in `utils/zip.js` never inflates more than a fixed limit per entry, stops when the inflated output passes that limit regardless of what the header said, and only reads the entries a preview needs. Listing an archive reads the central directory alone, so a ZIP bomb has nothing to explode into: the listing is the preview.

The compound-file reader in `utils/cfb.js` has the same posture for a different format. Compound files are a small file system with sector chains, a FAT and a mini-FAT, and malformed ones can loop forever or point outside the file. Every chain walk is bounded by the number of sectors that can exist, every offset is checked against the buffer, and anything that does not add up is a refusal, not a best effort.

The preview itself is capped too: about 40 rows, 60 paragraphs or 80 archive entries, roughly 96 KB per record. It is read once, at upload, and stored, so listing a folder never touches the bucket and never parses anything again.

## SVG is rewritten, not filtered

An SVG is a document format that can carry scripts. Files360 does not try to detect bad SVG; it rebuilds every file through an allowlist of elements and attributes. Scripts, event handlers, `foreignObject`, entity declarations and any reference that is not a document anchor or an inline image do not survive, and the library records what was removed. The cleaned vector is what gets published, and it is also what gets rasterized into the app's sizes, so the bytes that arrived never reach storage or the renderer.

## Why not a library

There are good libraries for every one of these formats. The reason Files360 does not use them is not that they are bad, but that each one is a dependency tree attached to the most exposed function in the service, updated on someone else's schedule. The parsers here only need a small part of each format: enough to identify the file and read a preview. Written for exactly that, they fit in a few hundred lines each, have no transitive dependencies, and can be read in an afternoon by anyone deciding whether to trust them.

That is also why the tests matter more than usual. There are no binary fixtures in the repository: `test/helpers/` builds ZIP and compound files in memory from readable XML, including deliberately broken ones, so a reviewer can see exactly what is being fed to the parser and what it is expected to refuse.

## What this buys

The result is an upload endpoint that accepts the files real applications need (photos, PDFs, spreadsheets, decks, archives) and treats every one as hostile until proven otherwise, with the code that makes that judgement small enough to audit. If you find a way through it, [report it privately](https://github.com/dot360io/Files360/security/advisories/new).

Files360 is open source under AGPL-3.0. [Install it](/install), or [read the code](https://github.com/dot360io/Files360).
