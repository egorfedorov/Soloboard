import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { TaskStore } from "../storage/task-store.js";
import { DeployStore } from "../storage/deploy-store.js";
import { ApprovalStore } from "../storage/approval-store.js";
import { ReviewStore } from "../storage/review-store.js";
import { QAStore } from "../storage/qa-store.js";
import { DeployEnvironment } from "../models/deployment.js";
import { execSync } from "node:child_process";

export function registerDevopsTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  deployStore: DeployStore,
  approvalStore: ApprovalStore,
  reviewStore: ReviewStore,
  qaStore: QAStore,
  projectRoot: string
) {
  // 1. deploy_check
  server.tool(
    "deploy_check",
    "Readiness check: all tasks done, reviewed, QA passed",
    {
      taskIds: z.array(z.string()).optional().describe("Task IDs to check (default: all 'done' tasks)"),
      environment: z.enum(["staging", "production", "preview"]).optional().describe("Target environment"),
    },
    async ({ taskIds, environment }) => {
      const config = await store.getConfig();
      const allTasks = await taskStore.list(config.activeProjectId ?? undefined);
      const tasks = taskIds
        ? allTasks.filter((t) => taskIds.includes(t.id))
        : allTasks.filter((t) => t.status === "done");

      const checks: Array<{ check: string; passed: boolean; details: string }> = [];

      // Check: all tasks done
      const notDone = tasks.filter((t) => t.status !== "done");
      checks.push({
        check: "all_tasks_done",
        passed: notDone.length === 0,
        details: notDone.length > 0 ? `${notDone.length} tasks not done: ${notDone.map((t) => t.id).join(", ")}` : "All tasks completed",
      });

      // Check: code reviewed
      const unreviewedTasks = tasks.filter((t) => t.reviewStatus !== "approved");
      checks.push({
        check: "code_reviewed",
        passed: unreviewedTasks.length === 0,
        details: unreviewedTasks.length > 0 ? `${unreviewedTasks.length} tasks not reviewed` : "All reviewed",
      });

      // Check: QA passed
      const failedQA = tasks.filter((t) => t.qaStatus === "failed");
      checks.push({
        check: "qa_passed",
        passed: failedQA.length === 0,
        details: failedQA.length > 0 ? `${failedQA.length} tasks with failed QA` : "All QA passed",
      });

      // Check: no blockers
      const blocked = tasks.filter((t) => t.blockedBy.length > 0 && t.blockedBy.some((b) => allTasks.find((x) => x.id === b && x.status !== "done")));
      checks.push({
        check: "no_blockers",
        passed: blocked.length === 0,
        details: blocked.length > 0 ? `${blocked.length} tasks still have unresolved blockers` : "No blockers",
      });

      const allPassed = checks.every((c) => c.passed);
      const env = environment ?? "staging";

      return { content: [{ type: "text", text: JSON.stringify({
        ok: true,
        ready: allPassed,
        environment: env,
        checks,
        recommendation: allPassed ? `Ready to deploy to ${env}` : "Fix issues before deploying",
      }) }] };
    }
  );

  // 2. deploy_run
  server.tool(
    "deploy_run",
    "Execute deployment command (approval required for production)",
    {
      environment: z.enum(["staging", "production", "preview"]).describe("Target environment"),
      command: z.string().optional().describe("Deploy command (default: from config)"),
      taskId: z.string().optional().describe("Related task ID"),
      approvalId: z.string().optional().describe("Approval ID (required for production)"),
    },
    async ({ environment, command, taskId, approvalId }) => {
      const config = await store.getConfig();

      // Production requires approval
      if (environment === "production") {
        if (!approvalId) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Production deployment requires approval. Use approval_request first." }) }] };
        }
        const approval = await approvalStore.get(approvalId);
        if (!approval || approval.status !== "approved") {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Approval not found or not approved" }) }] };
        }
      }

      const deployCmd = command ?? config.deployCommand;
      if (!deployCmd) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No deploy command configured. Set deployCommand in config or pass command." }) }] };
      }

      const deployment = await deployStore.create(environment as DeployEnvironment, deployCmd, taskId ?? null, approvalId ?? null);
      await deployStore.update(deployment.id, { status: "running" });

      try {
        const output = execSync(deployCmd, { cwd: projectRoot, encoding: "utf-8", timeout: 300000 });
        await deployStore.update(deployment.id, { status: "success", output: output.slice(0, 5000), completedAt: new Date().toISOString() });

        if (taskId) {
          await taskStore.update(taskId, { deploymentId: deployment.id });
        }

        return { content: [{ type: "text", text: JSON.stringify({ ok: true, deploymentId: deployment.id, status: "success", environment }) }] };
      } catch (err) {
        const output = err instanceof Error ? err.message : String(err);
        await deployStore.update(deployment.id, { status: "failed", output: output.slice(0, 5000), completedAt: new Date().toISOString() });
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, deploymentId: deployment.id, status: "failed", error: output.slice(0, 500) }) }] };
      }
    }
  );

  // 3. deploy_status
  server.tool(
    "deploy_status",
    "View deployment history and status",
    {
      deploymentId: z.string().optional().describe("Specific deployment ID"),
      environment: z.enum(["staging", "production", "preview"]).optional().describe("Filter by environment"),
      limit: z.number().optional().describe("Max results (default: 10)"),
    },
    async ({ deploymentId, environment, limit }) => {
      if (deploymentId) {
        const d = await deployStore.get(deploymentId);
        if (!d) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Deployment not found" }) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, deployment: d }) }] };
      }

      let deployments = await deployStore.list();
      if (environment) {
        deployments = deployments.filter((d) => d.environment === environment);
      }
      deployments = deployments.slice(0, limit ?? 10);

      const summary = deployments.map((d) => ({
        id: d.id,
        environment: d.environment,
        status: d.status,
        taskId: d.taskId,
        startedAt: d.startedAt,
        completedAt: d.completedAt,
      }));

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, count: summary.length, deployments: summary }) }] };
    }
  );
}
