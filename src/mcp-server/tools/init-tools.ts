import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { BoardStore } from "../storage/board-store.js";
import { SessionStore } from "../storage/session-store.js";
import path from "node:path";

export function registerInitTools(
  server: McpServer,
  store: Store,
  boardStore: BoardStore,
  sessionStore: SessionStore,
  projectRoot: string
) {
  // auto_init — initialize .kanban, project, and session in one call
  server.tool(
    "auto_init",
    "Auto-initialize SoloBoard: creates .kanban dir, project board, and session. Safe to call multiple times — skips if already initialized.",
    {
      projectName: z.string().optional().describe("Project name (default: directory name)"),
    },
    async ({ projectName }) => {
      // 1. Init .kanban directory
      await store.init();

      const config = await store.getConfig();

      // 2. Create project if none exists
      if (!config.activeProjectId) {
        const name = projectName ?? path.basename(projectRoot);
        const board = await boardStore.create(name);
        config.activeProjectId = board.id;
      }

      // 3. Create session if none active
      if (!config.activeSessionId) {
        const session = await sessionStore.create(config.activeProjectId);
        config.activeSessionId = session.id;
      }

      await store.saveConfig(config);

      // 4. Get board for summary
      const board = await boardStore.get(config.activeProjectId);
      const boardName = board?.name ?? "Unknown";
      const todo = board?.columns.todo.length ?? 0;
      const doing = board?.columns.doing.length ?? 0;
      const done = board?.columns.done.length ?? 0;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              project: { id: config.activeProjectId, name: boardName },
              session: config.activeSessionId,
              board: { todo, doing, done },
            }),
          },
        ],
      };
    }
  );

  // board_summary — lightweight board status for context injection
  server.tool(
    "board_summary",
    "Get a one-line board summary for context (e.g. 'TODO: 3 | DOING: 1 | DONE: 5')",
    {},
    async () => {
      const config = await store.getConfig();
      if (!config.activeProjectId) {
        return { content: [{ type: "text", text: "No active project." }] };
      }

      const board = await boardStore.get(config.activeProjectId);
      if (!board) {
        return { content: [{ type: "text", text: "Board not found." }] };
      }

      const summary = `[${board.name}] TODO: ${board.columns.todo.length} | DOING: ${board.columns.doing.length} | DONE: ${board.columns.done.length}`;
      return { content: [{ type: "text", text: summary }] };
    }
  );
}
