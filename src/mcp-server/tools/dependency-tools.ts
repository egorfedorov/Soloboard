import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStore } from "../storage/task-store.js";
import { BoardStore } from "../storage/board-store.js";
import { Store } from "../storage/store.js";
import { Task, formatDuration } from "../models/task.js";

export function registerDependencyTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  boardStore: BoardStore
) {
  // task_depend — add or remove dependency between tasks
  server.tool(
    "task_depend",
    "Add a dependency: taskId is blocked by blockerId. Both must exist. Use action='remove' to remove.",
    {
      taskId: z.string().describe("Task that is blocked (ID or title)"),
      blockerId: z.string().describe("Task that blocks (ID or title)"),
      action: z.enum(["add", "remove"]).optional().describe("add or remove (default: add)"),
    },
    async ({ taskId, blockerId, action }) => {
      const config = await store.getConfig();
      const pid = config.activeProjectId ?? undefined;

      const task = await taskStore.resolve(taskId, pid);
      if (!task) return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };

      const blocker = await taskStore.resolve(blockerId, pid);
      if (!blocker) return { content: [{ type: "text", text: `Blocker task not found: ${blockerId}` }] };

      if (task.id === blocker.id) {
        return { content: [{ type: "text", text: "A task cannot depend on itself." }] };
      }

      const taskBlockedBy = task.blockedBy ?? [];
      const blockerBlocks = blocker.blocks ?? [];

      if (action === "remove") {
        await taskStore.update(task.id, {
          blockedBy: taskBlockedBy.filter((id) => id !== blocker.id),
        } as any);
        await taskStore.update(blocker.id, {
          blocks: blockerBlocks.filter((id) => id !== task.id),
        } as any);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, removed: true, task: task.id, blocker: blocker.id }) }],
        };
      }

      // Check for circular dependency
      if (await wouldCreateCycle(taskStore, blocker.id, task.id, pid)) {
        return { content: [{ type: "text", text: "Cannot add: would create a circular dependency." }] };
      }

      // Add dependency
      if (!taskBlockedBy.includes(blocker.id)) {
        await taskStore.update(task.id, {
          blockedBy: [...taskBlockedBy, blocker.id],
        } as any);
      }
      if (!blockerBlocks.includes(task.id)) {
        await taskStore.update(blocker.id, {
          blocks: [...blockerBlocks, task.id],
        } as any);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              dependency: `"${task.title}" is blocked by "${blocker.title}"`,
            }),
          },
        ],
      };
    }
  );

  // task_blockers — show what's blocking a task, or all blocked tasks
  server.tool(
    "task_blockers",
    "Show dependency graph: what blocks what. Optionally for a specific task.",
    {
      taskId: z.string().optional().describe("Task ID or title (omit for full graph)"),
    },
    async ({ taskId }) => {
      const config = await store.getConfig();
      const pid = config.activeProjectId ?? undefined;
      const tasks = await taskStore.list(pid);

      if (taskId) {
        const task = await taskStore.resolve(taskId, pid);
        if (!task) return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };

        const lines: string[] = [`# Dependencies: ${task.title}`, ""];

        // What blocks this task
        const blockedBy = (task.blockedBy ?? []).filter((id) => tasks.some((t) => t.id === id));
        if (blockedBy.length > 0) {
          lines.push("**Blocked by:**");
          for (const bid of blockedBy) {
            const b = tasks.find((t) => t.id === bid);
            if (b) {
              const done = b.status === "done" ? " ✓" : "";
              lines.push(`  - ${b.title} (${b.status})${done}`);
            }
          }
        } else {
          lines.push("**Not blocked by anything** — ready to work on");
        }
        lines.push("");

        // What this task blocks
        const blocking = (task.blocks ?? []).filter((id) => tasks.some((t) => t.id === id));
        if (blocking.length > 0) {
          lines.push("**Blocks:**");
          for (const bid of blocking) {
            const b = tasks.find((t) => t.id === bid);
            if (b) lines.push(`  - ${b.title} (${b.status})`);
          }
        }

        const isReady = blockedBy.every((id) => {
          const t = tasks.find((t) => t.id === id);
          return t?.status === "done";
        });
        if (blockedBy.length > 0) {
          lines.push("", isReady ? "**Status: UNBLOCKED** — all blockers are done" : "**Status: BLOCKED** — waiting on dependencies");
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // Full dependency graph
      const withDeps = tasks.filter((t) => (t.blockedBy?.length ?? 0) > 0 || (t.blocks?.length ?? 0) > 0);
      if (withDeps.length === 0) {
        return { content: [{ type: "text", text: "No dependencies set. Use task_depend to add them." }] };
      }

      const lines: string[] = ["# Dependency Graph", ""];
      const blocked = tasks.filter((t) => {
        const deps = t.blockedBy ?? [];
        return deps.length > 0 && deps.some((id) => {
          const dep = tasks.find((d) => d.id === id);
          return dep && dep.status !== "done";
        });
      });

      if (blocked.length > 0) {
        lines.push(`**Blocked tasks (${blocked.length}):**`);
        for (const t of blocked) {
          const blockerNames = (t.blockedBy ?? [])
            .map((id) => tasks.find((d) => d.id === id)?.title ?? id)
            .join(", ");
          lines.push(`  - ${t.title} ← blocked by: ${blockerNames}`);
        }
        lines.push("");
      }

      const ready = tasks.filter((t) => {
        const deps = t.blockedBy ?? [];
        return t.status !== "done" && deps.length > 0 && deps.every((id) => {
          const dep = tasks.find((d) => d.id === id);
          return dep?.status === "done";
        });
      });

      if (ready.length > 0) {
        lines.push(`**Ready to start (unblocked):**`);
        for (const t of ready) lines.push(`  - ${t.title}`);
        lines.push("");
      }

      // Show full graph
      lines.push("**All dependencies:**");
      for (const t of withDeps) {
        const deps = (t.blockedBy ?? []).map((id) => tasks.find((d) => d.id === id)?.title ?? id);
        if (deps.length > 0) {
          lines.push(`  ${t.title} ← ${deps.join(", ")}`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  // critical_path — find the longest chain of dependent tasks
  server.tool(
    "critical_path",
    "Find the critical path: the longest chain of dependent tasks that determines the minimum project time.",
    {},
    async () => {
      const config = await store.getConfig();
      const pid = config.activeProjectId ?? undefined;
      const tasks = await taskStore.list(pid);
      const incomplete = tasks.filter((t) => t.status !== "done");

      if (incomplete.length === 0) {
        return { content: [{ type: "text", text: "All tasks are done! No critical path." }] };
      }

      // Build adjacency list: task -> tasks it blocks
      const graph = new Map<string, string[]>();
      const inDegree = new Map<string, number>();

      for (const t of incomplete) {
        graph.set(t.id, []);
        inDegree.set(t.id, 0);
      }

      for (const t of incomplete) {
        for (const blockerId of t.blockedBy ?? []) {
          if (graph.has(blockerId)) {
            graph.get(blockerId)!.push(t.id);
            inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
          }
        }
      }

      // Topological sort + longest path using dynamic programming
      const dist = new Map<string, number>();
      const prev = new Map<string, string | null>();
      const queue: string[] = [];

      for (const t of incomplete) {
        const est = t.estimatedMinutes ?? 30; // default 30min if not estimated
        dist.set(t.id, est);
        prev.set(t.id, null);
        if ((inDegree.get(t.id) ?? 0) === 0) {
          queue.push(t.id);
        }
      }

      // Process in topological order
      const processed: string[] = [];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        processed.push(curr);
        const currDist = dist.get(curr) ?? 0;

        for (const next of graph.get(curr) ?? []) {
          const nextEst = incomplete.find((t) => t.id === next)?.estimatedMinutes ?? 30;
          if (currDist + nextEst > (dist.get(next) ?? 0)) {
            dist.set(next, currDist + nextEst);
            prev.set(next, curr);
          }
          inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
          if (inDegree.get(next) === 0) {
            queue.push(next);
          }
        }
      }

      // Find the longest path end
      let maxId = incomplete[0].id;
      let maxDist = 0;
      for (const [id, d] of dist) {
        if (d > maxDist) {
          maxDist = d;
          maxId = id;
        }
      }

      // Trace back the path
      const path: string[] = [];
      let current: string | null = maxId;
      while (current) {
        path.unshift(current);
        current = prev.get(current) ?? null;
      }

      const lines: string[] = ["# Critical Path", ""];

      if (path.length <= 1 && (incomplete[0]?.blockedBy?.length ?? 0) === 0) {
        lines.push("No dependency chain found. All tasks are independent.");
        lines.push("", "**Tip:** Use `task_depend` to set up dependencies, then critical path will show the bottleneck chain.");
      } else {
        lines.push(`**Longest chain:** ${path.length} tasks, ~${formatDuration(maxDist * 60)}`, "");
        for (let i = 0; i < path.length; i++) {
          const t = incomplete.find((x) => x.id === path[i]);
          if (t) {
            const est = t.estimatedMinutes ?? 30;
            const arrow = i < path.length - 1 ? " →" : " ★";
            const status = t.status === "doing" ? " (IN PROGRESS)" : "";
            lines.push(`  ${i + 1}. ${t.title} (~${est}min)${status}${arrow}`);
          }
        }
      }

      // Show tasks not on critical path (can be parallelized)
      const onPath = new Set(path);
      const parallel = incomplete.filter((t) => !onPath.has(t.id));
      if (parallel.length > 0) {
        lines.push("", `**Parallelizable tasks (${parallel.length}):** not on critical path`);
        for (const t of parallel) {
          lines.push(`  - ${t.title}`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}

// Check if adding blockerId -> taskId dependency would create a cycle
async function wouldCreateCycle(
  taskStore: TaskStore,
  fromId: string,
  toId: string,
  projectId?: string
): Promise<boolean> {
  // DFS from toId following blockedBy edges, looking for fromId
  const visited = new Set<string>();
  const stack = [toId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === fromId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const task = await taskStore.get(current);
    if (task) {
      for (const dep of task.blocks ?? []) {
        stack.push(dep);
      }
    }
  }
  return false;
}
