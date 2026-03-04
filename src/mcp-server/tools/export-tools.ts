import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStore } from "../storage/task-store.js";
import { BoardStore } from "../storage/board-store.js";
import { Store } from "../storage/store.js";
import { Task, comparePriority, formatDuration } from "../models/task.js";

function taskToMarkdown(task: Task, done: boolean = false): string {
  const checkbox = done ? "[x]" : "[ ]";
  const prio = task.priority === "high" ? " **HIGH**" : task.priority === "medium" ? " MED" : " low";
  const tags = task.tags.length > 0 ? ` \`${task.tags.join("` `")}\`` : "";
  const time = task.totalSeconds > 0 ? ` (${formatDuration(task.totalSeconds)})` : "";
  const branch = task.branch ? `\n    - Branch: \`${task.branch}\`` : "";
  const commits = task.commits.length > 0 ? `\n    - Commits: ${task.commits.map((c) => `\`${c}\``).join(", ")}` : "";
  const pr = task.pr ? `\n    - PR: ${task.pr}` : "";
  const files = task.files.length > 0 ? `\n    - Files: ${task.files.length} changed` : "";
  const desc = task.description ? `\n    > ${task.description}` : "";

  return `- ${checkbox}${prio} ${task.title}${tags}${time}${desc}${branch}${commits}${pr}${files}`;
}

export function registerExportTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  boardStore: BoardStore
) {
  // board_export — full markdown export
  server.tool(
    "board_export",
    "Export the board as clean markdown (for reports, sharing, or saving)",
    {
      includeDetails: z.boolean().optional().describe("Include git/file details (default: false)"),
    },
    async ({ includeDetails }) => {
      const config = await store.getConfig();
      if (!config.activeProjectId) {
        return { content: [{ type: "text", text: "No active project." }] };
      }

      const board = await boardStore.get(config.activeProjectId);
      if (!board) {
        return { content: [{ type: "text", text: "Board not found." }] };
      }

      const lines: string[] = [
        `# ${board.name} — Board Export`,
        `> Generated: ${new Date().toISOString().split("T")[0]}`,
        "",
      ];

      // Stats
      const allTasks = await taskStore.list(config.activeProjectId);
      const totalTime = allTasks.reduce((sum, t) => sum + (t.totalSeconds || 0), 0);
      if (totalTime > 0) {
        lines.push(`**Total time tracked:** ${formatDuration(totalTime)}`, "");
      }

      for (const col of ["doing", "todo", "done"] as const) {
        const ids = board.columns[col];
        if (ids.length === 0 && col !== "doing") continue;

        const header = col === "doing" ? "In Progress" : col === "todo" ? "To Do" : "Completed";
        lines.push(`## ${header} (${ids.length})`, "");

        const tasks: Task[] = [];
        for (const id of ids) {
          const task = await taskStore.get(id);
          if (task) tasks.push(task);
        }
        tasks.sort(comparePriority);

        if (tasks.length === 0) {
          lines.push("_(empty)_", "");
        } else {
          for (const task of tasks) {
            if (includeDetails) {
              lines.push(taskToMarkdown(task, col === "done"));
            } else {
              const prio = task.priority === "high" ? "!!!" : task.priority === "medium" ? "!!" : "!";
              const tags = task.tags.length > 0 ? ` \`${task.tags.join("` `")}\`` : "";
              const time = (task.totalSeconds || 0) > 0 ? ` (${formatDuration(task.totalSeconds)})` : "";
              const checkbox = col === "done" ? "[x]" : "[ ]";
              lines.push(`- ${checkbox} [${prio}] ${task.title}${tags}${time}`);
            }
          }
          lines.push("");
        }
      }

      lines.push("---", `_Exported from SoloBoard_`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // dashboard — multi-project overview
  server.tool(
    "dashboard",
    "Multi-project dashboard: shows all projects with task counts, active tasks, and time spent",
    {},
    async () => {
      const boards = await boardStore.list();
      const config = await store.getConfig();

      if (boards.length === 0) {
        return { content: [{ type: "text", text: "No projects yet. Use project_create to start." }] };
      }

      const lines: string[] = ["# Dashboard", ""];

      let grandTotal = 0;

      for (const board of boards) {
        const isActive = board.id === config.activeProjectId;
        const marker = isActive ? " ← active" : "";
        const todoCount = board.columns.todo.length;
        const doingCount = board.columns.doing.length;
        const doneCount = board.columns.done.length;
        const total = todoCount + doingCount + doneCount;

        lines.push(`## ${board.name}${marker}`);
        lines.push(`TODO: ${todoCount} | DOING: ${doingCount} | DONE: ${doneCount} | Total: ${total}`);

        // Show active doing tasks
        if (doingCount > 0) {
          for (const id of board.columns.doing) {
            const task = await taskStore.get(id);
            if (task) {
              const time = (task.totalSeconds || 0) > 0 ? ` (${formatDuration(task.totalSeconds)})` : "";
              lines.push(`  → ${task.title}${time}`);
            }
          }
        }

        // Calculate total time for this project
        const allTasks = await taskStore.list(board.id);
        const projectTime = allTasks.reduce((sum, t) => sum + (t.totalSeconds || 0), 0);
        grandTotal += projectTime;
        if (projectTime > 0) {
          lines.push(`  Time: ${formatDuration(projectTime)}`);
        }

        lines.push("");
      }

      if (grandTotal > 0) {
        lines.push(`---`, `**Total time across all projects:** ${formatDuration(grandTotal)}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // task_prioritize — reorder task within column
  server.tool(
    "task_prioritize",
    "Change task priority and auto-sort the column (high tasks float to top)",
    {
      taskId: z.string().describe("Task ID or title fragment"),
      priority: z.enum(["low", "medium", "high"]).describe("New priority"),
    },
    async ({ taskId, priority }) => {
      const config = await store.getConfig();
      const task = await taskStore.resolve(taskId, config.activeProjectId ?? undefined);
      if (!task) {
        return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };
      }

      const oldPriority = task.priority;
      await taskStore.update(task.id, { priority });

      // Re-sort the column by priority
      if (config.activeProjectId) {
        const board = await boardStore.get(config.activeProjectId);
        if (board) {
          const col = task.status;
          const ids = board.columns[col];
          // Load all tasks in column, sort by priority, write back
          const tasks: Task[] = [];
          for (const id of ids) {
            const t = await taskStore.get(id);
            if (t) {
              // Use updated priority for the changed task
              if (t.id === task.id) t.priority = priority;
              tasks.push(t);
            }
          }
          tasks.sort(comparePriority);
          board.columns[col] = tasks.map((t) => t.id);
          board.updatedAt = new Date().toISOString();
          await store.writeJson(store.boardPath(board.id), board);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, id: task.id, from: oldPriority, to: priority }),
          },
        ],
      };
    }
  );

  // task_time — show time tracking info for a task
  server.tool(
    "task_time",
    "Show time tracking details for a task or all tasks",
    {
      taskId: z.string().optional().describe("Task ID or title (omit for all tasks)"),
    },
    async ({ taskId }) => {
      const config = await store.getConfig();

      if (taskId) {
        const task = await taskStore.resolve(taskId, config.activeProjectId ?? undefined);
        if (!task) {
          return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };
        }

        // Calculate live time if currently doing
        let liveSeconds = task.totalSeconds || 0;
        const openEntry = (task.timeLog || []).find((e) => e.end === null);
        if (openEntry) {
          const ms = Date.now() - new Date(openEntry.start).getTime();
          liveSeconds += Math.round(ms / 1000);
        }

        const lines = [
          `**${task.title}** — ${formatDuration(liveSeconds)}`,
          `Status: ${task.status}`,
          `Sessions: ${(task.timeLog || []).length}`,
        ];
        for (const entry of task.timeLog || []) {
          const start = new Date(entry.start).toLocaleString();
          const end = entry.end ? new Date(entry.end).toLocaleString() : "now";
          lines.push(`  ${start} → ${end}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // All tasks time report
      const tasks = await taskStore.list(config.activeProjectId ?? undefined);
      if (tasks.length === 0) {
        return { content: [{ type: "text", text: "No tasks." }] };
      }

      const lines: string[] = ["# Time Report", ""];
      let total = 0;
      const sorted = [...tasks].filter((t) => (t.totalSeconds || 0) > 0 || (t.timeLog || []).some((e) => !e.end));
      sorted.sort((a, b) => (b.totalSeconds || 0) - (a.totalSeconds || 0));

      for (const t of sorted) {
        let secs = t.totalSeconds || 0;
        const open = (t.timeLog || []).find((e) => !e.end);
        if (open) secs += Math.round((Date.now() - new Date(open.start).getTime()) / 1000);
        total += secs;
        const status = t.status === "doing" ? " ●" : t.status === "done" ? " ✓" : "";
        lines.push(`- ${formatDuration(secs)} — ${t.title}${status}`);
      }

      lines.push("", `**Total: ${formatDuration(total)}**`);
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
