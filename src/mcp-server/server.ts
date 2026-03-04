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

export function createSoloboardServer(projectRoot: string): McpServer {
  const server = new McpServer({
    name: "soloboard",
    version: "1.0.0",
  });

  const store = new Store(projectRoot);
  const taskStore = new TaskStore(store);
  const boardStore = new BoardStore(store);
  const sessionStore = new SessionStore(store);

  // Register all tools (14 original + 2 init)
  registerTaskTools(server, store, taskStore, boardStore, sessionStore);
  registerBoardTools(server, store, taskStore, boardStore);
  registerSessionTools(server, store, sessionStore, taskStore);
  registerGitTools(server, store, taskStore, boardStore, projectRoot);
  registerInitTools(server, store, boardStore, sessionStore, projectRoot);

  return server;
}
