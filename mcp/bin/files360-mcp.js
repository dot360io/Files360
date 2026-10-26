#!/usr/bin/env node
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { readConfig, ConfigError } = require('../src/config');
const { createServer } = require('../src/server');

async function main() {
  let config;
  try {
    config = readConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // stdout belongs to the protocol, so anything for a human goes to stderr
    process.stderr.write(`files360-mcp cannot start:\n${err.message}\n`);
    process.exit(1);
  }

  const server = createServer({ config });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`files360-mcp connected to ${config.apiUrl}\n`);
}

main().catch((err) => {
  process.stderr.write(`files360-mcp stopped: ${err.stack || err.message}\n`);
  process.exit(1);
});
