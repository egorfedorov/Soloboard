import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { TaskStore } from "../storage/task-store.js";
import { RiskAssessment, RiskFactor } from "../models/risk.js";
import { RiskLevel, TaskComplexity } from "../models/task.js";
import { execSync } from "node:child_process";

function getGitHotspots(projectRoot: string, limit: number): string[] {
  try {
    const result = execSync(
      `git log --all --format=format: --name-only --since="30 days ago" | sort | uniq -c | sort -rn | head -${limit}`,
      { cwd: projectRoot, encoding: "utf-8", timeout: 10000 }
    );
    return result.split("\n").map((l) => l.trim().replace(/^\d+\s+/, "")).filter(Boolean);
  } catch {
    return [];
  }
}

function assessTaskRisk(
  task: { files: string[]; blockedBy: string[]; blocks: string[]; tags: string[]; estimatedMinutes: number | null },
  hotspots: string[],
  allTaskCount: number
): RiskAssessment {
  const factors: RiskFactor[] = [];
  let score = 0;

  // File hotspots
  const hotFiles = task.files.filter((f) => hotspots.includes(f));
  if (hotFiles.length > 0) {
    score += hotFiles.length * 15;
    factors.push({ name: "hotspot_files", description: `${hotFiles.length} files are git hotspots (frequently changed)`, severity: "medium" });
  }

  // Dependency chain depth
  if (task.blockedBy.length > 2) {
    score += task.blockedBy.length * 10;
    factors.push({ name: "deep_dependencies", description: `Blocked by ${task.blockedBy.length} tasks`, severity: "high" });
  } else if (task.blockedBy.length > 0) {
    score += task.blockedBy.length * 5;
    factors.push({ name: "has_dependencies", description: `Blocked by ${task.blockedBy.length} task(s)`, severity: "low" });
  }

  // Blocking others
  if (task.blocks.length > 2) {
    score += task.blocks.length * 10;
    factors.push({ name: "critical_path", description: `Blocks ${task.blocks.length} other tasks`, severity: "high" });
  }

  // Complexity/size
  if (task.estimatedMinutes && task.estimatedMinutes > 240) {
    score += 20;
    factors.push({ name: "large_task", description: `Estimated ${task.estimatedMinutes} minutes`, severity: "medium" });
  }

  // Security tags
  if (task.tags.some((t) => ["security", "auth", "payment", "billing"].includes(t))) {
    score += 15;
    factors.push({ name: "sensitive_area", description: "Task touches security-sensitive area", severity: "high" });
  }

  const mitigations: string[] = [];
  if (hotFiles.length > 0) mitigations.push("Add extra test coverage for hotspot files");
  if (task.blockedBy.length > 2) mitigations.push("Consider breaking dependency chain");
  if (task.blocks.length > 2) mitigations.push("Prioritize this task to unblock others");
  if (score > 50) mitigations.push("Consider breaking into smaller tasks");
  if (factors.some((f) => f.name === "sensitive_area")) mitigations.push("Require code review before merge");

  const level: RiskLevel = score >= 60 ? "critical" : score >= 40 ? "high" : score >= 20 ? "medium" : "low";

  return {
    taskId: "",
    level,
    score,
    factors,
    mitigations,
    assessedAt: new Date().toISOString(),
  };
}

export function registerRiskTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  projectRoot: string
) {
  // 1. risk_assess
  server.tool(
    "risk_assess",
    "Assess risk for a task based on git hotspots, dependency depth, and complexity",
    {
      taskId: z.string().describe("Task ID to assess"),
    },
    async ({ taskId }) => {
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      const config = await store.getConfig();
      const allTasks = await taskStore.list(config.activeProjectId ?? undefined);
      const hotspots = getGitHotspots(projectRoot, 20);
      const assessment = assessTaskRisk(task, hotspots, allTasks.length);
      assessment.taskId = taskId;

      // Update task with risk level
      await taskStore.update(taskId, { riskLevel: assessment.level });

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, assessment }) }] };
    }
  );

  // 2. risk_report
  server.tool(
    "risk_report",
    "Show all tasks ranked by risk with mitigations",
    {},
    async () => {
      const config = await store.getConfig();
      const tasks = await taskStore.list(config.activeProjectId ?? undefined);
      const activeTasks = tasks.filter((t) => t.status !== "done");
      const hotspots = getGitHotspots(projectRoot, 20);

      const assessments = activeTasks.map((t) => {
        const a = assessTaskRisk(t, hotspots, tasks.length);
        a.taskId = t.id;
        return { id: t.id, title: t.title, status: t.status, ...a };
      });

      assessments.sort((a, b) => b.score - a.score);

      const summary = {
        critical: assessments.filter((a) => a.level === "critical").length,
        high: assessments.filter((a) => a.level === "high").length,
        medium: assessments.filter((a) => a.level === "medium").length,
        low: assessments.filter((a) => a.level === "low").length,
      };

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, summary, assessments }) }] };
    }
  );

  // 3. complexity_classify
  server.tool(
    "complexity_classify",
    "Auto-classify task complexity as trivial/small/medium/large/epic",
    {
      taskId: z.string().describe("Task ID to classify"),
    },
    async ({ taskId }) => {
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      let complexity: TaskComplexity = "medium";
      const factors: string[] = [];

      // Heuristics
      const descLength = task.description.length;
      const fileCount = task.files.length;
      const depCount = task.blockedBy.length + task.blocks.length;
      const subtaskCount = task.subtaskIds.length;
      const est = task.estimatedMinutes ?? 0;

      if (subtaskCount > 5 || est > 480 || depCount > 5) {
        complexity = "epic";
        factors.push(subtaskCount > 5 ? `${subtaskCount} subtasks` : "", est > 480 ? `${est}min estimate` : "", depCount > 5 ? `${depCount} dependencies` : "");
      } else if (subtaskCount > 2 || est > 240 || depCount > 3 || fileCount > 10) {
        complexity = "large";
        factors.push("Multiple subtasks or high file/dep count");
      } else if (est > 60 || fileCount > 3 || depCount > 1 || descLength > 200) {
        complexity = "medium";
        factors.push("Moderate scope");
      } else if (est > 15 || fileCount > 0 || descLength > 50) {
        complexity = "small";
        factors.push("Limited scope");
      } else {
        complexity = "trivial";
        factors.push("Very simple change");
      }

      await taskStore.update(taskId, { complexity });

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, taskId, complexity, factors: factors.filter(Boolean) }) }] };
    }
  );
}
