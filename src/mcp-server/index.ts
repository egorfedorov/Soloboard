import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSoloboardServer } from "./server.js";

const projectRoot = process.env.SOLOBOARD_PROJECT_ROOT ?? process.cwd();

const server = createSoloboardServer(projectRoot);
const transport = new StdioServerTransport();

await server.connect(transport);
