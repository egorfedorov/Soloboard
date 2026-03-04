import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStore } from "../storage/task-store.js";
import { BoardStore } from "../storage/board-store.js";
import { Store } from "../storage/store.js";
import * as git from "../utils/git.js";

export function registerGitTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  boardStore: BoardStore,
  projectRoot: string
) {
  // 1. git_link
  server.tool(
    "git_link",
    "Link a git commit or branch to a task",
    {
      taskId: z.string().describe("Task ID or title fragment"),
      commit: z.string().optional().describe("Commit SHA to link"),
      branch: z.string().optional().describe("Branch name to link"),
      pr: z.string().optional().describe("PR URL to link"),
    },
    async ({ taskId, commit, branch, pr }) => {
      const config = await store.getConfig();
      const task = await taskStore.resolve(taskId, config.activeProjectId ?? undefined);
      if (!task) {
        return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };
      }

      const updates: Record<string, unknown> = {};
      if (commit) {
        await taskStore.addCommit(task.id, commit);
      }
      if (branch) {
        updates.branch = branch;
      }
      if (pr) {
        updates.pr = pr;
      }

      if (Object.keys(updates).length > 0) {
        await taskStore.update(task.id, updates);
      }

      const updated = await taskStore.get(task.id);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, task: updated }) }] };
    }
  );

  // 2. git_status
  server.tool(
    "git_status",
    "Get git status and recent commits for context",
    {},
    async () => {
      const isRepo = git.isGitRepo(projectRoot);
      if (!isRepo) {
        return { content: [{ type: "text", text: "Not a git repository." }] };
      }

      const branch = git.getCurrentBranch(projectRoot);
      const status = git.getGitStatus(projectRoot);
      const commits = git.getRecentCommits(projectRoot, 5);

      const lines: string[] = [
        `Branch: ${branch ?? "unknown"}`,
        "",
        "## Status",
        status || "(clean)",
        "",
        "## Recent Commits",
      ];

      for (const c of commits) {
        lines.push(`  ${c.sha} ${c.message}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
