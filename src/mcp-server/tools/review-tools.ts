import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TaskStore } from "../storage/task-store.js";
import { BoardStore } from "../storage/board-store.js";
import { Store } from "../storage/store.js";
import { formatDuration } from "../models/task.js";
import { execSync } from "node:child_process";

export function registerReviewTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  boardStore: BoardStore,
  projectRoot: string
) {
  // task_review — pre-close analysis
  server.tool(
    "task_review",
    "Review a task before closing: counts changes, checks for TODOs, verifies tests exist, and provides a summary. Use before moving a task to DONE.",
    {
      taskId: z.string().describe("Task ID or title fragment"),
    },
    async ({ taskId }) => {
      const config = await store.getConfig();
      const task = await taskStore.resolve(taskId, config.activeProjectId ?? undefined);
      if (!task) {
        return { content: [{ type: "text", text: `Task not found: ${taskId}` }] };
      }

      const lines: string[] = [
        `# Task Review: ${task.title}`,
        "",
      ];

      // Time spent
      let totalSecs = task.totalSeconds || 0;
      const openEntry = (task.timeLog || []).find((e) => e.end === null);
      if (openEntry) {
        totalSecs += Math.round((Date.now() - new Date(openEntry.start).getTime()) / 1000);
      }
      lines.push(`**Time spent:** ${formatDuration(totalSecs)}`);

      // Files changed
      lines.push(`**Files changed:** ${task.files.length}`);
      if (task.files.length > 0) {
        task.files.forEach((f) => lines.push(`  - ${f}`));
      }
      lines.push("");

      // Commits
      lines.push(`**Commits:** ${task.commits.length}`);
      if (task.commits.length > 0) {
        for (const sha of task.commits) {
          try {
            const msg = execSync(`git log -1 --format=%s ${sha} 2>/dev/null`, {
              cwd: projectRoot,
              encoding: "utf-8",
            }).trim();
            lines.push(`  - \`${sha}\` ${msg}`);
          } catch {
            lines.push(`  - \`${sha}\``);
          }
        }
      }
      lines.push("");

      // Check for TODOs/FIXMEs in changed files
      const warnings: string[] = [];
      for (const file of task.files) {
        try {
          const fullPath = file.startsWith("/") ? file : `${projectRoot}/${file}`;
          const output = execSync(
            `grep -n '\\bTODO\\b\\|\\bFIXME\\b\\|\\bHACK\\b\\|\\bXXX\\b' "${fullPath}" 2>/dev/null`,
            { encoding: "utf-8", timeout: 3000 }
          ).trim();
          if (output) {
            const count = output.split("\n").length;
            warnings.push(`${file}: ${count} TODO/FIXME found`);
          }
        } catch {
          // No TODOs found or file doesn't exist
        }
      }

      // Check if tests exist for changed files
      const untestedFiles: string[] = [];
      for (const file of task.files) {
        const base = file.replace(/\.(ts|tsx|js|jsx|py|cpp|rs|go)$/, "");
        const testPatterns = [
          `${base}.test.*`,
          `${base}.spec.*`,
          `${base}_test.*`,
        ];
        let hasTest = false;
        for (const pattern of testPatterns) {
          try {
            const found = execSync(
              `find . -path '${pattern}' -not -path '*/node_modules/*' 2>/dev/null | head -1`,
              { cwd: projectRoot, encoding: "utf-8", timeout: 3000 }
            ).trim();
            if (found) {
              hasTest = true;
              break;
            }
          } catch { /* ignore */ }
        }
        if (!hasTest && !file.includes("test") && !file.includes("spec")) {
          untestedFiles.push(file);
        }
      }

      // Check for type errors (TypeScript projects)
      let typeCheckStatus = "";
      try {
        execSync("npx tsc --noEmit 2>&1", {
          cwd: projectRoot,
          encoding: "utf-8",
          timeout: 30000,
        });
        typeCheckStatus = "pass";
      } catch (e: any) {
        if (e.stdout || e.stderr) {
          const output = (e.stdout || "") + (e.stderr || "");
          const errorCount = (output.match(/error TS/g) || []).length;
          if (errorCount > 0) {
            typeCheckStatus = `${errorCount} errors`;
          }
        }
      }

      // Build checklist
      lines.push("## Checklist");
      lines.push("");

      const checks: Array<[boolean, string]> = [
        [task.files.length > 0, "Files changed"],
        [task.commits.length > 0, "Commits made"],
        [warnings.length === 0, `No TODO/FIXME left${warnings.length > 0 ? ` (${warnings.length} found)` : ""}`],
        [untestedFiles.length === 0, `Tests exist for changed files${untestedFiles.length > 0 ? ` (${untestedFiles.length} untested)` : ""}`],
      ];

      if (typeCheckStatus) {
        checks.push([typeCheckStatus === "pass", `Types check${typeCheckStatus !== "pass" ? ` (${typeCheckStatus})` : ""}`]);
      }

      for (const [ok, label] of checks) {
        lines.push(`- [${ok ? "x" : " "}] ${label}`);
      }
      lines.push("");

      // Warnings
      if (warnings.length > 0 || untestedFiles.length > 0) {
        lines.push("## Warnings");
        lines.push("");
        for (const w of warnings) {
          lines.push(`- ⚠ ${w}`);
        }
        for (const f of untestedFiles) {
          lines.push(`- ⚠ No test for: ${f}`);
        }
        lines.push("");
      }

      // Remaining work from context
      if (task.context?.remainingWork && task.context.remainingWork.length > 0) {
        lines.push("## Remaining Work (from context)");
        lines.push("");
        task.context.remainingWork.forEach((w) => lines.push(`- [ ] ${w}`));
        lines.push("");
      }

      // Summary
      const allGood = warnings.length === 0 && untestedFiles.length === 0 &&
        (!task.context?.remainingWork || task.context.remainingWork.length === 0);

      if (allGood) {
        lines.push("**Ready to close.** All checks passed.");
      } else {
        lines.push("**Review warnings above before closing.**");
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
