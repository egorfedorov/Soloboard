import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { TaskStore } from "../storage/task-store.js";
import { BoardStore } from "../storage/board-store.js";
import { QAStore } from "../storage/qa-store.js";
import { TestFailure } from "../models/qa.js";
import { execSync } from "node:child_process";
import fs from "node:fs";

function parseTestOutput(output: string): { passed: number; failed: number; skipped: number; failures: TestFailure[] } {
  const failures: TestFailure[] = [];
  let passed = 0, failed = 0, skipped = 0;

  // Try to parse common test output formats
  // Jest/Vitest format
  const jestMatch = output.match(/Tests:\s+(\d+)\s+failed.*?(\d+)\s+passed/s);
  if (jestMatch) {
    failed = parseInt(jestMatch[1]);
    passed = parseInt(jestMatch[2]);
  }
  const jestPassOnly = output.match(/Tests:\s+(\d+)\s+passed/);
  if (jestPassOnly && !jestMatch) {
    passed = parseInt(jestPassOnly[1]);
  }
  const skippedMatch = output.match(/(\d+)\s+skipped/);
  if (skippedMatch) skipped = parseInt(skippedMatch[1]);

  // Parse FAIL lines
  const failLines = output.split("\n").filter((l) => l.includes("FAIL") || l.includes("✗") || l.includes("✕"));
  for (const line of failLines.slice(0, 20)) {
    const fileMatch = line.match(/(?:FAIL|✗|✕)\s+(.+?)(?:\s|$)/);
    failures.push({
      testName: line.trim().slice(0, 200),
      file: fileMatch?.[1] ?? "unknown",
      error: line.trim(),
      bugTaskId: null,
    });
  }

  // If we couldn't parse, try counting pass/fail indicators
  if (passed === 0 && failed === 0) {
    passed = (output.match(/✓|✔|PASS/g) ?? []).length;
    failed = (output.match(/✗|✕|FAIL/g) ?? []).length;
  }

  return { passed, failed, skipped, failures };
}

