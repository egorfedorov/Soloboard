import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStore } from "../storage/task-store.js";
import { Store } from "../storage/store.js";
import { TaskContext } from "../models/task.js";

export function registerContextTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore
) {
  // task_context_save — save context snapshot for a task
  server.tool(
    "task_context_save",
    "Save a context snapshot for a task: what you looked at, decisions made, what's left to do. Called automatically when switching tasks or ending a session.",
    {
      taskId: z.string().describe("Task ID or title fragment"),
      filesViewed: z.array(z.string()).optional().describe("Files the agent examined"),
      decisions: z.array(z.string()).optional().describe("Key decisions made during this work session"),
      remainingWork: z.array(z.string()).optional().describe("What still needs to be done"),
      lastAction: z.string().optional().describe("The last thing you did on this task"),
    },
    async ({ taskId, filesViewed, decisions, remainingWork, lastAction }) => {
      const config = await store.getConfig();
      const task = await taskStore.resolve(taskId, config.activeProjectId ?? undefined);
      if (!task) {
        return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };
      }

      const existing = task.context;
      const context: TaskContext = {
        filesViewed: mergeDedupe(existing?.filesViewed ?? [], filesViewed ?? []),
        decisions: mergeDedupe(existing?.decisions ?? [], decisions ?? []),
        remainingWork: remainingWork ?? existing?.remainingWork ?? [],
        lastAction: lastAction ?? existing?.lastAction ?? "",
        suggestedApproach: existing?.suggestedApproach ?? [],
        relatedFiles: existing?.relatedFiles ?? [],
        savedAt: new Date().toISOString(),
      };

      await taskStore.update(task.id, { context } as any);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, taskId: task.id, contextSaved: true }),
          },
        ],
      };
    }
  );

  // task_context_load — load context for resuming a task
  server.tool(
    "task_context_load",
    "Load the saved context for a task. Use this when resuming work on a task to get full context: files, decisions, remaining work, and suggested approach.",
    {
      taskId: z.string().describe("Task ID or title fragment"),
    },
    async ({ taskId }) => {
      const config = await store.getConfig();
      const task = await taskStore.resolve(taskId, config.activeProjectId ?? undefined);
      if (!task) {
        return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };
      }

      if (!task.context) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                taskId: task.id,
                title: task.title,
                hasContext: false,
                files: task.files,
                commits: task.commits,
                description: task.description,
              }),
            },
          ],
        };
      }

      const ctx = task.context;
      const lines: string[] = [
        `# Resuming: ${task.title}`,
        "",
      ];

      if (ctx.lastAction) {
        lines.push(`**Last action:** ${ctx.lastAction}`, "");
      }

      if (ctx.remainingWork.length > 0) {
        lines.push("**Remaining work:**");
        ctx.remainingWork.forEach((w) => lines.push(`- ${w}`));
        lines.push("");
      }

      if (ctx.decisions.length > 0) {
        lines.push("**Decisions made:**");
        ctx.decisions.forEach((d) => lines.push(`- ${d}`));
        lines.push("");
      }

      if (ctx.filesViewed.length > 0) {
        lines.push("**Files examined:**");
        ctx.filesViewed.slice(0, 10).forEach((f) => lines.push(`- ${f}`));
        lines.push("");
      }

      if (task.files.length > 0) {
        lines.push("**Files changed:**");
        task.files.forEach((f) => lines.push(`- ${f}`));
        lines.push("");
      }

      if (ctx.suggestedApproach.length > 0) {
        lines.push("**Suggested approach:**");
        ctx.suggestedApproach.forEach((s) => lines.push(`- ${s}`));
        lines.push("");
      }

      if (task.commits.length > 0) {
        lines.push(`**Commits:** ${task.commits.join(", ")}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}

function mergeDedupe(existing: string[], incoming: string[]): string[] {
  const set = new Set([...existing, ...incoming]);
  return [...set];
}
