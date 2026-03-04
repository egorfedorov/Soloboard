import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionStore } from "../storage/session-store.js";
import { TaskStore } from "../storage/task-store.js";
import { Store } from "../storage/store.js";

export function registerSessionTools(
  server: McpServer,
  store: Store,
  sessionStore: SessionStore,
  taskStore: TaskStore
) {
  // 1. session_log
  server.tool(
    "session_log",
    "Log an event to the current session (file change, commit, etc.)",
    {
      type: z.enum(["file", "commit"]).describe("Event type"),
      value: z.string().describe("File path or commit SHA"),
    },
    async ({ type, value }) => {
      const config = await store.getConfig();
      if (!config.activeSessionId) {
        return { content: [{ type: "text", text: "No active session." }] };
      }

      if (type === "file") {
        await sessionStore.addFile(config.activeSessionId, value);
        // Also add file to active task if there is one
        const session = await sessionStore.get(config.activeSessionId);
        if (session?.activeTaskId) {
          await taskStore.addFile(session.activeTaskId, value);
        }
      } else {
        await sessionStore.addCommit(config.activeSessionId, value);
        const session = await sessionStore.get(config.activeSessionId);
        if (session?.activeTaskId) {
          await taskStore.addCommit(session.activeTaskId, value);
        }
      }

      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    }
  );

  // 2. session_summary
  server.tool(
    "session_summary",
    "Get a summary of the current or specified session",
    {
      sessionId: z.string().optional().describe("Session ID (default: current)"),
    },
    async ({ sessionId }) => {
      const config = await store.getConfig();
      const id = sessionId ?? config.activeSessionId;
      if (!id) {
        return { content: [{ type: "text", text: "No active session." }] };
      }

      const session = await sessionStore.get(id);
      if (!session) {
        return { content: [{ type: "text", text: `Session not found: ${id}` }] };
      }

      const lines: string[] = [
        `# Session Summary`,
        `- Started: ${session.startedAt}`,
        `- Ended: ${session.endedAt ?? "ongoing"}`,
        `- Tasks created: ${session.createdTasks.length}`,
        `- Tasks completed: ${session.completedTasks.length}`,
        `- Commits: ${session.commits.length}`,
        `- Files touched: ${session.files.length}`,
      ];

      if (session.activeTaskId) {
        const task = await taskStore.get(session.activeTaskId);
        if (task) {
          lines.push(`- Active task: ${task.title} (${task.id})`);
        }
      }

      if (session.commits.length > 0) {
        lines.push("", "## Commits");
        for (const sha of session.commits) {
          lines.push(`  - ${sha}`);
        }
      }

      if (session.files.length > 0) {
        lines.push("", "## Files");
        for (const f of session.files) {
          lines.push(`  - ${f}`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );
}
