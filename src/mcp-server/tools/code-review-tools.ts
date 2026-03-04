import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { TaskStore } from "../storage/task-store.js";
import { ReviewStore } from "../storage/review-store.js";
import { ReviewFinding, FindingSeverity, FindingCategory, ReviewVerdict } from "../models/code-review.js";
import { execSync } from "node:child_process";
import fs from "node:fs";

function analyzeFiles(files: string[], projectRoot: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  let findingId = 1;

  for (const file of files) {
    try {
      const fullPath = file.startsWith("/") ? file : `${projectRoot}/${file}`;
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // TODO/FIXME detection
        if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line)) {
          findings.push({
            id: findingId++, file, line: i + 1,
            severity: "warning", category: "todo",
            message: `Found ${line.match(/\b(TODO|FIXME|HACK|XXX)\b/)?.[0]}: ${line.trim().slice(0, 100)}`,
            response: null,
          });
        }
        // console.log detection in non-test files
        if (/console\.(log|debug|warn)\(/.test(line) && !file.includes("test") && !file.includes("spec")) {
          findings.push({
            id: findingId++, file, line: i + 1,
            severity: "info", category: "style",
            message: "Console statement found - consider removing for production",
            response: null,
          });
        }
        // Basic security patterns
        if (/eval\(|innerHTML\s*=/.test(line)) {
          findings.push({
            id: findingId++, file, line: i + 1,
            severity: "critical", category: "security",
            message: "Potential security issue: eval() or innerHTML assignment",
            response: null,
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Type check
  try {
    execSync("npx tsc --noEmit 2>&1", { cwd: projectRoot, encoding: "utf-8", timeout: 30000 });
  } catch (err) {
    const output = err instanceof Error && "stdout" in err ? (err as { stdout: string }).stdout : "";
    if (output) {
      const typeErrors = output.split("\n").filter((l: string) => l.includes("error TS"));
      for (const te of typeErrors.slice(0, 10)) {
        const match = te.match(/(.+)\((\d+),\d+\):\s*error\s+TS\d+:\s*(.+)/);
        if (match) {
          findings.push({
            id: findingId++, file: match[1], line: parseInt(match[2]),
            severity: "error", category: "type_error",
            message: match[3],
            response: null,
          });
        }
      }
    }
  }

  return findings;
}

export function registerCodeReviewTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  reviewStore: ReviewStore,
  projectRoot: string
) {
  // 1. review_run
  server.tool(
    "review_run",
    "Run code review on changed files: TODOs, type errors, patterns, security",
    {
      taskId: z.string().describe("Task ID to review"),
      files: z.array(z.string()).optional().describe("Specific files to review (default: task's files)"),
    },
    async ({ taskId, files }) => {
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      const filesToReview = files ?? task.files;
      if (filesToReview.length === 0) {
        // Try git diff
        try {
          const diff = execSync("git diff --name-only HEAD~1", { cwd: projectRoot, encoding: "utf-8", timeout: 10000 });
          filesToReview.push(...diff.split("\n").filter(Boolean));
        } catch {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No files to review" }) }] };
        }
      }

      const findings = analyzeFiles(filesToReview, projectRoot);
      const hasCritical = findings.some((f) => f.severity === "critical");
      const hasErrors = findings.some((f) => f.severity === "error");

      const verdict: ReviewVerdict = hasCritical ? "changes_requested" : hasErrors ? "needs_discussion" : "approved";
      const summary = `Reviewed ${filesToReview.length} files. Found ${findings.length} issues (${findings.filter((f) => f.severity === "critical").length} critical, ${findings.filter((f) => f.severity === "error").length} errors, ${findings.filter((f) => f.severity === "warning").length} warnings).`;

      const review = await reviewStore.create(taskId, verdict, findings, filesToReview, summary);

      // Update task review status
      await taskStore.update(taskId, { reviewStatus: verdict === "approved" ? "approved" : "changes_requested" });

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, reviewId: review.id, verdict, summary, findingCount: findings.length }) }] };
    }
  );

  // 2. review_findings
  server.tool(
    "review_findings",
    "View detailed findings from a code review",
    {
      reviewId: z.string().optional().describe("Review ID (or latest for task)"),
      taskId: z.string().optional().describe("Task ID to find latest review"),
      severity: z.enum(["info", "warning", "error", "critical"]).optional().describe("Filter by severity"),
    },
    async ({ reviewId, taskId, severity }) => {
      let review;
      if (reviewId) {
        review = await reviewStore.get(reviewId);
      } else if (taskId) {
        const reviews = await reviewStore.findByTask(taskId);
        review = reviews[0];
      }
      if (!review) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Review not found" }) }] };
      }

      let findings = review.findings;
      if (severity) {
        findings = findings.filter((f) => f.severity === severity);
      }

      return { content: [{ type: "text", text: JSON.stringify({
        ok: true,
        reviewId: review.id,
        verdict: review.verdict,
        findings: findings.map((f) => ({
          id: f.id, file: f.file, line: f.line,
          severity: f.severity, category: f.category,
          message: f.message, response: f.response,
        })),
      }) }] };
    }
  );

  // 3. review_respond
  server.tool(
    "review_respond",
    "Respond to a review finding: fixed, wont_fix, or acknowledged",
    {
      reviewId: z.string().describe("Review ID"),
      findingId: z.number().describe("Finding ID within the review"),
      response: z.enum(["fixed", "wont_fix", "acknowledged"]).describe("Response to the finding"),
    },
    async ({ reviewId, findingId, response }) => {
      const review = await reviewStore.respondToFinding(reviewId, findingId, response);
      if (!review) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Review or finding not found" }) }] };
      }

      const allResponded = review.findings.every((f) => f.response !== null);
      const allFixed = review.findings.every((f) => f.response === "fixed" || f.response === "acknowledged");

      return { content: [{ type: "text", text: JSON.stringify({
        ok: true,
        findingId,
        response,
        allResponded,
        allFixed,
        message: allResponded && allFixed ? "All findings addressed — review complete" : undefined,
      }) }] };
    }
  );
}
