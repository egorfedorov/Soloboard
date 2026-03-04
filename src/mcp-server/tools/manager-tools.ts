import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStore } from "../storage/task-store.js";
import { BoardStore } from "../storage/board-store.js";
import { SprintStore } from "../storage/sprint-store.js";
import { Store } from "../storage/store.js";
import { Task, formatDuration, comparePriority } from "../models/task.js";

export function registerManagerTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  boardStore: BoardStore,
  sprintStore: SprintStore
) {
  // manager_report — comprehensive project status report
  server.tool(
    "manager_report",
    "Autonomous project manager report: health score, stalls, blockers, suggestions, velocity, and recommended actions.",
    {},
    async () => {
      const config = await store.getConfig();
      const pid = config.activeProjectId;
      if (!pid) return { content: [{ type: "text", text: "No active project." }] };

      const tasks = await taskStore.list(pid);
      const board = await boardStore.get(pid);
      if (!board) return { content: [{ type: "text", text: "Board not found." }] };

      const now = Date.now();

      // Task categorization
      const todo = tasks.filter((t) => t.status === "todo");
      const doing = tasks.filter((t) => t.status === "doing");
      const done = tasks.filter((t) => t.status === "done");

      // Stall detection
      const stalled = detectStalls(tasks, now);

      // Blocked detection
      const blocked = tasks.filter((t) => {
        if (t.status === "done") return false;
        return (t.blockedBy ?? []).some((id) => {
          const dep = tasks.find((d) => d.id === id);
          return dep && dep.status !== "done";
        });
      });

      // Velocity (tasks completed per day over last 7 days)
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
      const recentDone = done.filter((t) => t.completedAt && new Date(t.completedAt).getTime() > weekAgo);
      const velocity = recentDone.length / 7;

      // Time stats
      const totalTime = tasks.reduce((sum, t) => sum + (t.totalSeconds || 0), 0);
      const avgTimePerTask = done.length > 0
        ? done.reduce((sum, t) => sum + (t.totalSeconds || 0), 0) / done.length
        : 0;

      // Health score (0-100)
      let health = 100;
      if (stalled.length > 0) health -= stalled.length * 10;
      if (blocked.length > 0) health -= blocked.length * 5;
      if (doing.length > 3) health -= 10; // too many in progress
      if (doing.length === 0 && todo.length > 0) health -= 15; // nothing started
      if (todo.length > 10) health -= 10; // backlog too big
      health = Math.max(0, Math.min(100, health));

      const healthEmoji = health >= 80 ? "🟢" : health >= 50 ? "🟡" : "🔴";

      // Build report
      const lines: string[] = [
        `# Project Manager Report`,
        `_${new Date().toISOString().split("T")[0]}_`,
        "",
        `## Health: ${healthEmoji} ${health}/100`,
        "",
        `| Metric | Value |`,
        `|--------|-------|`,
        `| TODO | ${todo.length} |`,
        `| IN PROGRESS | ${doing.length} |`,
        `| DONE | ${done.length} |`,
        `| Blocked | ${blocked.length} |`,
        `| Stalled | ${stalled.length} |`,
        `| Velocity | ${velocity.toFixed(1)} tasks/day |`,
        `| Total time | ${formatDuration(totalTime)} |`,
        `| Avg time/task | ${formatDuration(Math.round(avgTimePerTask))} |`,
        "",
      ];

      // Stall alerts
      if (stalled.length > 0) {
        lines.push("## Stalled Tasks");
        for (const { task, stalledHours } of stalled) {
          lines.push(`  ⚠ "${task.title}" — no activity for ${Math.round(stalledHours)}h`);
        }
        lines.push("");
      }

      // Blocked alerts
      if (blocked.length > 0) {
        lines.push("## Blocked Tasks");
        for (const t of blocked) {
          const blockers = (t.blockedBy ?? [])
            .map((id) => tasks.find((d) => d.id === id)?.title ?? id)
            .join(", ");
          lines.push(`  ⊘ "${t.title}" ← ${blockers}`);
        }
        lines.push("");
      }

      // Suggestions
      const suggestions = generateSuggestions(tasks, stalled, blocked, doing, todo, velocity);
      if (suggestions.length > 0) {
        lines.push("## Recommended Actions");
        suggestions.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
        lines.push("");
      }

      // Sprint status
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
        if (pct < 50 && daysLeft <= 2) {
          lines.push(`  ⚠ Sprint at risk — only ${pct}% done with ${daysLeft} days left`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // stall_detect — find tasks with no recent activity
  server.tool(
    "stall_detect",
    "Find tasks that have had no activity for a specified period. Helps identify forgotten or stuck tasks.",
    {
      hours: z.number().optional().describe("Hours of inactivity to consider stalled (default: 24)"),
    },
    async ({ hours }) => {
      const config = await store.getConfig();
      const pid = config.activeProjectId;
      if (!pid) return { content: [{ type: "text", text: "No active project." }] };

      const tasks = await taskStore.list(pid);
      const now = Date.now();
      const threshold = (hours ?? 24) * 60 * 60 * 1000;

      const stalled: { task: Task; stalledHours: number }[] = [];
      for (const t of tasks) {
        if (t.status === "done") continue;
        const lastActivity = new Date(t.updatedAt).getTime();
        const idle = now - lastActivity;
        if (idle > threshold) {
          stalled.push({ task: t, stalledHours: idle / (60 * 60 * 1000) });
        }
      }

      if (stalled.length === 0) {
        return { content: [{ type: "text", text: `No stalled tasks (threshold: ${hours ?? 24}h). All tasks have recent activity.` }] };
      }

      stalled.sort((a, b) => b.stalledHours - a.stalledHours);

      const lines = [
        `# Stalled Tasks (${stalled.length})`,
        `_Threshold: ${hours ?? 24}h of inactivity_`,
        "",
      ];

      for (const { task, stalledHours } of stalled) {
        const h = Math.round(stalledHours);
        const days = h >= 24 ? ` (${Math.round(h / 24)}d)` : "";
        lines.push(`  ⚠ ${task.title} — ${h}h idle${days} [${task.status}]`);
      }

      lines.push("", "**Tip:** Consider moving stalled tasks to TODO or splitting them into smaller pieces.");

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // suggest_next — AI-powered suggestion for what to work on next
  server.tool(
    "suggest_next",
    "Suggest the best task to work on next based on priority, dependencies, sprint goals, and recent momentum.",
    {},
    async () => {
      const config = await store.getConfig();
      const pid = config.activeProjectId;
      if (!pid) return { content: [{ type: "text", text: "No active project." }] };

      const tasks = await taskStore.list(pid);
      const now = Date.now();

      // Get candidates: todo tasks that are not blocked
      const candidates = tasks.filter((t) => {
        if (t.status !== "todo") return false;
        const deps = t.blockedBy ?? [];
        return deps.every((id) => {
          const dep = tasks.find((d) => d.id === id);
          return !dep || dep.status === "done";
        });
      });

      if (candidates.length === 0) {
        const doing = tasks.filter((t) => t.status === "doing");
        if (doing.length > 0) {
          return {
            content: [{
              type: "text",
              text: `No new tasks to pick up. Continue working on: "${doing[0].title}"`,
            }],
          };
        }
        return { content: [{ type: "text", text: "No available tasks. All are done or blocked." }] };
      }

      // Score each candidate
      const scored = candidates.map((t) => {
        let score = 0;

        // Priority weight
        if (t.priority === "high") score += 30;
        else if (t.priority === "medium") score += 15;
        else score += 5;

        // Unblocks other tasks
        const unblockCount = (t.blocks ?? []).filter((id) => {
          const blocked = tasks.find((d) => d.id === id);
          return blocked && blocked.status !== "done";
        }).length;
        score += unblockCount * 20;

        // In active sprint
        const activeSprint = tasks.some((other) => other.sprintId && other.sprintId === t.sprintId);
        if (t.sprintId) score += 10;

        // Has subtasks (well-planned)
        if ((t.subtaskIds ?? []).length > 0) score += 5;

        // Shorter estimated time (quick wins)
        if (t.estimatedMinutes && t.estimatedMinutes <= 30) score += 10;

        // Age bonus (older tasks get slight boost)
        const ageHours = (now - new Date(t.createdAt).getTime()) / (60 * 60 * 1000);
        if (ageHours > 48) score += 5;

        return { task: t, score, reasons: buildReasons(t, unblockCount) };
      });

      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, 3);

      const lines = [
        "# Suggested Next Task",
        "",
        `**Recommendation:** ${top[0].task.title}`,
        `Score: ${top[0].score} | Priority: ${top[0].task.priority}`,
      ];

      if (top[0].reasons.length > 0) {
        lines.push("Why:");
        top[0].reasons.forEach((r) => lines.push(`  - ${r}`));
      }

      if (top.length > 1) {
        lines.push("", "**Alternatives:**");
        for (let i = 1; i < top.length; i++) {
          lines.push(`  ${i + 1}. ${top[i].task.title} (score: ${top[i].score})`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // auto_reprioritize — smart reprioritization of all tasks
  server.tool(
    "auto_reprioritize",
    "Automatically reprioritize tasks based on dependencies, blocking count, sprint membership, age, and stall status. Shows what changed.",
    {
      apply: z.boolean().optional().describe("Actually apply changes (default: false = dry run)"),
    },
    async ({ apply }) => {
      const config = await store.getConfig();
      const pid = config.activeProjectId;
      if (!pid) return { content: [{ type: "text", text: "No active project." }] };

      const tasks = await taskStore.list(pid);
      const now = Date.now();
      const changes: { task: Task; from: string; to: string; reason: string }[] = [];

      for (const t of tasks) {
        if (t.status === "done") continue;

        let suggestedPriority = t.priority;
        let reason = "";

        // If it blocks many tasks, should be high
        const blockCount = (t.blocks ?? []).filter((id) => {
          const dep = tasks.find((d) => d.id === id);
          return dep && dep.status !== "done";
        }).length;

        if (blockCount >= 3 && t.priority !== "high") {
          suggestedPriority = "high";
          reason = `Blocks ${blockCount} tasks`;
        } else if (blockCount >= 1 && t.priority === "low") {
          suggestedPriority = "medium";
          reason = `Blocks ${blockCount} task(s)`;
        }

        // If stalled and in doing, might need attention
        const lastUpdate = new Date(t.updatedAt).getTime();
        const hoursIdle = (now - lastUpdate) / (60 * 60 * 1000);
        if (t.status === "doing" && hoursIdle > 48 && t.priority !== "high") {
          suggestedPriority = "high";
          reason = `Stalled for ${Math.round(hoursIdle)}h while in progress`;
        }

        // Sprint tasks should be at least medium
        if (t.sprintId && t.priority === "low") {
          suggestedPriority = "medium";
          reason = "In active sprint";
        }

        if (suggestedPriority !== t.priority) {
          changes.push({ task: t, from: t.priority, to: suggestedPriority, reason });

          if (apply) {
            await taskStore.update(t.id, { priority: suggestedPriority });
          }
        }
      }

      if (changes.length === 0) {
        return { content: [{ type: "text", text: "All priorities look good. No changes needed." }] };
      }

      const mode = apply ? "Applied" : "Dry run (use apply=true to save)";
      const lines = [
        `# Auto-Reprioritize — ${mode}`,
        "",
        `**${changes.length} changes:**`,
        "",
      ];

      for (const c of changes) {
        lines.push(`  ${c.task.title}: ${c.from} → **${c.to}** (${c.reason})`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // gantt_view — markdown Gantt chart
  server.tool(
    "gantt_view",
    "Show a text-based Gantt chart timeline of tasks with dependencies. Shows task ordering and parallelism.",
    {},
    async () => {
      const config = await store.getConfig();
      const pid = config.activeProjectId;
      if (!pid) return { content: [{ type: "text", text: "No active project." }] };

      const tasks = await taskStore.list(pid);
      const incomplete = tasks.filter((t) => t.status !== "done");

      if (incomplete.length === 0) {
        return { content: [{ type: "text", text: "All tasks complete! No Gantt to show." }] };
      }

      // Topological sort
      const sorted = topologicalSort(incomplete);

      // Assign time slots based on dependencies
      const slots = new Map<string, { start: number; end: number; level: number }>();
      let maxEnd = 0;

      for (const task of sorted) {
        const est = task.estimatedMinutes ?? 30;
        const deps = (task.blockedBy ?? []).filter((id) => slots.has(id));
        const startAfter = deps.length > 0
          ? Math.max(...deps.map((id) => slots.get(id)!.end))
          : 0;

        // Find a level (row) that's free at this time
        let level = 0;
        while (true) {
          const conflict = [...slots.values()].some(
            (s) => s.level === level && s.start < startAfter + est && s.end > startAfter
          );
          if (!conflict) break;
          level++;
        }

        slots.set(task.id, { start: startAfter, end: startAfter + est, level });
        maxEnd = Math.max(maxEnd, startAfter + est);
      }

      // Render Gantt
      const CHART_WIDTH = 40;
      const scale = maxEnd > 0 ? CHART_WIDTH / maxEnd : 1;

      const lines: string[] = [
        "# Gantt Chart",
        "",
      ];

      // Time header
      const timeMarks = ["0"];
      for (let i = 1; i <= 4; i++) {
        const t = Math.round((maxEnd / 4) * i);
        timeMarks.push(formatDuration(t * 60));
      }
      lines.push(`${"".padEnd(25)}|${timeMarks.join("".padEnd(Math.floor(CHART_WIDTH / 4) - 3))}|`);
      lines.push(`${"".padEnd(25)}${"─".repeat(CHART_WIDTH + 2)}`);

      // Sort by level then start time for display
      const entries = sorted.map((t) => ({
        task: t,
        slot: slots.get(t.id)!,
      }));
      entries.sort((a, b) => a.slot.start - b.slot.start || a.slot.level - b.slot.level);

      for (const { task, slot } of entries) {
        const name = task.title.slice(0, 22).padEnd(23);
        const startPos = Math.round(slot.start * scale);
        const width = Math.max(1, Math.round((slot.end - slot.start) * scale));

        const bar = " ".repeat(startPos) + (task.status === "doing" ? "█" : "▓").repeat(width);
        const padded = bar.padEnd(CHART_WIDTH);

        const deps = (task.blockedBy ?? []).length > 0 ? " ←" : "";
        const status = task.status === "doing" ? " ●" : "";
        lines.push(`${name} |${padded}|${status}${deps}`);
      }

      lines.push(`${"".padEnd(25)}${"─".repeat(CHART_WIDTH + 2)}`);

      // Legend
      lines.push("");
      lines.push("█ = In progress | ▓ = Planned | ← = Has dependencies");
      if (maxEnd > 0) {
        lines.push(`Total estimated: ${formatDuration(maxEnd * 60)}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}

// Helper: detect stalled tasks
function detectStalls(tasks: Task[], now: number, thresholdHours: number = 24): { task: Task; stalledHours: number }[] {
  const stalled: { task: Task; stalledHours: number }[] = [];
  for (const t of tasks) {
    if (t.status === "done") continue;
    if (t.status === "todo") continue; // only doing tasks can be stalled
    const lastUpdate = new Date(t.updatedAt).getTime();
    const hours = (now - lastUpdate) / (60 * 60 * 1000);
    if (hours > thresholdHours) {
      stalled.push({ task: t, stalledHours: hours });
    }
  }
  return stalled;
}

// Helper: generate suggestions
function generateSuggestions(
  tasks: Task[],
  stalled: { task: Task; stalledHours: number }[],
  blocked: Task[],
  doing: Task[],
  todo: Task[],
  velocity: number
): string[] {
  const suggestions: string[] = [];

  if (doing.length > 3) {
    suggestions.push("Too many tasks in progress. Consider finishing or parking some.");
  }
  if (doing.length === 0 && todo.length > 0) {
    suggestions.push(`Pick up a task! ${todo.length} tasks waiting. Start with the highest priority one.`);
  }
  if (stalled.length > 0) {
    suggestions.push(`${stalled.length} stalled task(s) need attention. Consider splitting or reassessing.`);
  }
  if (blocked.length > 0) {
    // Find tasks that would unblock the most
    const unblockCounts = new Map<string, number>();
    for (const t of blocked) {
      for (const bid of t.blockedBy ?? []) {
        unblockCounts.set(bid, (unblockCounts.get(bid) ?? 0) + 1);
      }
    }
    const topBlocker = [...unblockCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topBlocker) {
      const blockerTask = tasks.find((t) => t.id === topBlocker[0]);
      if (blockerTask) {
        suggestions.push(`Focus on "${blockerTask.title}" — it unblocks ${topBlocker[1]} other task(s).`);
      }
    }
  }
  if (todo.length > 10) {
    suggestions.push("Backlog is growing. Consider pruning low-priority tasks or grouping into sprints.");
  }
  if (velocity < 0.5 && todo.length > 0) {
    suggestions.push("Velocity is low. Try breaking tasks into smaller pieces for quicker wins.");
  }

  return suggestions;
}

// Helper: build reasons for suggestion scoring
function buildReasons(task: Task, unblockCount: number): string[] {
  const reasons: string[] = [];
  if (task.priority === "high") reasons.push("High priority");
  if (unblockCount > 0) reasons.push(`Unblocks ${unblockCount} task(s)`);
  if (task.sprintId) reasons.push("In current sprint");
  if (task.estimatedMinutes && task.estimatedMinutes <= 30) reasons.push("Quick win (~30min)");
  if ((task.subtaskIds ?? []).length > 0) reasons.push("Well-planned (has subtasks)");
  return reasons;
}

// Helper: topological sort
function topologicalSort(tasks: Task[]): Task[] {
  const ids = new Set(tasks.map((t) => t.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const t of tasks) {
    inDegree.set(t.id, 0);
    adj.set(t.id, []);
  }

  for (const t of tasks) {
    for (const bid of t.blockedBy ?? []) {
      if (ids.has(bid)) {
        adj.get(bid)!.push(t.id);
        inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
      }
    }
  }

  const queue = tasks.filter((t) => (inDegree.get(t.id) ?? 0) === 0);
  const result: Task[] = [];

  while (queue.length > 0) {
    // Pick highest priority first
    queue.sort(comparePriority);
    const t = queue.shift()!;
    result.push(t);

    for (const next of adj.get(t.id) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      if (inDegree.get(next) === 0) {
        const nextTask = tasks.find((x) => x.id === next);
        if (nextTask) queue.push(nextTask);
      }
    }
  }

  // Add any remaining (cycles) at the end
  for (const t of tasks) {
    if (!result.find((r) => r.id === t.id)) {
      result.push(t);
    }
  }

  return result;
}
