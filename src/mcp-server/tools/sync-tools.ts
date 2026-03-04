import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { TaskStore } from "../storage/task-store.js";
import { ExternalLink } from "../models/task.js";
import {
  ghCreateIssue, ghGetIssue, ghListIssues, ghUpdateIssueState,
} from "../utils/external-sync.js";

export function registerSyncTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore
) {
  // 1. sync_setup
  server.tool(
    "sync_setup",
    "Configure GitHub/Linear/Jira sync credentials",
    {
      provider: z.enum(["github", "linear", "jira"]).describe("External provider"),
      enabled: z.boolean().describe("Enable or disable sync"),
      token: z.string().optional().describe("API token (for Linear/Jira)"),
      project: z.string().optional().describe("Project key/repo (e.g., 'owner/repo')"),
    },
    async ({ provider, enabled, token, project }) => {
      const config = await store.getConfig();
      const syncKey = `${provider}Sync` as "githubSync" | "linearSync" | "jiraSync";
      config[syncKey] = {
        enabled,
        token: token ?? config[syncKey].token,
        project: project ?? config[syncKey].project,
      };
      await store.saveConfig(config);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, provider, enabled, project: config[syncKey].project }) }] };
    }
  );

  // 2. sync_push
  server.tool(
    "sync_push",
    "Push a task to an external tool (GitHub issue, Linear, Jira)",
    {
      taskId: z.string().describe("Task ID to push"),
      provider: z.enum(["github", "linear", "jira"]).describe("Target provider"),
    },
    async ({ taskId, provider }) => {
      const config = await store.getConfig();
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      const syncConfig = config[`${provider}Sync` as "githubSync" | "linearSync" | "jiraSync"];
      if (!syncConfig.enabled) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `${provider} sync not enabled. Use sync_setup first.` }) }] };
      }

      let externalId = "";
      let url = "";

      if (provider === "github") {
        const result = ghCreateIssue(task.title, task.description, task.tags, syncConfig.project ?? undefined);
        if (!result) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Failed to create GitHub issue. Is `gh` CLI installed and authenticated?" }) }] };
        }
        url = result;
        const match = result.match(/\/(\d+)$/);
        externalId = match ? match[1] : result;
      } else {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `${provider} push requires API token. Configure with sync_setup.` }) }] };
      }

      const link: ExternalLink = {
        provider,
        externalId,
        url,
        syncDirection: "push",
        lastSyncedAt: new Date().toISOString(),
      };

      const existingLinks = task.externalLinks ?? [];
      existingLinks.push(link);
      await taskStore.update(taskId, { externalLinks: existingLinks });

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, provider, externalId, url }) }] };
    }
  );

  // 3. sync_pull
  server.tool(
    "sync_pull",
    "Import issues from an external tool into tasks",
    {
      provider: z.enum(["github", "linear", "jira"]).describe("Source provider"),
      limit: z.number().optional().describe("Max issues to import (default: 10)"),
      state: z.string().optional().describe("Filter by state (e.g., 'open')"),
    },
    async ({ provider, limit, state }) => {
      const config = await store.getConfig();
      if (!config.activeProjectId) {
        return { content: [{ type: "text", text: "No active project" }] };
      }

      const syncConfig = config[`${provider}Sync` as "githubSync" | "linearSync" | "jiraSync"];
      if (!syncConfig.enabled) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `${provider} sync not enabled` }) }] };
      }

      if (provider === "github") {
        const issues = ghListIssues(syncConfig.project ?? undefined, state ?? "open", limit ?? 10);
        const imported: string[] = [];
        for (const issue of issues) {
          // Check if already imported
          const existing = await taskStore.list(config.activeProjectId);
          const alreadyLinked = existing.some((t) =>
            (t.externalLinks ?? []).some((l) => l.provider === "github" && l.externalId === issue.externalId)
          );
          if (alreadyLinked) continue;

          const task = await taskStore.create(issue.title, config.activeProjectId, {
            description: issue.description,
            tags: issue.labels,
          });
          const link: ExternalLink = {
            provider: "github",
            externalId: issue.externalId,
            url: issue.url,
            syncDirection: "pull",
            lastSyncedAt: new Date().toISOString(),
          };
          await taskStore.update(task.id, { externalLinks: [link] });
          imported.push(task.id);
        }
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, imported: imported.length, taskIds: imported }) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `${provider} pull not yet implemented` }) }] };
    }
  );

  // 4. sync_update
  server.tool(
    "sync_update",
    "Sync status changes bidirectionally for a task",
    {
      taskId: z.string().describe("Task ID to sync"),
    },
    async ({ taskId }) => {
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      const links = task.externalLinks ?? [];
      if (links.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No external links" }) }] };
      }

      const results: Array<{ provider: string; synced: boolean }> = [];
      for (const link of links) {
        if (link.provider === "github") {
          if (task.status === "done") {
            const synced = ghUpdateIssueState(link.externalId, "closed");
            results.push({ provider: "github", synced });
          } else {
            const issue = ghGetIssue(link.externalId);
            if (issue && issue.status === "CLOSED") {
              // External was closed, update local
              await taskStore.update(taskId, { status: "done" });
            }
            results.push({ provider: "github", synced: true });
          }
          link.lastSyncedAt = new Date().toISOString();
        } else {
          results.push({ provider: link.provider, synced: false });
        }
      }

      await taskStore.update(taskId, { externalLinks: links });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, results }) }] };
    }
  );

  // 5. sync_status
  server.tool(
    "sync_status",
    "Show sync state for all linked tasks",
    {},
    async () => {
      const config = await store.getConfig();
      const tasks = await taskStore.list(config.activeProjectId ?? undefined);
      const linked = tasks.filter((t) => (t.externalLinks ?? []).length > 0);

      const summary = linked.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        links: (t.externalLinks ?? []).map((l) => ({
          provider: l.provider,
          externalId: l.externalId,
          url: l.url,
          syncDirection: l.syncDirection,
          lastSyncedAt: l.lastSyncedAt,
        })),
      }));

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, linkedTasks: summary.length, tasks: summary }) }] };
    }
  );
}
