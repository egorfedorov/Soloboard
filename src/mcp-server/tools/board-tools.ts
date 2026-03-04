import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStore } from "../storage/task-store.js";
import { BoardStore } from "../storage/board-store.js";
import { Store } from "../storage/store.js";

export function registerBoardTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  boardStore: BoardStore
) {
  // 1. board_view
  server.tool(
    "board_view",
    "View the kanban board for the active project",
    {},
    async () => {
      const config = await store.getConfig();
      if (!config.activeProjectId) {
        return { content: [{ type: "text", text: "No active project. Use project_create first." }] };
      }

      const board = await boardStore.get(config.activeProjectId);
      if (!board) {
        return { content: [{ type: "text", text: "Board not found." }] };
      }

      const lines: string[] = [`# ${board.name}`, ""];

      for (const col of ["todo", "doing", "done"] as const) {
        const ids = board.columns[col];
        const header = col.toUpperCase();
        lines.push(`## ${header} (${ids.length})`);

        if (ids.length === 0) {
          lines.push("  (empty)");
        } else {
          for (const id of ids) {
            const task = await taskStore.get(id);
            if (task) {
              const prio = task.priority === "high" ? "!!!" : task.priority === "medium" ? "!!" : "!";
              const tags = task.tags.length > 0 ? ` [${task.tags.join(", ")}]` : "";
              lines.push(`  - [${prio}] ${task.title} (${task.id})${tags}`);
            }
          }
        }
        lines.push("");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // 2. project_create
  server.tool(
    "project_create",
    "Create a new project board and set it as active",
    {
      name: z.string().describe("Project name"),
    },
    async ({ name }) => {
      await store.init();
      const board = await boardStore.create(name);
      const config = await store.getConfig();
      config.activeProjectId = board.id;
      await store.saveConfig(config);

      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, project: { id: board.id, name: board.name } }) },
        ],
      };
    }
  );

  // 3. project_list
  server.tool(
    "project_list",
    "List all project boards",
    {},
    async () => {
      const boards = await boardStore.list();
      const config = await store.getConfig();
      const summary = boards.map((b) => ({
        id: b.id,
        name: b.name,
        active: b.id === config.activeProjectId,
        tasks: b.columns.todo.length + b.columns.doing.length + b.columns.done.length,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary) }] };
    }
  );

  // 4. project_switch
  server.tool(
    "project_switch",
    "Switch the active project",
    {
      projectId: z.string().describe("Project ID or name"),
    },
    async ({ projectId }) => {
      let board = await boardStore.get(projectId);
      if (!board) {
        board = await boardStore.findByName(projectId);
      }
      if (!board) {
        return { content: [{ type: "text", text: `Project not found: ${projectId}` }] };
      }

      const config = await store.getConfig();
      config.activeProjectId = board.id;
      await store.saveConfig(config);

      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, activeProject: board.name }) }],
      };
    }
  );
}
