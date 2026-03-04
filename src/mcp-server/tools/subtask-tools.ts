import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStore } from "../storage/task-store.js";
import { BoardStore } from "../storage/board-store.js";
import { SessionStore } from "../storage/session-store.js";
import { Store } from "../storage/store.js";
import { TaskStatus } from "../models/task.js";

export function registerSubtaskTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  boardStore: BoardStore,
  sessionStore: SessionStore
) {
  // task_split — break a task into subtasks
  server.tool(
    "task_split",
    "Split a task into subtasks. The parent task becomes a container. Each subtask gets its own status, priority, and tracking.",
    {
      taskId: z.string().describe("Parent task ID or title"),
      subtasks: z.array(z.object({
        title: z.string().describe("Subtask title"),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        estimatedMinutes: z.number().optional(),
      })).describe("List of subtasks to create"),
    },
    async ({ taskId, subtasks }) => {
      const config = await store.getConfig();
      const pid = config.activeProjectId;
      if (!pid) return { content: [{ type: "text", text: "No active project." }] };

      const parent = await taskStore.resolve(taskId, pid);
      if (!parent) return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };

      const created: { id: string; title: string }[] = [];

      for (const sub of subtasks) {
        const task = await taskStore.create(sub.title, pid, {
          description: sub.description,
          priority: sub.priority ?? parent.priority,
          tags: [...parent.tags],
          status: "todo",
        });

        // Set parent-child relationship
        await taskStore.update(task.id, {
          parentId: parent.id,
          estimatedMinutes: sub.estimatedMinutes ?? null,
        } as any);

        // Add to board
        await boardStore.addTask(pid, task.id, "todo");

        if (config.activeSessionId) {
          await sessionStore.addCreatedTask(config.activeSessionId, task.id);
        }

        created.push({ id: task.id, title: task.title });
      }

      // Update parent with subtask IDs
      const subtaskIds = [...(parent.subtaskIds ?? []), ...created.map((c) => c.id)];
      await taskStore.update(parent.id, { subtaskIds } as any);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              parent: { id: parent.id, title: parent.title },
              subtasks: created,
              total: subtaskIds.length,
            }),
          },
        ],
      };
    }
  );

  // task_subtasks — view subtask progress for a parent task
  server.tool(
    "task_subtasks",
    "View all subtasks of a parent task with their progress.",
    {
      taskId: z.string().describe("Parent task ID or title"),
    },
    async ({ taskId }) => {
      const config = await store.getConfig();
      const pid = config.activeProjectId ?? undefined;

      const parent = await taskStore.resolve(taskId, pid);
      if (!parent) return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };

      const subtaskIds = parent.subtaskIds ?? [];
      if (subtaskIds.length === 0) {
        return { content: [{ type: "text", text: `"${parent.title}" has no subtasks. Use task_split to break it down.` }] };
      }

      const lines: string[] = [`# ${parent.title}`, ""];
      let done = 0;
      let total = 0;

      for (const id of subtaskIds) {
        const sub = await taskStore.get(id);
        if (sub) {
          total++;
          if (sub.status === "done") done++;
          const check = sub.status === "done" ? "✓" : sub.status === "doing" ? "●" : "○";
          const prio = sub.priority === "high" ? " !!!" : sub.priority === "medium" ? " !!" : "";
          const est = sub.estimatedMinutes ? ` (~${sub.estimatedMinutes}min)` : "";
          lines.push(`  ${check} ${sub.title}${prio}${est} [${sub.status}]`);
        }
      }

      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      lines.unshift(`Progress: ${done}/${total} (${pct}%)`);

      // Auto-complete parent if all subtasks are done
      if (total > 0 && done === total && parent.status !== "done") {
        lines.push("", "**All subtasks complete!** Consider moving parent to DONE.");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
