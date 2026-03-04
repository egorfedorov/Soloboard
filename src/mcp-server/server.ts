import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Store } from "./storage/store.js";
import { TaskStore } from "./storage/task-store.js";
import { BoardStore } from "./storage/board-store.js";
import { SessionStore } from "./storage/session-store.js";
import { SprintStore } from "./storage/sprint-store.js";
import { registerTaskTools } from "./tools/task-tools.js";
import { registerBoardTools } from "./tools/board-tools.js";
import { registerSessionTools } from "./tools/session-tools.js";
import { registerGitTools } from "./tools/git-tools.js";
import { registerInitTools } from "./tools/init-tools.js";
import { registerExportTools } from "./tools/export-tools.js";
import { registerContextTools } from "./tools/context-tools.js";
import { registerSmartTools } from "./tools/smart-tools.js";
import { registerAgentTools } from "./tools/agent-tools.js";
import { registerReviewTools } from "./tools/review-tools.js";
import { registerDependencyTools } from "./tools/dependency-tools.js";
import { registerSubtaskTools } from "./tools/subtask-tools.js";
import { registerSprintTools } from "./tools/sprint-tools.js";
import { registerStandupTools } from "./tools/standup-tools.js";
import { registerManagerTools } from "./tools/manager-tools.js";

export function createSoloboardServer(projectRoot: string): McpServer {
  const server = new McpServer({
    name: "soloboard",
    version: "1.4.0",
  });

  const store = new Store(projectRoot);
  const taskStore = new TaskStore(store);
  const boardStore = new BoardStore(store);
  const sessionStore = new SessionStore(store);
  const sprintStore = new SprintStore(store);

  // v1.0: Core
  registerTaskTools(server, store, taskStore, boardStore, sessionStore);
  registerBoardTools(server, store, taskStore, boardStore);
  registerSessionTools(server, store, sessionStore, taskStore);
  registerGitTools(server, store, taskStore, boardStore, projectRoot);
  registerInitTools(server, store, boardStore, sessionStore, projectRoot);
  registerExportTools(server, store, taskStore, boardStore);

  // v1.2: Intelligence
  registerContextTools(server, store, taskStore);
  registerSmartTools(server, store, taskStore, boardStore, sessionStore, projectRoot);
  registerAgentTools(server, store, taskStore, projectRoot);
  registerReviewTools(server, store, taskStore, boardStore, projectRoot);

  // v1.3: Dependencies & Structure
  registerDependencyTools(server, store, taskStore, boardStore);
  registerSubtaskTools(server, store, taskStore, boardStore, sessionStore);
  registerSprintTools(server, store, taskStore, sprintStore);
  registerStandupTools(server, store, taskStore, boardStore, sprintStore);

  // v1.4: Auto-Manager
  registerManagerTools(server, store, taskStore, boardStore, sprintStore);

  return server;
}
