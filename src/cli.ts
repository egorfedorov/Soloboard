#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const soloboardRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
  soloboard — Invisible task tracker for Claude Code

  Usage:
    soloboard install [path]   Install into a project (default: current dir)
    soloboard server           Start MCP server (used by Claude Code)
    soloboard help             Show this help

  Examples:
    cd my-project && soloboard install
    soloboard install /path/to/project
`);
}

switch (command) {
  case "install": {
    const target = args[1] ?? process.cwd();
    const installScript = path.join(soloboardRoot, "install.sh");
    console.log(`Installing SoloBoard into: ${target}`);
    execSync(`bash "${installScript}" "${target}"`, { stdio: "inherit" });
    break;
  }
  case "server": {
    const projectRoot = process.env.SOLOBOARD_PROJECT_ROOT ?? process.cwd();
    // Dynamic import to start MCP server
    const { createSoloboardServer } = await import("./mcp-server/server.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const server = createSoloboardServer(projectRoot);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    break;
  }
  case "help":
  case "--help":
  case "-h":
  case undefined:
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
