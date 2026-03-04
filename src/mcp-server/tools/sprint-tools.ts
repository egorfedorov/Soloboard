import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStore } from "../storage/task-store.js";
import { SprintStore } from "../storage/sprint-store.js";
import { Store } from "../storage/store.js";
import { Task, formatDuration } from "../models/task.js";

export function registerSprintTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  sprintStore: SprintStore
) {
  // sprint_create
  server.tool(
    "sprint_create",
    "Create a new sprint (time-boxed period). Optionally start it immediately.",
    {
      name: z.string().describe("Sprint name (e.g. 'Week 12' or 'Auth Sprint')"),
      durationDays: z.number().optional().describe("Duration in days (default: 7)"),
      start: z.boolean().optional().describe("Start the sprint immediately (default: false)"),
    },
    async ({ name, durationDays, start }) => {
      const config = await store.getConfig();
      if (!config.activeProjectId) {
        return { content: [{ type: "text", text: "No active project." }] };
      }

      // Check for existing active sprint
      if (start) {
        const active = await sprintStore.getActive(config.activeProjectId);
        if (active) {
          return { content: [{ type: "text", text: `Sprint "${active.name}" is already active. Close it first with sprint_close.` }] };
        }
      }

      const sprint = await sprintStore.create(name, config.activeProjectId, durationDays);

      if (start) {
        await sprintStore.update(sprint.id, { status: "active" });
        sprint.status = "active";
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              sprint: {
                id: sprint.id,
                name: sprint.name,
                status: sprint.status,
                startDate: sprint.startDate,
                endDate: sprint.endDate,
              },
            }),
          },
        ],
      };
    }
  );

  // sprint_add — add tasks to a sprint
  server.tool(
    "sprint_add",
    "Add one or more tasks to a sprint.",
    {
      sprintId: z.string().optional().describe("Sprint ID or name (default: active sprint)"),
      taskIds: z.array(z.string()).describe("Task IDs or titles to add"),
    },
    async ({ sprintId, taskIds }) => {
      const config = await store.getConfig();
      const pid = config.activeProjectId;
      if (!pid) return { content: [{ type: "text", text: "No active project." }] };

      let sprint = sprintId
        ? (await sprintStore.get(sprintId)) ?? (await sprintStore.findByName(sprintId, pid))
        : await sprintStore.getActive(pid);

      if (!sprint) {
        return { content: [{ type: "text", text: sprintId ? `Sprint not found: ${sprintId}` : "No active sprint. Create one with sprint_create." }] };
      }

      const added: string[] = [];
      for (const tid of taskIds) {
        const task = await taskStore.resolve(tid, pid);
        if (task) {
          await sprintStore.addTask(sprint.id, task.id);
          await taskStore.update(task.id, { sprintId: sprint.id } as any);
          added.push(task.title);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, sprint: sprint.name, added, total: sprint.taskIds.length + added.length }),
          },
        ],
      };
    }
  );

  // sprint_close — close the active sprint
  server.tool(
    "sprint_close",
    "Close a sprint. Incomplete tasks can optionally be moved to the next sprint.",
    {
      sprintId: z.string().optional().describe("Sprint ID or name (default: active sprint)"),
      moveIncomplete: z.boolean().optional().describe("Move incomplete tasks to a new sprint (default: false)"),
    },
    async ({ sprintId, moveIncomplete }) => {
      const config = await store.getConfig();
      const pid = config.activeProjectId;
      if (!pid) return { content: [{ type: "text", text: "No active project." }] };

      let sprint = sprintId
        ? (await sprintStore.get(sprintId)) ?? (await sprintStore.findByName(sprintId, pid))
        : await sprintStore.getActive(pid);

      if (!sprint) {
        return { content: [{ type: "text", text: "No active sprint to close." }] };
      }

      // Gather stats
      let done = 0;
      let incomplete = 0;
      const incompleteTasks: string[] = [];

      for (const tid of sprint.taskIds) {
        const task = await taskStore.get(tid);
        if (task) {
          if (task.status === "done") {
            done++;
          } else {
            incomplete++;
            incompleteTasks.push(tid);
          }
        }
      }

      await sprintStore.update(sprint.id, { status: "completed" });

      const result: any = {
        ok: true,
        sprint: sprint.name,
        completed: done,
        incomplete,
        total: sprint.taskIds.length,
      };

      // Move incomplete tasks to new sprint if requested
      if (moveIncomplete && incompleteTasks.length > 0) {
        const nextSprint = await sprintStore.create(`${sprint.name} (cont.)`, pid, 7);
        await sprintStore.update(nextSprint.id, { status: "active" });
        for (const tid of incompleteTasks) {
          await sprintStore.addTask(nextSprint.id, tid);
          await taskStore.update(tid, { sprintId: nextSprint.id } as any);
        }
        result.nextSprint = { id: nextSprint.id, name: nextSprint.name, tasks: incompleteTasks.length };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }
  );

  // sprint_view — view sprint with task progress
  server.tool(
    "sprint_view",
    "View sprint progress with task breakdown.",
    {
      sprintId: z.string().optional().describe("Sprint ID or name (default: active sprint)"),
    },
    async ({ sprintId }) => {
      const config = await store.getConfig();
      const pid = config.activeProjectId;
      if (!pid) return { content: [{ type: "text", text: "No active project." }] };

      let sprint = sprintId
        ? (await sprintStore.get(sprintId)) ?? (await sprintStore.findByName(sprintId, pid))
        : await sprintStore.getActive(pid);

      if (!sprint) {
        // Show all sprints if none specified
        const all = await sprintStore.list(pid);
        if (all.length === 0) {
          return { content: [{ type: "text", text: "No sprints yet. Use sprint_create to start one." }] };
        }
        const lines = ["# All Sprints", ""];
        for (const s of all) {
          const status = s.status === "active" ? " ← active" : s.status === "completed" ? " ✓" : "";
          lines.push(`- ${s.name} (${s.taskIds.length} tasks)${status}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // Calculate sprint progress
      const now = Date.now();
      const start = new Date(sprint.startDate).getTime();
      const end = new Date(sprint.endDate).getTime();
      const totalDuration = end - start;
      const elapsed = now - start;
      const timePct = Math.min(100, Math.max(0, Math.round((elapsed / totalDuration) * 100)));

      const tasks: Task[] = [];
      for (const tid of sprint.taskIds) {
        const t = await taskStore.get(tid);
        if (t) tasks.push(t);
      }

      const done = tasks.filter((t) => t.status === "done").length;
      const doing = tasks.filter((t) => t.status === "doing").length;
      const todo = tasks.filter((t) => t.status === "todo").length;
      const taskPct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;

      const totalTime = tasks.reduce((sum, t) => sum + (t.totalSeconds || 0), 0);
      const estTime = tasks.reduce((sum, t) => sum + ((t.estimatedMinutes ?? 0) * 60), 0);

      const daysLeft = Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));

      const lines = [
        `# Sprint: ${sprint.name}`,
        `Status: ${sprint.status} | ${daysLeft} days left`,
        "",
        `**Time:** ${timePct}% elapsed`,
        `**Tasks:** ${done}/${tasks.length} done (${taskPct}%)`,
        `  TODO: ${todo} | DOING: ${doing} | DONE: ${done}`,
      ];

      if (totalTime > 0) {
        lines.push(`**Time spent:** ${formatDuration(totalTime)}${estTime > 0 ? ` / est. ${formatDuration(estTime)}` : ""}`);
      }

      // Burndown indicator
      if (tasks.length > 0) {
        const bar = Array(20).fill("░");
        const filled = Math.round((done / tasks.length) * 20);
        for (let i = 0; i < filled; i++) bar[i] = "█";
        lines.push("", `Progress: [${bar.join("")}] ${taskPct}%`);
      }

      // Task list
      lines.push("");
      const sections = [
        { label: "DOING", list: tasks.filter((t) => t.status === "doing") },
        { label: "TODO", list: tasks.filter((t) => t.status === "todo") },
        { label: "DONE", list: tasks.filter((t) => t.status === "done") },
      ];
      for (const { label, list } of sections) {
        if (list.length > 0) {
          lines.push(`**${label}:**`);
          for (const t of list) {
            const est = t.estimatedMinutes ? ` (~${t.estimatedMinutes}min)` : "";
            const check = t.status === "done" ? "✓" : t.status === "doing" ? "●" : "○";
            lines.push(`  ${check} ${t.title}${est}`);
          }
        }
      }

      // Warning if behind schedule
      if (timePct > taskPct + 20 && sprint.status === "active") {
        lines.push("", "⚠ **Behind schedule** — time is ahead of task completion.");
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
