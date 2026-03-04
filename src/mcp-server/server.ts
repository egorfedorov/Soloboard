import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Store } from "./storage/store.js";
import { TaskStore } from "./storage/task-store.js";
import { BoardStore } from "./storage/board-store.js";
import { SessionStore } from "./storage/session-store.js";
import { registerTaskTools } from "./tools/task-tools.js";
import { registerBoardTools } from "./tools/board-tools.js";
import { registerSessionTools } from "./tools/session-tools.js";
import { registerGitTools } from "./tools/git-tools.js";
import { registerInitTools } from "./tools/init-tools.js";
import { registerExportTools } from "./tools/export-tools.js";

export function createSoloboardServer(projectRoot: string): McpServer {
  const server = new McpServer({
    name: "soloboard",
    version: "1.1.0",
  });

  const store = new Store(projectRoot);
  const taskStore = new TaskStore(store);
  const boardStore = new BoardStore(store);
  const sessionStore = new SessionStore(store);

  registerTaskTools(server, store, taskStore, boardStore, sessionStore);
  registerBoardTools(server, store, taskStore, boardStore);
  registerSessionTools(server, store, sessionStore, taskStore);
  registerGitTools(server, store, taskStore, boardStore, projectRoot);
  registerInitTools(server, store, boardStore, sessionStore, projectRoot);
  registerExportTools(server, store, taskStore, boardStore);

  return server;
}
