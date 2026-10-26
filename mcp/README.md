# files360-mcp

An [MCP](https://modelcontextprotocol.io) server for [Files360](https://files360.dev), the self-hosted upload API. It lets an AI agent such as Claude or Cursor upload images and documents to your own Files360 instance, list and delete them, and get the public CDN URLs back, including a ready-made `srcset` for responsive images.

It talks to the same `/v1` API your backend uses, with an API key from one of your apps. Nothing is stored locally.

## Requirements

- Node.js 20 or later
- A running Files360 instance and an API key from an app's **Keys** tab

## Install

There is nothing to install by hand. MCP clients start the server with `npx`:

```bash
npx -y files360-mcp
```

It reads two environment variables and exits with a clear message if either is missing:

| Variable | Required | Description |
| --- | --- | --- |
| `FILES360_API_URL` | yes | Base address of your instance, e.g. `https://files.example.com`. A trailing `/v1` is accepted. |
| `FILES360_API_KEY` | yes | An app key, `f360_` followed by 12 and then 48 hex characters. |
| `FILES360_UPLOAD_DIR` | no | If set, `files360_upload_file` only reads files inside this folder. Recommended, see Security. |
| `FILES360_TIMEOUT_MS` | no | Request timeout in milliseconds. Defaults to `60000`. |

## Configure your client

### Claude Code

```bash
claude mcp add files360 \
  -e FILES360_API_URL=https://files.example.com \
  -e FILES360_API_KEY=f360_... \
  -- npx -y files360-mcp
```

Add `--scope project` to share the entry with your team through `.mcp.json`, but keep the key itself out of the repository.

### Claude Desktop

Edit `claude_desktop_config.json` (Settings, Developer, Edit Config):

```json
{
  "mcpServers": {
    "files360": {
      "command": "npx",
      "args": ["-y", "files360-mcp"],
      "env": {
        "FILES360_API_URL": "https://files.example.com",
        "FILES360_API_KEY": "f360_...",
        "FILES360_UPLOAD_DIR": "/Users/you/Pictures/to-publish"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Cursor

Create `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "files360": {
      "command": "npx",
      "args": ["-y", "files360-mcp"],
      "env": {
        "FILES360_API_URL": "https://files.example.com",
        "FILES360_API_KEY": "f360_..."
      }
    }
  }
}
```

If the project file is committed, put the key in the global file instead.

## Tools

| Tool | What it does |
| --- | --- |
| `files360_get_config` | Reads the app's settings: folder, output format, size limit, configured image sizes, accepted document and archive formats. Read only. |
| `files360_upload_file` | Uploads a file from this machine by path, with optional `folder` and `ref`. |
| `files360_import_url` | Has Files360 download a file from a public URL and store it like an upload. |
| `files360_list_files` | Lists files, newest first, with optional `page`, `limit` (up to 200), `folder` and `ref` filters. Read only. |
| `files360_get_file` | Returns one file by id. Read only. |
| `files360_delete_file` | Deletes a file and every size stored for it. Marked destructive, so clients ask before running it. |

Every tool answers with a short text summary for the model and the full API response as structured content. Responses carry a `kind`:

- `image`: `variants` holds a URL, width, height, size and format for every configured size, and `srcset` is ready for an `<img>` tag. SVG uploads also have `file.url` for the cleaned vector.
- `document`: `file.url` is the only URL, and `preview` summarises the contents (pages, rows, slides, words).

Uploading the same file into the same folder again returns the existing record with `"duplicate": true`, so an agent retrying an upload never creates a second copy.

API errors come back as tool errors carrying the API's own code and message, for example `Files360 error 413 file_too_large: File exceeds the 10 MB limit`.

## Security

- **The key can upload and delete.** Anything the agent can do with it, it can do to every file in that app. Create a dedicated key for each agent or machine, labelled so you can tell them apart, and revoke it from the app's **Keys** tab when it is no longer needed.
- **Uploads are public.** Every URL returned is served by your CDN to anyone who has it. `files360_upload_file` can read any file the user running the client can read, so set `FILES360_UPLOAD_DIR` to the folder you actually want to publish from. Paths outside it, including through symlinks, are refused.
- **Keep the key out of repositories.** Use your client's user-level config or environment, not a committed project file.
- Consider a separate Files360 app for agent uploads, with its own folder and size limit, so a mistake stays contained.

## Development

```bash
cd mcp
npm install
npm test
```

The tests run every tool against a small local mock of the API. They need no network and no Files360 instance.

To try it against a real instance with the MCP Inspector:

```bash
FILES360_API_URL=https://files.example.com FILES360_API_KEY=f360_... \
  npx @modelcontextprotocol/inspector node bin/files360-mcp.js
```

## Licence

AGPL-3.0, copyright [Dot360](https://dot360.io). Source at [github.com/dot360io/Files360](https://github.com/dot360io/Files360).