export function registerQATools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  boardStore: BoardStore,
  qaStore: QAStore,
  projectRoot: string
) {
  // 1. qa_run
  server.tool(
    "qa_run",
    "Run tests, parse results, and create bug tasks for failures",
    {
      taskId: z.string().describe("Task ID being tested"),
      command: z.string().optional().describe("Test command (default: npm test)"),
      createBugTasks: z.boolean().optional().describe("Auto-create bug tasks for failures (default: true)"),
    },
    async ({ taskId, command, createBugTasks }) => {
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      const testCmd = command ?? "npm test";
      let output = "";
      let exitCode = 0;

      try {
        output = execSync(testCmd, { cwd: projectRoot, encoding: "utf-8", timeout: 120000 });
      } catch (err) {
        exitCode = 1;
        output = err instanceof Error && "stdout" in err ? (err as { stdout: string }).stdout : String(err);
        if (err instanceof Error && "stderr" in err) {
          output += "\n" + (err as { stderr: string }).stderr;
        }
      }

      const parsed = parseTestOutput(output);
      const qa = await qaStore.create(taskId, parsed.passed, parsed.failed, parsed.skipped, parsed.failures, testCmd, output.slice(0, 5000));

      // Create bug tasks for failures
      const shouldCreate = createBugTasks !== false;
      if (shouldCreate && parsed.failures.length > 0) {
        const config = await store.getConfig();
        const bugIds: string[] = [];
        for (const failure of parsed.failures.slice(0, 5)) {
          const bugTask = await taskStore.create(
            `[Bug] Test failure: ${failure.testName.slice(0, 80)}`,
            config.activeProjectId ?? task.projectId,
            { description: `Test failed in ${failure.file}:\n${failure.error}`, priority: "high", tags: ["bug", "test-failure"] }
          );
          if (config.activeProjectId) {
            await boardStore.addTask(config.activeProjectId, bugTask.id, "todo");
          }
          failure.bugTaskId = bugTask.id;
          bugIds.push(bugTask.id);
        }
        await qaStore.update(qa.id, { failures: parsed.failures, bugTasksCreated: bugIds });
      }

      // Update task QA status
      await taskStore.update(taskId, { qaStatus: parsed.failed > 0 ? "failed" : "passed" });

      return { content: [{ type: "text", text: JSON.stringify({
        ok: true,
        qaId: qa.id,
        passed: parsed.passed,
        failed: parsed.failed,
        skipped: parsed.skipped,
        failureCount: parsed.failures.length,
        bugTasksCreated: qa.bugTasksCreated,
        status: parsed.failed > 0 ? "failed" : "passed",
      }) }] };
    }
  );

  // 2. qa_report
  server.tool(
    "qa_report",
    "View QA results for a task",
    {
      taskId: z.string().optional().describe("Task ID"),
      qaId: z.string().optional().describe("Specific QA run ID"),
    },
    async ({ taskId, qaId }) => {
      let result;
      if (qaId) {
        result = await qaStore.get(qaId);
      } else if (taskId) {
        result = await qaStore.getLatest(taskId);
      }
      if (!result) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "QA result not found" }) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify({
        ok: true,
        qaId: result.id,
        taskId: result.taskId,
        passed: result.testsPassed,
        failed: result.testsFailed,
        skipped: result.testsSkipped,
        failures: result.failures,
        bugTasks: result.bugTasksCreated,
        command: result.command,
        ranAt: result.ranAt,
      }) }] };
    }
  );

  // 3. qa_rerun
  server.tool(
    "qa_rerun",
    "Re-run tests after fixes and compare with previous run",
    {
      taskId: z.string().describe("Task ID"),
      command: z.string().optional().describe("Test command (default: same as last run)"),
    },
    async ({ taskId, command }) => {
      const previous = await qaStore.getLatest(taskId);
      const testCmd = command ?? previous?.command ?? "npm test";

      let output = "";
      let exitCode = 0;
      try {
        output = execSync(testCmd, { cwd: projectRoot, encoding: "utf-8", timeout: 120000 });
      } catch (err) {
        exitCode = 1;
        output = err instanceof Error && "stdout" in err ? (err as { stdout: string }).stdout : String(err);
      }

      const parsed = parseTestOutput(output);
      const qa = await qaStore.create(taskId, parsed.passed, parsed.failed, parsed.skipped, parsed.failures, testCmd, output.slice(0, 5000));
      await taskStore.update(taskId, { qaStatus: parsed.failed > 0 ? "failed" : "passed" });

      const comparison = previous ? {
        previousPassed: previous.testsPassed,
        previousFailed: previous.testsFailed,
        passedDelta: parsed.passed - previous.testsPassed,
        failedDelta: parsed.failed - previous.testsFailed,
        improved: parsed.failed < previous.testsFailed,
      } : null;

      return { content: [{ type: "text", text: JSON.stringify({
        ok: true,
        qaId: qa.id,
        passed: parsed.passed,
        failed: parsed.failed,
        status: parsed.failed > 0 ? "failed" : "passed",
        comparison,
      }) }] };
    }
  );

  // 4. qa_coverage
  server.tool(
    "qa_coverage",
    "Check test file coverage for changed files in a task",
    {
      taskId: z.string().describe("Task ID"),
    },
    async ({ taskId }) => {
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      const files = task.files.length > 0 ? task.files : [];
      const coverage: Array<{ file: string; hasTest: boolean; testFile: string | null }> = [];

      for (const file of files) {
        // Look for corresponding test file
        const baseName = file.replace(/\.(ts|js|tsx|jsx)$/, "");
        const possibleTests = [
          `${baseName}.test.ts`, `${baseName}.test.js`,
          `${baseName}.spec.ts`, `${baseName}.spec.js`,
          `__tests__/${file.split("/").pop()}`,
        ];

        let testFile: string | null = null;
        for (const tf of possibleTests) {
          const fullPath = tf.startsWith("/") ? tf : `${projectRoot}/${tf}`;
          if (fs.existsSync(fullPath)) {
            testFile = tf;
            break;
          }
        }

        coverage.push({ file, hasTest: testFile !== null, testFile });
      }

      const coveredCount = coverage.filter((c) => c.hasTest).length;
      const percentage = files.length > 0 ? Math.round((coveredCount / files.length) * 100) : 0;

      return { content: [{ type: "text", text: JSON.stringify({
        ok: true,
        taskId,
        totalFiles: files.length,
        coveredFiles: coveredCount,
        coveragePercent: percentage,
        details: coverage,
      }) }] };
    }
  );
}
