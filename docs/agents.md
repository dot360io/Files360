# AI agents

Files360 is built to be used by agents as well as people: there is an MCP server, every instance describes itself, and the repository ships instructions for coding assistants.

## MCP server

`files360-mcp` lets Claude, Cursor and any other MCP client upload to your instance directly. It needs the instance URL and an API key from one of your apps.

**Claude Code**

```bash
claude mcp add files360 \
  -e FILES360_API_URL=https://files.example.com \
  -e FILES360_API_KEY=f360_... \
  -- npx -y files360-mcp
```

**Claude Desktop, Cursor and others**

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

Tools: `files360_get_config`, `files360_upload_file`, `files360_import_url`, `files360_list_files`, `files360_get_file` and `files360_delete_file`.

Set `FILES360_UPLOAD_DIR` to a folder and the upload tool refuses any path outside it, symlinks included. Without it an agent could be talked into publishing any file it can read, such as an SSH key, to a public URL.

A key can upload and delete everything in its app. Give each agent its own key, ideally its own app, and revoke it from the Keys tab when you are done.

## What every instance publishes

| Path | What it is |
| --- | --- |
| `/openapi.json` | The OpenAPI 3.1 description of the API, pointed at that instance |
| `/llms.txt` | A short plain-text guide for language models ([llmstxt.org](https://llmstxt.org)) |

This site publishes [llms.txt](/llms.txt), [llms-full.txt](/llms-full.txt) with every docs page in one file, and [openapi.json](/openapi.json).

## Instructions for coding assistants

The repository's [`integrations/`](https://github.com/dot360io/Files360/tree/main/integrations) folder has a Claude skill and a Cursor rule that teach an assistant how to integrate an application with Files360: endpoints, branching on `kind`, retries and the errors worth handling. Copy the one you need into your own project.

Working on Files360 itself, an assistant should read [`AGENTS.md`](https://github.com/dot360io/Files360/blob/main/AGENTS.md) first.
