import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStore } from "../storage/task-store.js";
import { BoardStore } from "../storage/board-store.js";
import { SessionStore } from "../storage/session-store.js";
import { Store } from "../storage/store.js";
import { TaskStatus } from "../models/task.js";
import { analyzeForTask, extractKeywords, findRelatedFiles } from "../utils/project-analyzer.js";

export function registerSmartTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  boardStore: BoardStore,
  sessionStore: SessionStore,
  projectRoot: string
) {
  // task_smart_create — creates a task with auto-analysis
  server.tool(
    "task_smart_create",
    "Smart task creation: analyzes the project to find related files, suggest approach, auto-tag, and set priority. Use this instead of task_create for better tracking.",
    {
      prompt: z.string().describe("The user's original prompt or task description"),
      status: z.enum(["todo", "doing", "done"]).optional().describe("Initial status (default: doing)"),
    },
    async ({ prompt, status }) => {
      const config = await store.getConfig();
      if (!config.activeProjectId) {
        return { content: [{ type: "text", text: "No active project. Use auto_init first." }] };
      }

      // Analyze the project for this prompt
      const analysis = analyzeForTask(projectRoot, prompt);

      // Create task with smart data
      const targetStatus: TaskStatus = status ?? "doing";
      const task = await taskStore.create(analysis.smartTitle, config.activeProjectId, {
        description: prompt !== analysis.smartTitle ? prompt : undefined,
        priority: analysis.suggestedPriority,
        tags: analysis.autoTags,
        status: targetStatus,
      });

      // Save initial context from analysis
      await taskStore.update(task.id, {
        context: {
          filesViewed: [],
          decisions: [],
          remainingWork: [],
          lastAction: "",
          suggestedApproach: analysis.suggestedApproach,
          relatedFiles: analysis.relatedFiles.map((f) => f.file),
          savedAt: new Date().toISOString(),
        },
      } as any);

      // Add to board
      await boardStore.addTask(config.activeProjectId, task.id, targetStatus);

      // Update session
      if (config.activeSessionId) {
        await sessionStore.addCreatedTask(config.activeSessionId, task.id);
        if (targetStatus === "doing") {
          await sessionStore.setActiveTask(config.activeSessionId, task.id);
        }
      }

      // Build response with analysis
      const result: any = {
        ok: true,
        task: {
          id: task.id,
          title: analysis.smartTitle,
          status: targetStatus,
          priority: analysis.suggestedPriority,
          tags: analysis.autoTags,
        },
      };

      // Include analysis hints (for the agent, not the user)
      if (analysis.relatedFiles.length > 0) {
        result.analysis = {
          relatedFiles: analysis.relatedFiles.slice(0, 5),
          suggestedApproach: analysis.suggestedApproach,
          hasTests: analysis.hasTests,
          testFiles: analysis.testFiles.slice(0, 3),
          recentChanges: analysis.recentChanges.slice(0, 3),
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }
  );

  // task_analyze — analyze project context for an existing task
  server.tool(
    "task_analyze",
    "Analyze the project to find related files, git history, tests, and suggest an approach for a task. Use before starting work.",
    {
      taskId: z.string().describe("Task ID or title fragment"),
    },
    async ({ taskId }) => {
      const config = await store.getConfig();
      const task = await taskStore.resolve(taskId, config.activeProjectId ?? undefined);
      if (!task) {
        return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };
      }

      const analysis = analyzeForTask(projectRoot, task.title + " " + task.description);

      // Update task context with analysis
      const existingCtx = task.context;
      await taskStore.update(task.id, {
        context: {
          ...existingCtx,
          filesViewed: existingCtx?.filesViewed ?? [],
          decisions: existingCtx?.decisions ?? [],
          remainingWork: existingCtx?.remainingWork ?? [],
          lastAction: existingCtx?.lastAction ?? "",
          suggestedApproach: analysis.suggestedApproach,
          relatedFiles: analysis.relatedFiles.map((f) => f.file),
          savedAt: new Date().toISOString(),
        },
      } as any);

      // Format response
      const lines: string[] = [
        `# Analysis: ${task.title}`,
        "",
      ];

      if (analysis.relatedFiles.length > 0) {
        lines.push("**Related files:**");
        analysis.relatedFiles.forEach((f) => lines.push(`- ${f.file} — ${f.reason}`));
        lines.push("");
      }

      if (analysis.recentChanges.length > 0) {
        lines.push("**Recent related commits:**");
        analysis.recentChanges.forEach((c) => lines.push(`- \`${c.sha}\` ${c.message} (${c.date})`));
        lines.push("");
      }

      if (analysis.testFiles.length > 0) {
        lines.push("**Existing tests:**");
        analysis.testFiles.forEach((f) => lines.push(`- ${f}`));
        lines.push("");
      } else {
        lines.push("**Tests:** None found — consider adding tests", "");
      }

      if (analysis.suggestedApproach.length > 0) {
        lines.push("**Suggested approach:**");
        analysis.suggestedApproach.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
        lines.push("");
      }

      lines.push(`**Auto-tags:** ${analysis.autoTags.join(", ") || "none"}`);
      lines.push(`**Suggested priority:** ${analysis.suggestedPriority}`);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
