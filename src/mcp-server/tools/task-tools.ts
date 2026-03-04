import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStore } from "../storage/task-store.js";
import { BoardStore } from "../storage/board-store.js";
import { SessionStore } from "../storage/session-store.js";
import { HistoryStore } from "../storage/history-store.js";
import { Store } from "../storage/store.js";
import { TaskStatus } from "../models/task.js";

export function registerTaskTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  boardStore: BoardStore,
  sessionStore: SessionStore,
  historyStore?: HistoryStore
) {
  // 1. task_create
  server.tool(
    "task_create",
    "Create a new task on the board",
    {
      title: z.string().describe("Task title"),
      description: z.string().optional().describe("Task description"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Priority level"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      status: z.enum(["todo", "doing", "done"]).optional().describe("Initial status (default: todo)"),
    },
    async ({ title, description, priority, tags, status }) => {
      const config = await store.getConfig();
      if (!config.activeProjectId) {
        return { content: [{ type: "text", text: "No active project. Use project_create first." }] };
      }

      const task = await taskStore.create(title, config.activeProjectId, {
        description,
        priority,
        tags,
        status,
      });

      const targetStatus: TaskStatus = status ?? "todo";
      await boardStore.addTask(config.activeProjectId, task.id, targetStatus);

      if (config.activeSessionId) {
        await sessionStore.addCreatedTask(config.activeSessionId, task.id);
        if (targetStatus === "doing") {
          await sessionStore.setActiveTask(config.activeSessionId, task.id);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, task: { id: task.id, title: task.title, status: task.status } }),
          },
        ],
      };
    }
  );

  // 2. task_update
  server.tool(
    "task_update",
    "Update an existing task's fields",
    {
      taskId: z.string().describe("Task ID or title fragment"),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.enum(["low", "medium", "high"]).optional(),
      tags: z.array(z.string()).optional(),
      branch: z.string().optional(),
      pr: z.string().optional(),
    },
    async ({ taskId, ...updates }) => {
      const config = await store.getConfig();
      const task = await taskStore.resolve(taskId, config.activeProjectId ?? undefined);
      if (!task) {
        return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };
      }

      const updated = await taskStore.update(task.id, updates);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, task: updated }) }],
      };
    }
  );

  // 3. task_get
  server.tool(
    "task_get",
    "Get details of a specific task",
    {
      taskId: z.string().describe("Task ID or title fragment"),
    },
    async ({ taskId }) => {
      const config = await store.getConfig();
      const task = await taskStore.resolve(taskId, config.activeProjectId ?? undefined);
      if (!task) {
        return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(task) }] };
    }
  );

  // 4. task_list
  server.tool(
    "task_list",
    "List all tasks, optionally filtered by status",
    {
      status: z.enum(["todo", "doing", "done"]).optional().describe("Filter by status"),
    },
    async ({ status }) => {
      const config = await store.getConfig();
      let tasks = await taskStore.list(config.activeProjectId ?? undefined);
      if (status) {
        tasks = tasks.filter((t) => t.status === status);
      }
      const summary = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        tags: t.tags,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary) }] };
    }
  );

  // 5. task_move
  server.tool(
    "task_move",
    "Move a task to a different status column",
    {
      taskId: z.string().describe("Task ID or title fragment"),
      status: z.enum(["todo", "doing", "done"]).describe("Target status"),
    },
    async ({ taskId, status }) => {
      const config = await store.getConfig();
      const task = await taskStore.resolve(taskId, config.activeProjectId ?? undefined);
      if (!task) {
        return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };
      }

      const oldStatus = task.status;
      await taskStore.update(task.id, { status });

      if (config.activeProjectId) {
        await boardStore.moveTask(config.activeProjectId, task.id, status);
      }

      if (config.activeSessionId) {
        if (status === "doing") {
          await sessionStore.setActiveTask(config.activeSessionId, task.id);
        } else if (oldStatus === "doing") {
          await sessionStore.setActiveTask(config.activeSessionId, null);
        }
        if (status === "done") {
          await sessionStore.addCompletedTask(config.activeSessionId, task.id);
        }
      }

      // v2.0: Auto-record completion history
      if (status === "done" && historyStore) {
        const actualMinutes = Math.round(task.totalSeconds / 60);
        await historyStore.recordCompletion(
          task.id, task.title, task.tags,
          task.complexity ?? null,
          task.estimatedMinutes ?? null,
          actualMinutes
        );
      }

      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, id: task.id, from: oldStatus, to: status }) },
        ],
      };
    }
  );

  // 6. task_delete
  server.tool(
    "task_delete",
    "Delete a task from the board",
    {
      taskId: z.string().describe("Task ID or title fragment"),
      archive: z.boolean().optional().describe("Archive instead of delete (default: true)"),
    },
    async ({ taskId, archive }) => {
      const config = await store.getConfig();
      const task = await taskStore.resolve(taskId, config.activeProjectId ?? undefined);
      if (!task) {
        return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };
      }

      if (config.activeProjectId) {
        await boardStore.removeTask(config.activeProjectId, task.id);
      }

      if (archive !== false) {
        await taskStore.archive(task.id);
      } else {
        await taskStore.delete(task.id);
      }

      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, id: task.id, archived: archive !== false }) },
        ],
      };
    }
  );
}
