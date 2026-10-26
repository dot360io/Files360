# Integrations

Ready-made files that teach AI coding tools how to work with Files360. None of them hold a key; they read `FILES360_API_URL` and `FILES360_API_KEY` from the environment.

## MCP server

The [`mcp/`](../mcp) package, published on npm as `files360-mcp`, gives any MCP client (Claude Desktop, Claude Code, Cursor and others) tools to upload, import, list, fetch and delete files on your instance. Use it when you want an agent to act on Files360 directly. See [mcp/README.md](../mcp/README.md) for setup.

```bash
claude mcp add files360 -e FILES360_API_URL=https://files.example.com -e FILES360_API_KEY=f360_... -- npx -y files360-mcp
```

## Claude Agent Skill

[`claude-skill/files360/SKILL.md`](claude-skill/files360/SKILL.md) tells Claude when and how to use the Files360 API: curl recipes for every endpoint, how to read `image` and `document` responses, duplicate handling and which errors to retry. It works on its own with shell access, and alongside the MCP server when both are present.

To install it for yourself, copy the folder into your personal skills directory; to share it with a project, copy it into the project's `.claude/skills/`:

```bash
cp -r integrations/claude-skill/files360 ~/.claude/skills/
# or
cp -r integrations/claude-skill/files360 path/to/project/.claude/skills/
```

For Claude.ai or the Claude desktop app, zip the `files360` folder and upload it under Settings, Capabilities, Skills.

## Cursor rule

[`cursor/files360.mdc`](cursor/files360.mdc) is a project rule for codebases that call Files360 from their backend. It condenses the API, response shapes, error handling and the rule that keys never reach browser code. It is not applied to every request; Cursor attaches it when the work is about Files360, or you can mention it with `@files360`.

```bash
mkdir -p path/to/project/.cursor/rules
cp integrations/cursor/files360.mdc path/to/project/.cursor/rules/
```
