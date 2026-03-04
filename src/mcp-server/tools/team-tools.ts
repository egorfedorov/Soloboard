import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { TaskStore } from "../storage/task-store.js";
import { TeamStore } from "../storage/team-store.js";
import { RoleName } from "../models/agent-role.js";

export function registerTeamTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  teamStore: TeamStore
) {
  // 1. team_add
  server.tool(
    "team_add",
    "Add a team member with role and skills",
    {
      name: z.string().describe("Team member name"),
      role: z.enum(["tech_lead", "code_reviewer", "qa_agent", "devops_agent", "developer"]).describe("Role"),
      skills: z.array(z.string()).optional().describe("Skills (e.g., ['typescript', 'react', 'database'])"),
    },
    async ({ name, role, skills }) => {
      const member = await teamStore.add(name, role as RoleName, skills ?? []);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, member: { id: member.id, name: member.name, role: member.role, skills: member.skills } }) }] };
    }
  );

  // 2. team_list
  server.tool(
    "team_list",
    "List team members with stats and current assignments",
    {
      role: z.enum(["tech_lead", "code_reviewer", "qa_agent", "devops_agent", "developer"]).optional().describe("Filter by role"),
    },
    async ({ role }) => {
      let members = await teamStore.list();
      if (role) {
        members = members.filter((m) => m.role === role);
      }

      const summary = members.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        skills: m.skills,
        activeTasks: m.activeTaskIds.length,
        stats: m.stats,
      }));

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, count: summary.length, members: summary }) }] };
    }
  );

  // 3. team_assign
  server.tool(
    "team_assign",
    "Assign a task to a team member",
    {
      memberId: z.string().describe("Team member ID"),
      taskId: z.string().describe("Task ID to assign"),
    },
    async ({ memberId, taskId }) => {
      const member = await teamStore.get(memberId);
      if (!member) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Member not found" }) }] };
      }
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      await teamStore.assignTask(memberId, taskId);
      await taskStore.update(taskId, { assignedMemberId: memberId });

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, taskId, memberId, memberName: member.name }) }] };
    }
  );

  // 4. team_workload
  server.tool(
    "team_workload",
    "View workload distribution across team members",
    {},
    async () => {
      const config = await store.getConfig();
      const members = await teamStore.list();
      const tasks = await taskStore.list(config.activeProjectId ?? undefined);

      const workload = members.map((m) => {
        const assignedTasks = tasks.filter((t) => t.assignedMemberId === m.id);
        const doingCount = assignedTasks.filter((t) => t.status === "doing").length;
        const todoCount = assignedTasks.filter((t) => t.status === "todo").length;
        const doneCount = assignedTasks.filter((t) => t.status === "done").length;

        return {
          id: m.id,
          name: m.name,
          role: m.role,
          doing: doingCount,
          todo: todoCount,
          done: doneCount,
          total: assignedTasks.length,
          load: doingCount + todoCount,
        };
      });

      workload.sort((a, b) => b.load - a.load);

      const maxLoad = Math.max(...workload.map((w) => w.load), 1);
      const chart = workload.map((w) => {
        const bar = "█".repeat(Math.round((w.load / maxLoad) * 20));
        return `${w.name.padEnd(15)} ${bar} (${w.doing} doing, ${w.todo} todo, ${w.done} done)`;
      });

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, workload, chart: chart.join("\n") }) }] };
    }
  );

  // 5. team_suggest_assignment
  server.tool(
    "team_suggest_assignment",
    "Auto-suggest the best team member for a task based on skills and availability",
    {
      taskId: z.string().describe("Task ID to find best assignee for"),
    },
    async ({ taskId }) => {
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      const config = await store.getConfig();
      const members = await teamStore.list();
      const allTasks = await taskStore.list(config.activeProjectId ?? undefined);

      if (members.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, suggestion: null, message: "No team members. Use team_add first." }) }] };
      }

      // Score each member
      const scored = members.map((m) => {
        let score = 0;
        const reasons: string[] = [];

        // Skill match
        const matchedSkills = task.tags.filter((tag) => m.skills.some((s) => s.toLowerCase() === tag.toLowerCase()));
        score += matchedSkills.length * 20;
        if (matchedSkills.length > 0) reasons.push(`Skills: ${matchedSkills.join(", ")}`);

        // Current workload (fewer is better)
        const currentLoad = allTasks.filter((t) => t.assignedMemberId === m.id && t.status !== "done").length;
        score -= currentLoad * 10;
        reasons.push(`Current load: ${currentLoad}`);

        // Past performance (faster is better)
        if (m.stats.tasksCompleted > 0) {
          score += Math.min(20, Math.round(100 / m.stats.averageCompletionMinutes));
          reasons.push(`Avg completion: ${m.stats.averageCompletionMinutes}m`);
        }

        // Role compatibility
        if (task.tags.includes("bug") && m.role === "qa_agent") { score += 10; reasons.push("QA for bug"); }
        if (task.tags.includes("devops") && m.role === "devops_agent") { score += 10; reasons.push("DevOps match"); }
        if (task.tags.includes("review") && m.role === "code_reviewer") { score += 10; reasons.push("Reviewer match"); }

        return { member: { id: m.id, name: m.name, role: m.role }, score, reasons };
      });

      scored.sort((a, b) => b.score - a.score);

      return { content: [{ type: "text", text: JSON.stringify({
        ok: true,
        taskId,
        taskTitle: task.title,
        suggestions: scored.slice(0, 3).map((s, i) => ({
          rank: i + 1,
          ...s.member,
          score: s.score,
          reasons: s.reasons,
        })),
        recommended: scored[0].member,
      }) }] };
    }
  );
}
