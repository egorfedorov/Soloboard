import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { TaskStore } from "../storage/task-store.js";
import { AgentStore } from "../storage/agent-store.js";
import { HandoffStore } from "../storage/handoff-store.js";
import { acquireLock, releaseLock, releaseAllLocks, checkLocks, listAllLocks } from "../utils/file-lock.js";

export function registerOrchestrationTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  agentStore: AgentStore,
  handoffStore: HandoffStore
) {
  // 1. agent_register
  server.tool(
    "agent_register",
    "Register an agent session for multi-agent work",
    {
      sessionId: z.string().describe("Unique session identifier for this agent"),
      name: z.string().describe("Human-readable agent name (e.g., 'backend-dev', 'reviewer')"),
    },
    async ({ sessionId, name }) => {
      const config = await store.getConfig();
      if (!config.multiAgentEnabled) {
        await store.saveConfig({ ...config, multiAgentEnabled: true });
      }
      const active = await agentStore.listActive();
      if (active.length >= config.maxParallelAgents) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `Max parallel agents (${config.maxParallelAgents}) reached` }) }] };
      }
      const agent = await agentStore.register(sessionId, name);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, agent: { id: agent.id, name: agent.name, status: agent.status } }) }] };
    }
  );

  // 2. agent_heartbeat
  server.tool(
    "agent_heartbeat",
    "Update agent heartbeat and clean stale agents (>5min inactive)",
    {
      agentId: z.string().describe("Agent ID to heartbeat"),
    },
    async ({ agentId }) => {
      const agent = await agentStore.heartbeat(agentId);
      if (!agent) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Agent not found" }) }] };
      }
      const stale = await agentStore.cleanupStale();
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, agent: { id: agent.id, status: agent.status }, staleCleaned: stale }) }] };
    }
  );

  // 3. agent_list
  server.tool(
    "agent_list",
    "List active agents with their tasks and locked files",
    {},
    async () => {
      const agents = await agentStore.list();
      const locks = await listAllLocks(store);
      const result = agents.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        activeTaskId: a.activeTaskId,
        lockedFiles: locks.filter((l) => l.agentId === a.id).map((l) => l.filePath),
        lastHeartbeat: a.lastHeartbeat,
        metrics: a.metrics,
      }));
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  // 4. agent_claim_task
  server.tool(
    "agent_claim_task",
    "Assign a task to an agent (fails if already claimed by another)",
    {
      agentId: z.string().describe("Agent ID claiming the task"),
      taskId: z.string().describe("Task ID to claim"),
    },
    async ({ agentId, taskId }) => {
      const agent = await agentStore.get(agentId);
      if (!agent) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Agent not found" }) }] };
      }
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }
      if (task.assignedAgentId && task.assignedAgentId !== agentId) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `Task already claimed by agent ${task.assignedAgentId}` }) }] };
      }
      await taskStore.update(taskId, { assignedAgentId: agentId });
      await agentStore.update(agentId, { activeTaskId: taskId });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, agentId, taskId }) }] };
    }
  );

  // 5. conflict_check
  server.tool(
    "conflict_check",
    "Check if files are locked by another agent",
    {
      agentId: z.string().describe("Your agent ID"),
      files: z.array(z.string()).describe("File paths to check"),
    },
    async ({ agentId, files }) => {
      const result = await checkLocks(store, files, agentId);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, conflicts: result.conflicts, hasConflicts: result.conflicts.length > 0 }) }] };
    }
  );

  // 6. file_lock
  server.tool(
    "file_lock",
    "Lock files to prevent concurrent edits by other agents",
    {
      agentId: z.string().describe("Agent ID requesting locks"),
      files: z.array(z.string()).describe("File paths to lock"),
    },
    async ({ agentId, files }) => {
      const results: Array<{ file: string; ok: boolean; holder?: string }> = [];
      for (const file of files) {
        const r = await acquireLock(store, file, agentId);
        results.push({ file, ok: r.ok, holder: r.holder });
      }
      const allOk = results.every((r) => r.ok);
      return { content: [{ type: "text", text: JSON.stringify({ ok: allOk, results }) }] };
    }
  );

  // 7. file_unlock
  server.tool(
    "file_unlock",
    "Release file locks held by an agent",
    {
      agentId: z.string().describe("Agent ID releasing locks"),
      files: z.array(z.string()).optional().describe("File paths to unlock (omit for all)"),
    },
    async ({ agentId, files }) => {
      if (files) {
        const results: Array<{ file: string; released: boolean }> = [];
        for (const file of files) {
          const released = await releaseLock(store, file, agentId);
          results.push({ file, released });
        }
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, results }) }] };
      } else {
        const count = await releaseAllLocks(store, agentId);
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, releasedCount: count }) }] };
      }
    }
  );

  // 8. agent_handoff
  server.tool(
    "agent_handoff",
    "Create handoff context for another agent, release locks, unassign task",
    {
      agentId: z.string().describe("Agent handing off"),
      taskId: z.string().describe("Task being handed off"),
      summary: z.string().describe("Summary of work done"),
      decisions: z.array(z.string()).optional().describe("Key decisions made"),
      remainingWork: z.array(z.string()).optional().describe("What still needs to be done"),
      filesModified: z.array(z.string()).optional().describe("Files that were modified"),
      notes: z.string().optional().describe("Additional notes for the next agent"),
    },
    async ({ agentId, taskId, summary, decisions, remainingWork, filesModified, notes }) => {
      const handoff = await handoffStore.create(agentId, taskId, {
        summary,
        decisions: decisions ?? [],
        remainingWork: remainingWork ?? [],
        filesModified: filesModified ?? [],
        notes: notes ?? "",
      });
      // Release all locks held by this agent
      await releaseAllLocks(store, agentId);
      // Unassign task from agent
      await taskStore.update(taskId, { assignedAgentId: null });
      await agentStore.update(agentId, { activeTaskId: null });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, handoffId: handoff.id }) }] };
    }
  );

  // 9. agent_pickup
  server.tool(
    "agent_pickup",
    "Accept a handoff and get full context from the previous agent",
    {
      agentId: z.string().describe("Agent picking up the handoff"),
      handoffId: z.string().describe("Handoff ID to accept"),
    },
    async ({ agentId, handoffId }) => {
      const handoff = await handoffStore.get(handoffId);
      if (!handoff) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Handoff not found" }) }] };
      }
      if (handoff.status !== "pending") {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `Handoff already ${handoff.status}` }) }] };
      }
      await handoffStore.accept(handoffId, agentId);
      // Assign task to new agent
      await taskStore.update(handoff.taskId, { assignedAgentId: agentId });
      await agentStore.update(agentId, { activeTaskId: handoff.taskId });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, handoff: { id: handoff.id, taskId: handoff.taskId, context: handoff.context } }) }] };
    }
  );

  // 10. parallel_plan
  server.tool(
    "parallel_plan",
    "Analyze task dependency graph and suggest parallelizable task batches",
    {},
    async () => {
      const config = await store.getConfig();
      const tasks = await taskStore.list(config.activeProjectId ?? undefined);
      const todoTasks = tasks.filter((t) => t.status === "todo");

      // Build dependency graph
      const blocked = new Set<string>();
      for (const t of todoTasks) {
        for (const dep of t.blockedBy) {
          const depTask = tasks.find((x) => x.id === dep);
          if (depTask && depTask.status !== "done") {
            blocked.add(t.id);
          }
        }
      }

      // Group into batches: first batch = no unresolved deps, subsequent batches = freed after previous
      const batches: Array<{ batch: number; tasks: Array<{ id: string; title: string; priority: string }> }> = [];
      const completed = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
      const remaining = new Map(todoTasks.map((t) => [t.id, t]));
      let batchNum = 1;

      while (remaining.size > 0) {
        const ready: Array<{ id: string; title: string; priority: string }> = [];
        for (const [id, task] of remaining) {
          const unresolved = task.blockedBy.filter((dep) => !completed.has(dep));
          if (unresolved.length === 0) {
            ready.push({ id: task.id, title: task.title, priority: task.priority });
          }
        }
        if (ready.length === 0) {
          // Remaining tasks have circular or unresolvable deps
          const stuck = Array.from(remaining.values()).map((t) => ({ id: t.id, title: t.title, priority: t.priority }));
          batches.push({ batch: batchNum, tasks: stuck });
          break;
        }
        batches.push({ batch: batchNum, tasks: ready });
        for (const r of ready) {
          completed.add(r.id);
          remaining.delete(r.id);
        }
        batchNum++;
      }

      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: true,
          totalTasks: todoTasks.length,
          batches,
          maxParallelism: batches.length > 0 ? Math.max(...batches.map((b) => b.tasks.length)) : 0,
        }) }],
      };
    }
  );
}
