import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { TaskStore } from "../storage/task-store.js";
import { ghCreateBranch, ghPushBranch, ghCreatePR, ghPRStatus } from "../utils/external-sync.js";
import { execSync } from "node:child_process";

export function registerPRTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  projectRoot: string
) {
  // 1. pr_create
  server.tool(
    "pr_create",
    "Create a branch, push, and open a PR linked to a task",
    {
      taskId: z.string().describe("Task ID to link PR to"),
      branchName: z.string().optional().describe("Branch name (auto-generated from task title if omitted)"),
      title: z.string().optional().describe("PR title (defaults to task title)"),
      body: z.string().optional().describe("PR body/description"),
    },
    async ({ taskId, branchName, title, body }) => {
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      const branch = branchName ?? task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
      const prTitle = title ?? task.title;
      const prBody = body ?? `Task: ${task.id}\n\n${task.description}`;

      // Create branch
      const branchOk = ghCreateBranch(branch, projectRoot);
      if (!branchOk) {
        // Branch might already exist, try to checkout
        try {
          execSync(`git checkout "${branch}"`, { cwd: projectRoot, encoding: "utf-8" });
        } catch {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Failed to create or switch to branch" }) }] };
        }
      }

      // Push branch
      const pushOk = ghPushBranch(branch, projectRoot);
      if (!pushOk) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Failed to push branch" }) }] };
      }

      // Create PR
      const prUrl = ghCreatePR(prTitle, prBody, projectRoot);
      if (!prUrl) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Failed to create PR. Is `gh` CLI installed?" }) }] };
      }

      // Link to task
      await taskStore.update(taskId, { branch, pr: prUrl });

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, branch, prUrl, taskId }) }] };
    }
  );

  // 2. pr_status
  server.tool(
    "pr_status",
    "Check PR review, CI, and merge status",
    {
      taskId: z.string().optional().describe("Task ID (uses linked PR)"),
      prNumber: z.string().optional().describe("PR number (if not using task)"),
    },
    async ({ taskId, prNumber }) => {
      let pr = prNumber;
      if (taskId && !pr) {
        const task = await taskStore.get(taskId);
        if (!task?.pr) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No PR linked to task" }) }] };
        }
        const match = task.pr.match(/\/(\d+)$/);
        pr = match ? match[1] : task.pr;
      }

      if (!pr) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Provide taskId or prNumber" }) }] };
      }

      const status = ghPRStatus(pr);
      if (!status) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Failed to get PR status" }) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, pr: status }) }] };
    }
  );

  // 3. pr_auto_flow
  server.tool(
    "pr_auto_flow",
    "Full flow: stage changes → commit → branch → push → PR → link to task",
    {
      taskId: z.string().describe("Task ID"),
      commitMessage: z.string().describe("Commit message"),
      branchName: z.string().optional().describe("Branch name (auto-generated if omitted)"),
    },
    async ({ taskId, commitMessage, branchName }) => {
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      const branch = branchName ?? task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

      try {
        // Create branch (or switch)
        try {
          execSync(`git checkout -b "${branch}"`, { cwd: projectRoot, encoding: "utf-8" });
        } catch {
          execSync(`git checkout "${branch}"`, { cwd: projectRoot, encoding: "utf-8" });
        }

        // Stage all changes
        execSync("git add -A", { cwd: projectRoot, encoding: "utf-8" });

        // Commit
        execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd: projectRoot, encoding: "utf-8" });

        // Get commit SHA
        const sha = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf-8" }).trim();

        // Push
        execSync(`git push -u origin "${branch}"`, { cwd: projectRoot, encoding: "utf-8", timeout: 30000 });

        // Create PR
        const prUrl = ghCreatePR(task.title, `Task: ${task.id}\n\n${task.description}`, projectRoot);

        // Link everything to task
        await taskStore.update(taskId, { branch, pr: prUrl });
        await taskStore.addCommit(taskId, sha);

        return { content: [{ type: "text", text: JSON.stringify({ ok: true, branch, commitSha: sha, prUrl, taskId }) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: msg }) }] };
      }
    }
  );
}
