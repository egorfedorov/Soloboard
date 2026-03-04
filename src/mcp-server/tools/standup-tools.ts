import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStore } from "../storage/task-store.js";
import { BoardStore } from "../storage/board-store.js";
import { SprintStore } from "../storage/sprint-store.js";
import { Store } from "../storage/store.js";
import { Task, formatDuration } from "../models/task.js";

export function registerStandupTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  boardStore: BoardStore,
  sprintStore: SprintStore
) {
  // standup — daily standup summary
  server.tool(
    "standup",
    "Generate a daily standup summary: what was done, what's in progress, what's blocked. Shows last 24h activity.",
    {},
    async () => {
      const config = await store.getConfig();
      const pid = config.activeProjectId;
      if (!pid) return { content: [{ type: "text", text: "No active project." }] };

      const tasks = await taskStore.list(pid);
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;

      // Recently completed (in last 24h)
      const recentlyDone = tasks.filter((t) => {
        if (t.status !== "done" || !t.completedAt) return false;
        return new Date(t.completedAt).getTime() > dayAgo;
      });

      // Currently in progress
      const inProgress = tasks.filter((t) => t.status === "doing");

      // Blocked tasks
      const blocked = tasks.filter((t) => {
        if (t.status === "done") return false;
        const deps = t.blockedBy ?? [];
        return deps.length > 0 && deps.some((id) => {
          const dep = tasks.find((d) => d.id === id);
          return dep && dep.status !== "done";
        });
      });

      // Recently created
      const recentlyCreated = tasks.filter((t) => {
        return new Date(t.createdAt).getTime() > dayAgo && t.status !== "done";
      });

      // Time spent today
      const todayTime = tasks.reduce((sum, t) => {
        for (const entry of t.timeLog ?? []) {
          const entryStart = new Date(entry.start).getTime();
          const entryEnd = entry.end ? new Date(entry.end).getTime() : now;
          if (entryEnd > dayAgo) {
            const effectiveStart = Math.max(entryStart, dayAgo);
            sum += Math.round((entryEnd - effectiveStart) / 1000);
          }
        }
        return sum;
      }, 0);

      const lines: string[] = [
        "# Daily Standup",
        `_${new Date().toISOString().split("T")[0]}_`,
        "",
      ];

      // Done
      lines.push(`## Done (${recentlyDone.length})`);
      if (recentlyDone.length > 0) {
        for (const t of recentlyDone) {
          const time = t.totalSeconds > 0 ? ` (${formatDuration(t.totalSeconds)})` : "";
          lines.push(`  ✓ ${t.title}${time}`);
        }
      } else {
        lines.push("  (nothing completed in last 24h)");
      }
      lines.push("");

      // In Progress
      lines.push(`## In Progress (${inProgress.length})`);
      if (inProgress.length > 0) {
        for (const t of inProgress) {
          const time = t.totalSeconds > 0 ? ` (${formatDuration(t.totalSeconds)})` : "";
          const subtaskCount = (t.subtaskIds ?? []).length;
          const subtaskInfo = subtaskCount > 0 ? ` [${subtaskCount} subtasks]` : "";
          lines.push(`  ● ${t.title}${time}${subtaskInfo}`);
        }
      } else {
        lines.push("  (nothing in progress)");
      }
      lines.push("");

      // Blocked
      if (blocked.length > 0) {
        lines.push(`## Blocked (${blocked.length})`);
        for (const t of blocked) {
          const blockerNames = (t.blockedBy ?? [])
            .map((id) => tasks.find((d) => d.id === id)?.title ?? id)
            .join(", ");
          lines.push(`  ⊘ ${t.title} ← ${blockerNames}`);
        }
        lines.push("");
      }

      // Up Next (todo, sorted by priority)
      const upcoming = tasks
        .filter((t) => t.status === "todo")
        .sort((a, b) => {
          const po = { high: 0, medium: 1, low: 2 };
          return po[a.priority] - po[b.priority];
        })
        .slice(0, 5);
      if (upcoming.length > 0) {
        lines.push(`## Up Next`);
        for (const t of upcoming) {
          const prio = t.priority === "high" ? " !!!" : t.priority === "medium" ? " !!" : "";
          lines.push(`  ○ ${t.title}${prio}`);
        }
        lines.push("");
      }

      // Sprint progress if active
      const activeSprint = await sprintStore.getActive(pid);
      if (activeSprint) {
        const sprintTasks = activeSprint.taskIds;
        let sprintDone = 0;
        for (const tid of sprintTasks) {
          const t = await taskStore.get(tid);
          if (t?.status === "done") sprintDone++;
        }
        const pct = sprintTasks.length > 0 ? Math.round((sprintDone / sprintTasks.length) * 100) : 0;
        const daysLeft = Math.max(0, Math.ceil(
          (new Date(activeSprint.endDate).getTime() - now) / (24 * 60 * 60 * 1000)
        ));
        lines.push(`## Sprint: ${activeSprint.name}`);
        lines.push(`  ${sprintDone}/${sprintTasks.length} (${pct}%) | ${daysLeft} days left`);
        lines.push("");
      }

      // Stats
      if (todayTime > 0) {
        lines.push(`---`);
        lines.push(`Time today: ${formatDuration(todayTime)}`);
      }

      const totalTodo = tasks.filter((t) => t.status === "todo").length;
      const totalDoing = tasks.filter((t) => t.status === "doing").length;
      const totalDone = tasks.filter((t) => t.status === "done").length;
      lines.push(`Board: TODO ${totalTodo} | DOING ${totalDoing} | DONE ${totalDone}`);

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // pomodoro_start — start a focus timer on a task
  server.tool(
    "pomodoro_start",
    "Start a focus session (pomodoro) on a task. Sets task to DOING and records the start time. Default: 25 minutes.",
    {
      taskId: z.string().describe("Task ID or title"),
      minutes: z.number().optional().describe("Focus duration in minutes (default: 25)"),
    },
    async ({ taskId, minutes }) => {
      const config = await store.getConfig();
      const pid = config.activeProjectId;
      if (!pid) return { content: [{ type: "text", text: "No active project." }] };

      const task = await taskStore.resolve(taskId, pid);
      if (!task) return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };

      const duration = minutes ?? 25;

      // Move to doing if not already
      if (task.status !== "doing") {
        await taskStore.update(task.id, { status: "doing" });
        const board = await boardStore.get(pid);
        if (board) await boardStore.moveTask(pid, task.id, "doing");
      }

      // Store pomodoro info in config (lightweight, no new model)
      const pomodoroData = {
        taskId: task.id,
        taskTitle: task.title,
        startedAt: new Date().toISOString(),
        durationMinutes: duration,
        endsAt: new Date(Date.now() + duration * 60 * 1000).toISOString(),
      };

      // Save to a temp file
      await store.writeJson(`${store.root}/pomodoro.json`, pomodoroData);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              pomodoro: {
                task: task.title,
                duration: `${duration}min`,
                endsAt: pomodoroData.endsAt,
              },
              message: `Focus session started! ${duration} minutes on "${task.title}".`,
            }),
          },
        ],
      };
    }
  );

  // pomodoro_status — check current pomodoro
  server.tool(
    "pomodoro_status",
    "Check the status of the current pomodoro focus session.",
    {},
    async () => {
      const pomo = await store.readJson<{
        taskId: string;
        taskTitle: string;
        startedAt: string;
        durationMinutes: number;
        endsAt: string;
      }>(`${store.root}/pomodoro.json`);

      if (!pomo) {
        return { content: [{ type: "text", text: "No active pomodoro. Use pomodoro_start to begin a focus session." }] };
      }

      const now = Date.now();
      const end = new Date(pomo.endsAt).getTime();
      const start = new Date(pomo.startedAt).getTime();
      const elapsed = Math.round((now - start) / 1000);
      const remaining = Math.max(0, Math.round((end - now) / 1000));
      const isComplete = now >= end;

      const lines: string[] = [];

      if (isComplete) {
        lines.push(`# Pomodoro Complete!`);
        lines.push(`Task: ${pomo.taskTitle}`);
        lines.push(`Duration: ${pomo.durationMinutes}min`);
        lines.push("");
        lines.push("Take a break! Then start another pomodoro or switch tasks.");

        // Clean up
        await store.deleteFile(`${store.root}/pomodoro.json`);
      } else {
        const pct = Math.round((elapsed / (pomo.durationMinutes * 60)) * 100);
        const bar = Array(20).fill("░");
        const filled = Math.round(pct / 5);
        for (let i = 0; i < filled; i++) bar[i] = "█";

        lines.push(`# Pomodoro: ${pomo.taskTitle}`);
        lines.push(`[${bar.join("")}] ${pct}%`);
        lines.push(`Elapsed: ${formatDuration(elapsed)} | Remaining: ${formatDuration(remaining)}`);
        lines.push("");
        lines.push("Stay focused! 🎯");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
