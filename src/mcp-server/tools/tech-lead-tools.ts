import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { TaskStore } from "../storage/task-store.js";
import { AgentStore } from "../storage/agent-store.js";
import { HandoffStore } from "../storage/handoff-store.js";
import { ReviewStore } from "../storage/review-store.js";
import { QAStore } from "../storage/qa-store.js";
import { DeployStore } from "../storage/deploy-store.js";
import { TeamStore } from "../storage/team-store.js";

export function registerTechLeadTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  agentStore: AgentStore,
  handoffStore: HandoffStore,
  reviewStore: ReviewStore,
  qaStore: QAStore,
  deployStore: DeployStore,
  teamStore: TeamStore
) {
  // 1. lead_distribute
  server.tool(
    "lead_distribute",
    "Analyze TODO tasks and distribute to agents by dependencies, complexity, and skills",
    {
      maxPerAgent: z.number().optional().describe("Max tasks per agent (default: 3)"),
    },
    async ({ maxPerAgent }) => {
      const config = await store.getConfig();
      const tasks = await taskStore.list(config.activeProjectId ?? undefined);
      const todoTasks = tasks.filter((t) => t.status === "todo" && !t.assignedAgentId && !t.assignedMemberId);
      const agents = await agentStore.listActive();
      const members = await teamStore.list();
      const max = maxPerAgent ?? 3;

      // Sort tasks by priority, then by number of blockers (fewer blockers first)
      const sortedTasks = [...todoTasks].sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (pDiff !== 0) return pDiff;
        return a.blockedBy.length - b.blockedBy.length;
      });

      // Filter to only ready tasks (no unresolved blockers)
      const readyTasks = sortedTasks.filter((t) =>
        t.blockedBy.every((dep) => {
          const depTask = tasks.find((x) => x.id === dep);
          return depTask && depTask.status === "done";
        })
      );

      const assignments: Array<{ taskId: string; taskTitle: string; assignedTo: string; assigneeType: "agent" | "member"; reason: string }> = [];

      // Distribute to agents/members
      const assignees = [
        ...agents.map((a) => ({ id: a.id, name: a.name, type: "agent" as const, currentTasks: tasks.filter((t) => t.assignedAgentId === a.id).length, skills: [] as string[] })),
        ...members.map((m) => ({ id: m.id, name: m.name, type: "member" as const, currentTasks: m.activeTaskIds.length, skills: m.skills })),
      ];

      for (const task of readyTasks) {
        // Find least-loaded assignee with matching skills
        const available = assignees
          .filter((a) => a.currentTasks < max)
          .sort((a, b) => a.currentTasks - b.currentTasks);

        if (available.length === 0) break;

        // Prefer assignees with matching skills
        const withSkills = available.filter((a) =>
          a.skills.length === 0 || task.tags.some((tag) => a.skills.includes(tag))
        );
        const assignee = withSkills[0] ?? available[0];

        if (assignee.type === "agent") {
          await taskStore.update(task.id, { assignedAgentId: assignee.id });
          await agentStore.update(assignee.id, { activeTaskId: task.id });
        } else {
          await taskStore.update(task.id, { assignedMemberId: assignee.id });
          await teamStore.assignTask(assignee.id, task.id);
        }

        assignee.currentTasks++;
        assignments.push({
          taskId: task.id,
          taskTitle: task.title,
          assignedTo: `${assignee.name} (${assignee.id})`,
          assigneeType: assignee.type,
          reason: `Least loaded (${assignee.currentTasks - 1} → ${assignee.currentTasks} tasks)`,
        });
      }

      return { content: [{ type: "text", text: JSON.stringify({
        ok: true,
        distributed: assignments.length,
        readyTasks: readyTasks.length,
        totalTodo: todoTasks.length,
        assignments,
      }) }] };
    }
  );

  // 2. lead_status
  server.tool(
    "lead_status",
    "Dashboard: all agents, tasks, pipeline progress",
    {},
    async () => {
      const config = await store.getConfig();
      const tasks = await taskStore.list(config.activeProjectId ?? undefined);
      const agents = await agentStore.list();
      const members = await teamStore.list();
      const reviews = await reviewStore.list();
      const qaResults = await qaStore.list();
      const deployments = await deployStore.list();

      const pipeline = {
        todo: tasks.filter((t) => t.status === "todo").length,
        doing: tasks.filter((t) => t.status === "doing").length,
        done: tasks.filter((t) => t.status === "done").length,
        inReview: tasks.filter((t) => t.reviewStatus === "in_review" || t.reviewStatus === "pending").length,
        qaRunning: tasks.filter((t) => t.qaStatus === "running").length,
        qaPassed: tasks.filter((t) => t.qaStatus === "passed").length,
        qaFailed: tasks.filter((t) => t.qaStatus === "failed").length,
      };

      const agentStatus = agents.map((a) => ({
        id: a.id, name: a.name, status: a.status,
        activeTask: a.activeTaskId,
        metrics: a.metrics,
      }));

      const memberStatus = members.map((m) => ({
        id: m.id, name: m.name, role: m.role,
        activeTasks: m.activeTaskIds.length,
        stats: m.stats,
      }));

      return { content: [{ type: "text", text: JSON.stringify({
        ok: true,
        pipeline,
        agents: agentStatus,
        team: memberStatus,
        recentReviews: reviews.slice(0, 5).map((r) => ({ id: r.id, taskId: r.taskId, verdict: r.verdict })),
        recentQA: qaResults.slice(0, 5).map((q) => ({ id: q.id, taskId: q.taskId, passed: q.testsPassed, failed: q.testsFailed })),
        recentDeploys: deployments.slice(0, 3).map((d) => ({ id: d.id, env: d.environment, status: d.status })),
      }) }] };
    }
  );

  // 3. lead_reassign
  server.tool(
    "lead_reassign",
    "Reassign a task to a different agent/member with handoff context",
    {
      taskId: z.string().describe("Task ID to reassign"),
      toAgentId: z.string().optional().describe("New agent ID"),
      toMemberId: z.string().optional().describe("New team member ID"),
      reason: z.string().describe("Reason for reassignment"),
    },
    async ({ taskId, toAgentId, toMemberId, reason }) => {
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      // Create handoff from old assignee
      const fromAgent = task.assignedAgentId ?? task.assignedMemberId ?? "unassigned";
      const handoff = await handoffStore.create(fromAgent, taskId, {
        summary: `Reassigned: ${reason}`,
        decisions: [],
        remainingWork: [],
        filesModified: task.files,
        notes: reason,
      });

      // Clear old assignment
      if (task.assignedAgentId) {
        await agentStore.update(task.assignedAgentId, { activeTaskId: null });
      }

      // Set new assignment
      if (toAgentId) {
        await taskStore.update(taskId, { assignedAgentId: toAgentId, assignedMemberId: null });
        await agentStore.update(toAgentId, { activeTaskId: taskId });
        await handoffStore.accept(handoff.id, toAgentId);
      } else if (toMemberId) {
        await taskStore.update(taskId, { assignedMemberId: toMemberId, assignedAgentId: null });
        await teamStore.assignTask(toMemberId, taskId);
        await handoffStore.accept(handoff.id, toMemberId);
      }

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, taskId, handoffId: handoff.id, reassignedTo: toAgentId ?? toMemberId, reason }) }] };
    }
  );

  // 4. lead_pipeline
  server.tool(
    "lead_pipeline",
    "View and manage the full pipeline: coding → review → QA → deploy",
    {
      taskId: z.string().optional().describe("View pipeline for a specific task"),
    },
    async ({ taskId }) => {
      if (taskId) {
        const task = await taskStore.get(taskId);
        if (!task) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
        }
        const reviews = await reviewStore.findByTask(taskId);
        const qas = await qaStore.findByTask(taskId);
        const deployment = task.deploymentId ? await deployStore.get(task.deploymentId) : null;

        return { content: [{ type: "text", text: JSON.stringify({
          ok: true,
          taskId,
          title: task.title,
          stages: {
            coding: { status: task.status, assignee: task.assignedAgentId ?? task.assignedMemberId },
            review: { status: task.reviewStatus ?? "not_started", reviews: reviews.length, latestVerdict: reviews[0]?.verdict },
            qa: { status: task.qaStatus ?? "not_started", runs: qas.length, latestPassed: qas[0]?.testsPassed, latestFailed: qas[0]?.testsFailed },
            deploy: { status: deployment?.status ?? "not_started", environment: deployment?.environment },
          },
        }) }] };
      }

      // Full pipeline overview
      const config = await store.getConfig();
      const tasks = await taskStore.list(config.activeProjectId ?? undefined);
      const activeTasks = tasks.filter((t) => t.status !== "done" || t.qaStatus || t.reviewStatus || t.deploymentId);

      const pipelineView = activeTasks.slice(0, 20).map((t) => ({
        id: t.id,
        title: t.title.slice(0, 40),
        coding: t.status,
        review: t.reviewStatus ?? "-",
        qa: t.qaStatus ?? "-",
        deployed: t.deploymentId ? "yes" : "-",
      }));

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, pipeline: pipelineView }) }] };
    }
  );
}
