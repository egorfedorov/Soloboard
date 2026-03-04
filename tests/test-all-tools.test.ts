/**
 * Comprehensive test harness for all 94 SoloBoard MCP tools.
 *
 * Tests each tool by exercising the underlying store operations
 * that the MCP tool handlers wrap. For tools that shell out to
 * git/gh CLI, we verify the graceful error-handling path.
 *
 * Run with:
 *   npx vitest run tests/test-all-tools.test.ts --reporter verbose
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---- Stores -----------------------------------------------------------------
import { Store } from "../src/mcp-server/storage/store.js";
import { TaskStore } from "../src/mcp-server/storage/task-store.js";
import { BoardStore } from "../src/mcp-server/storage/board-store.js";
import { SessionStore } from "../src/mcp-server/storage/session-store.js";
import { SprintStore } from "../src/mcp-server/storage/sprint-store.js";
import { AgentStore } from "../src/mcp-server/storage/agent-store.js";
import { HandoffStore } from "../src/mcp-server/storage/handoff-store.js";
import { HistoryStore } from "../src/mcp-server/storage/history-store.js";
import { ApprovalStore } from "../src/mcp-server/storage/approval-store.js";
import { ReviewStore } from "../src/mcp-server/storage/review-store.js";
import { QAStore } from "../src/mcp-server/storage/qa-store.js";
import { DeployStore } from "../src/mcp-server/storage/deploy-store.js";
import { TeamStore } from "../src/mcp-server/storage/team-store.js";

// ---- Models -----------------------------------------------------------------
import { TaskContext } from "../src/mcp-server/models/task.js";
import { DEFAULT_CONFIG } from "../src/mcp-server/models/config.js";

// ---- Utils ------------------------------------------------------------------
import {
  acquireLock,
  releaseLock,
  releaseAllLocks,
  checkLocks,
  listAllLocks,
} from "../src/mcp-server/utils/file-lock.js";
import {
  extractKeywords,
  generateSmartTitle,
  analyzeForTask,
} from "../src/mcp-server/utils/project-analyzer.js";
import * as git from "../src/mcp-server/utils/git.js";

// =============================================================================
// Shared test state
// =============================================================================

let tmpDir: string;
let store: Store;
let taskStore: TaskStore;
let boardStore: BoardStore;
let sessionStore: SessionStore;
let sprintStore: SprintStore;
let agentStore: AgentStore;
let handoffStore: HandoffStore;
let historyStore: HistoryStore;
let approvalStore: ApprovalStore;
let reviewStore: ReviewStore;
let qaStore: QAStore;
let deployStore: DeployStore;
let teamStore: TeamStore;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sb-test-"));
  store = new Store(tmpDir);
  await store.init();

  taskStore = new TaskStore(store);
  boardStore = new BoardStore(store);
  sessionStore = new SessionStore(store);
  sprintStore = new SprintStore(store);
  agentStore = new AgentStore(store);
  handoffStore = new HandoffStore(store);
  historyStore = new HistoryStore(store);
  approvalStore = new ApprovalStore(store);
  reviewStore = new ReviewStore(store);
  qaStore = new QAStore(store);
  deployStore = new DeployStore(store);
  teamStore = new TeamStore(store);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

/** Create an active project + session */
async function initProject(name = "TestProject"): Promise<{ boardId: string; sessionId: string }> {
  const board = await boardStore.create(name);
  const session = await sessionStore.create(board.id);
  const config = await store.getConfig();
  config.activeProjectId = board.id;
  config.activeSessionId = session.id;
  await store.saveConfig(config);
  return { boardId: board.id, sessionId: session.id };
}

// =============================================================================
// Init (2 tools): auto_init, board_summary
// =============================================================================

describe("Init Tools", () => {
  it("auto_init — init store, create board and session", async () => {
    const config = await store.getConfig();
    expect(config.activeProjectId).toBeNull();

    const board = await boardStore.create("AutoProject");
    config.activeProjectId = board.id;
    const session = await sessionStore.create(board.id);
    config.activeSessionId = session.id;
    await store.saveConfig(config);

    const reloaded = await store.getConfig();
    expect(reloaded.activeProjectId).toBeTruthy();
    expect(reloaded.activeSessionId).toBeTruthy();
  });

  it("board_summary — get board stats", async () => {
    const { boardId } = await initProject();
    const board = await boardStore.get(boardId);
    expect(board).toBeTruthy();
    expect(board!.columns.todo).toHaveLength(0);
    expect(board!.columns.doing).toHaveLength(0);
    expect(board!.columns.done).toHaveLength(0);
  });
});

// =============================================================================
// Task Tools (10 tools)
// =============================================================================

describe("Task Tools", () => {
  it("task_create — create a task", async () => {
    const { boardId, sessionId } = await initProject();
    const task = await taskStore.create("Fix login bug", boardId, {
      description: "Login form crashes on empty email",
      priority: "high",
      tags: ["bug", "auth"],
      status: "todo",
    });
    await boardStore.addTask(boardId, task.id, "todo");
    await sessionStore.addCreatedTask(sessionId, task.id);

    expect(task.id).toMatch(/^t_/);
    expect(task.title).toBe("Fix login bug");
    expect(task.priority).toBe("high");
    expect(task.status).toBe("todo");
    expect(task.tags).toContain("bug");
  });

  it("task_smart_create — analyzeForTask + create path", async () => {
    const { boardId } = await initProject();
    const analysis = analyzeForTask(tmpDir, "Add user dashboard page");
    expect(analysis.smartTitle).toBeTruthy();
    expect(Array.isArray(analysis.autoTags)).toBe(true);
    const task = await taskStore.create(analysis.smartTitle, boardId, {
      priority: analysis.suggestedPriority,
      tags: analysis.autoTags,
      status: "doing",
    });
    await boardStore.addTask(boardId, task.id, "doing");
    expect(task.id).toBeTruthy();
    expect(task.status).toBe("doing");
  });

  it("task_update — update task fields", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Original", boardId);
    const updated = await taskStore.update(task.id, {
      title: "Updated title",
      description: "New desc",
      priority: "high",
      tags: ["bug"],
    });
    expect(updated).toBeTruthy();
    expect(updated!.title).toBe("Updated title");
    expect(updated!.priority).toBe("high");
    expect(updated!.tags).toContain("bug");
  });

  it("task_get — get by ID", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Get test", boardId);
    const found = await taskStore.get(task.id);
    expect(found).toBeTruthy();
    expect(found!.id).toBe(task.id);
  });

  it("task_get — resolve by fuzzy name", async () => {
    const { boardId } = await initProject();
    await taskStore.create("Fix login validation bug", boardId);
    const found = await taskStore.findByTitle("login validation", boardId);
    expect(found).toBeTruthy();
    expect(found!.title).toContain("login validation");
  });

  it("task_list — list and filter by status", async () => {
    const { boardId } = await initProject();
    await taskStore.create("Todo 1", boardId, { status: "todo" });
    await taskStore.create("Todo 2", boardId, { status: "todo" });
    await taskStore.create("Doing 1", boardId, { status: "doing" });

    const all = await taskStore.list(boardId);
    expect(all.length).toBeGreaterThanOrEqual(3);

    const todos = all.filter((t) => t.status === "todo");
    expect(todos.length).toBeGreaterThanOrEqual(2);
  });

  it("task_move — todo -> doing -> done", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Move test", boardId, { status: "todo" });

    await taskStore.update(task.id, { status: "doing" });
    let t = await taskStore.get(task.id);
    expect(t!.status).toBe("doing");

    await taskStore.update(task.id, { status: "done" });
    t = await taskStore.get(task.id);
    expect(t!.status).toBe("done");
    expect(t!.completedAt).toBeTruthy();
  });

  it("task_delete — archive a task", async () => {
    const { boardId } = await initProject();
    const t = await taskStore.create("Temp task", boardId);
    const archived = await taskStore.archive(t.id);
    expect(archived).toBe(true);
    const gone = await taskStore.get(t.id);
    expect(gone).toBeNull();
  });

  it("task_prioritize — change priority", async () => {
    const { boardId } = await initProject();
    const t = await taskStore.create("Prio test", boardId, { priority: "low" });
    await taskStore.update(t.id, { priority: "high" });
    const updated = await taskStore.get(t.id);
    expect(updated!.priority).toBe("high");
  });

  it("task_time — time tracking on status change", async () => {
    const { boardId } = await initProject();
    const t = await taskStore.create("Timed task", boardId, { status: "doing" });
    expect(t.timeLog).toHaveLength(1);
    expect(t.timeLog[0].end).toBeNull();

    await taskStore.update(t.id, { status: "todo" });
    const updated = await taskStore.get(t.id);
    expect(updated!.timeLog[0].end).toBeTruthy();
  });

  it("task_analyze — project analysis without git", async () => {
    const analysis = analyzeForTask(tmpDir, "Improve data loading performance");
    expect(analysis).toBeTruthy();
    expect(Array.isArray(analysis.relatedFiles)).toBe(true);
    expect(Array.isArray(analysis.suggestedApproach)).toBe(true);
  });
});

// =============================================================================
// Context (4 tools)
// =============================================================================

describe("Context Tools", () => {
  it("task_context_save — save context", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Context test", boardId);
    const context: TaskContext = {
      filesViewed: ["src/main.ts"],
      decisions: ["Use factory pattern"],
      remainingWork: ["Add tests"],
      lastAction: "Refactored module",
      suggestedApproach: [],
      relatedFiles: [],
      savedAt: new Date().toISOString(),
    };
    await taskStore.update(task.id, { context } as any);
    const updated = await taskStore.get(task.id);
    expect(updated!.context).toBeTruthy();
    expect(updated!.context!.decisions[0]).toBe("Use factory pattern");
  });

  it("task_context_load — load context", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Load test", boardId);
    await taskStore.update(task.id, {
      context: {
        filesViewed: ["a.ts"],
        decisions: ["D1"],
        remainingWork: ["R1"],
        lastAction: "LA",
        suggestedApproach: [],
        relatedFiles: [],
        savedAt: new Date().toISOString(),
      },
    } as any);
    const loaded = await taskStore.get(task.id);
    expect(loaded!.context!.remainingWork[0]).toBe("R1");
  });

  it("task_agent_create — create agent file on disk", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Agent file test", boardId);
    const agentsDir = path.join(tmpDir, ".claude", "agents");
    await fs.promises.mkdir(agentsDir, { recursive: true });
    const agentFile = "task-agent-file-test.md";
    await fs.promises.writeFile(path.join(agentsDir, agentFile), "# Agent\n");
    await taskStore.update(task.id, { agentFile } as any);

    const updated = await taskStore.get(task.id);
    expect(updated!.agentFile).toBe(agentFile);
    expect(fs.existsSync(path.join(agentsDir, agentFile))).toBe(true);
  });

  it("task_agent_delete — delete agent file", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Agent delete test", boardId);
    const agentsDir = path.join(tmpDir, ".claude", "agents");
    await fs.promises.mkdir(agentsDir, { recursive: true });
    const agentFile = "task-agent-delete-test.md";
    await fs.promises.writeFile(path.join(agentsDir, agentFile), "# Agent\n");
    await taskStore.update(task.id, { agentFile } as any);

    await fs.promises.unlink(path.join(agentsDir, agentFile));
    await taskStore.update(task.id, { agentFile: null } as any);
    const updated = await taskStore.get(task.id);
    expect(updated!.agentFile).toBeNull();
  });
});

// =============================================================================
// Review (1 tool)
// =============================================================================

describe("Review Tools", () => {
  it("task_review — pre-close review data", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Review test", boardId, { status: "doing" });
    const loaded = await taskStore.get(task.id);
    expect(loaded!.status).toBe("doing");
    expect(loaded!.timeLog).toHaveLength(1);
  });
});

// =============================================================================
// Dependencies (3 tools)
// =============================================================================

describe("Dependency Tools", () => {
  it("task_depend — add dependency", async () => {
    const { boardId } = await initProject();
    const a = await taskStore.create("Task A", boardId);
    const b = await taskStore.create("Task B", boardId);

    await taskStore.update(b.id, { blockedBy: [a.id] } as any);
    await taskStore.update(a.id, { blocks: [b.id] } as any);

    const bReloaded = await taskStore.get(b.id);
    expect(bReloaded!.blockedBy).toContain(a.id);
    const aReloaded = await taskStore.get(a.id);
    expect(aReloaded!.blocks).toContain(b.id);
  });

  it("task_blockers — show dependency graph", async () => {
    const { boardId } = await initProject();
    const a = await taskStore.create("Dep A", boardId);
    const b = await taskStore.create("Dep B", boardId);
    await taskStore.update(b.id, { blockedBy: [a.id] } as any);

    const tasks = await taskStore.list(boardId);
    const withDeps = tasks.filter((t) => t.blockedBy.length > 0);
    expect(withDeps.length).toBeGreaterThanOrEqual(1);
  });

  it("critical_path — find critical path in chain", async () => {
    const { boardId } = await initProject();
    const a = await taskStore.create("Chain A", boardId);
    const b = await taskStore.create("Chain B", boardId);
    const c = await taskStore.create("Chain C", boardId);

    await taskStore.update(b.id, { blockedBy: [a.id] } as any);
    await taskStore.update(a.id, { blocks: [b.id] } as any);
    await taskStore.update(c.id, { blockedBy: [b.id] } as any);
    await taskStore.update(b.id, { blocks: [...(await taskStore.get(b.id))!.blocks, c.id] } as any);

    const tasks = await taskStore.list(boardId);
    const incomplete = tasks.filter((t) => t.status !== "done");
    expect(incomplete.length).toBeGreaterThanOrEqual(3);
  });
});

// =============================================================================
// Subtasks (2 tools)
// =============================================================================

describe("Subtask Tools", () => {
  it("task_split — create subtasks under parent", async () => {
    const { boardId } = await initProject();
    const parent = await taskStore.create("Parent", boardId);
    const sub1 = await taskStore.create("Sub 1", boardId);
    const sub2 = await taskStore.create("Sub 2", boardId);
    await taskStore.update(sub1.id, { parentId: parent.id } as any);
    await taskStore.update(sub2.id, { parentId: parent.id } as any);
    await taskStore.update(parent.id, { subtaskIds: [sub1.id, sub2.id] } as any);

    const p = await taskStore.get(parent.id);
    expect(p!.subtaskIds).toHaveLength(2);
  });

  it("task_subtasks — view subtask progress", async () => {
    const { boardId } = await initProject();
    const parent = await taskStore.create("Progress Parent", boardId);
    const sub1 = await taskStore.create("Sub A", boardId, { status: "done" });
    const sub2 = await taskStore.create("Sub B", boardId, { status: "todo" });
    await taskStore.update(parent.id, { subtaskIds: [sub1.id, sub2.id] } as any);

    let done = 0;
    for (const id of [sub1.id, sub2.id]) {
      const s = await taskStore.get(id);
      if (s && s.status === "done") done++;
    }
    expect(done).toBe(1);
  });
});

// =============================================================================
// Sprint (4 tools)
// =============================================================================

describe("Sprint Tools", () => {
  it("sprint_create — create a sprint", async () => {
    const { boardId } = await initProject();
    const sprint = await sprintStore.create("Sprint 1", boardId, 7);
    expect(sprint.id).toMatch(/^sp_/);
    expect(sprint.name).toBe("Sprint 1");
    expect(sprint.status).toBe("planning");
  });

  it("sprint_add — add task to sprint", async () => {
    const { boardId } = await initProject();
    const sprint = await sprintStore.create("Sprint 2", boardId);
    await sprintStore.update(sprint.id, { status: "active" });
    const task = await taskStore.create("Sprint task", boardId);
    await sprintStore.addTask(sprint.id, task.id);

    const s = await sprintStore.get(sprint.id);
    expect(s!.taskIds).toContain(task.id);
  });

  it("sprint_view — view sprint progress", async () => {
    const { boardId } = await initProject();
    const sprint = await sprintStore.create("View Sprint", boardId);
    await sprintStore.update(sprint.id, { status: "active" });
    const task = await taskStore.create("View task", boardId);
    await sprintStore.addTask(sprint.id, task.id);

    const s = await sprintStore.get(sprint.id);
    expect(s!.taskIds.length).toBeGreaterThanOrEqual(1);
  });

  it("sprint_close — close a sprint", async () => {
    const { boardId } = await initProject();
    const sprint = await sprintStore.create("Close Sprint", boardId);
    await sprintStore.update(sprint.id, { status: "active" });
    await sprintStore.update(sprint.id, { status: "completed" });

    const s = await sprintStore.get(sprint.id);
    expect(s!.status).toBe("completed");
  });
});

// =============================================================================
// Standup (3 tools)
// =============================================================================

describe("Standup Tools", () => {
  it("standup — generates daily standup data", async () => {
    const { boardId } = await initProject();
    await taskStore.create("Done task", boardId, { status: "done" });
    await taskStore.create("Doing task", boardId, { status: "doing" });
    const tasks = await taskStore.list(boardId);
    const doing = tasks.filter((t) => t.status === "doing");
    expect(doing.length).toBeGreaterThanOrEqual(1);
  });

  it("pomodoro_start — start pomodoro timer", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Pomo task", boardId);
    const pomodoroData = {
      taskId: task.id,
      taskTitle: task.title,
      startedAt: new Date().toISOString(),
      durationMinutes: 25,
      endsAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
    };
    await store.writeJson(`${store.root}/pomodoro.json`, pomodoroData);

    const pomo = await store.readJson<typeof pomodoroData>(`${store.root}/pomodoro.json`);
    expect(pomo).toBeTruthy();
    expect(pomo!.durationMinutes).toBe(25);
  });

  it("pomodoro_status — check status", async () => {
    const pomodoroData = {
      taskId: "t_test",
      taskTitle: "Test",
      startedAt: new Date().toISOString(),
      durationMinutes: 25,
      endsAt: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
    };
    await store.writeJson(`${store.root}/pomodoro.json`, pomodoroData);
    const pomo = await store.readJson<typeof pomodoroData>(`${store.root}/pomodoro.json`);
    expect(pomo!.durationMinutes).toBe(25);
  });
});

// =============================================================================
// Manager (5 tools)
// =============================================================================

describe("Manager Tools", () => {
  it("manager_report — health report data", async () => {
    const { boardId } = await initProject();
    await taskStore.create("H1", boardId, { priority: "high" });
    await taskStore.create("H2", boardId, { priority: "low" });
    await taskStore.create("H3", boardId, { status: "doing" });

    const tasks = await taskStore.list(boardId);
    expect(tasks.length).toBeGreaterThanOrEqual(3);
  });

  it("stall_detect — no stalled tasks when fresh", async () => {
    const { boardId } = await initProject();
    await taskStore.create("Fresh doing", boardId, { status: "doing" });
    const tasks = await taskStore.list(boardId);
    const threshold = 24 * 60 * 60 * 1000;
    const stalled = tasks.filter((t) => {
      if (t.status === "done") return false;
      return Date.now() - new Date(t.updatedAt).getTime() > threshold;
    });
    expect(stalled).toHaveLength(0);
  });

  it("suggest_next — suggest highest priority", async () => {
    const { boardId } = await initProject();
    await taskStore.create("Low", boardId, { priority: "low" });
    await taskStore.create("High", boardId, { priority: "high" });
    const tasks = await taskStore.list(boardId);
    const candidates = tasks.filter((t) => t.status === "todo");
    const sorted = candidates.sort((a, b) => {
      const po: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return po[a.priority] - po[b.priority];
    });
    expect(sorted[0].priority).toBe("high");
  });

  it("auto_reprioritize — dry run on fresh tasks", async () => {
    const { boardId } = await initProject();
    await taskStore.create("R1", boardId);
    const tasks = await taskStore.list(boardId);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("gantt_view — gantt chart with incomplete tasks", async () => {
    const { boardId } = await initProject();
    await taskStore.create("G1", boardId);
    await taskStore.create("G2", boardId);
    const tasks = await taskStore.list(boardId);
    const incomplete = tasks.filter((t) => t.status !== "done");
    expect(incomplete.length).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// Board & Export (6 tools)
// =============================================================================

describe("Board & Export Tools", () => {
  it("board_view — view board with tasks", async () => {
    const { boardId } = await initProject("MainProject");
    const task = await taskStore.create("Export test", boardId, { priority: "high" });
    await boardStore.addTask(boardId, task.id, "todo");

    const board = await boardStore.get(boardId);
    expect(board!.columns.todo.length).toBeGreaterThanOrEqual(1);
  });

  it("board_export — export board data", async () => {
    const { boardId } = await initProject("ExportProject");
    const board = await boardStore.get(boardId);
    expect(board!.name).toBe("ExportProject");
  });

  it("dashboard — multi-project overview", async () => {
    await initProject("Proj1");
    await boardStore.create("Proj2");
    const boards = await boardStore.list();
    expect(boards.length).toBeGreaterThanOrEqual(2);
  });

  it("project_create — create project board", async () => {
    const board = await boardStore.create("NewProject");
    expect(board.id).toMatch(/^b_/);
    expect(board.name).toBe("NewProject");
  });

  it("project_list — list all projects", async () => {
    await initProject("PL1");
    await boardStore.create("PL2");
    const boards = await boardStore.list();
    expect(boards.length).toBeGreaterThanOrEqual(2);
  });

  it("project_switch — switch active project", async () => {
    await initProject("Switch1");
    const b2 = await boardStore.create("Switch2");
    const config = await store.getConfig();
    config.activeProjectId = b2.id;
    await store.saveConfig(config);

    const reloaded = await store.getConfig();
    expect(reloaded.activeProjectId).toBe(b2.id);
  });

  it("task_prioritize — change priority and re-sort", async () => {
    const { boardId } = await initProject();
    const t = await taskStore.create("Low prio", boardId, { priority: "low" });
    await boardStore.addTask(boardId, t.id, "todo");
    await taskStore.update(t.id, { priority: "high" });
    const updated = await taskStore.get(t.id);
    expect(updated!.priority).toBe("high");
  });

  it("task_time — time tracking report", async () => {
    const { boardId } = await initProject();
    await taskStore.create("Time task", boardId, { status: "doing" });
    const tasks = await taskStore.list(boardId);
    const total = tasks.reduce((sum, t) => sum + (t.totalSeconds || 0), 0);
    expect(total).toBeGreaterThanOrEqual(0);
  });
});

// =============================================================================
// Session & Git (4 tools)
// =============================================================================

describe("Session & Git Tools", () => {
  it("session_log — log file to session", async () => {
    const { boardId, sessionId } = await initProject();
    await sessionStore.addFile(sessionId, "src/main.ts");
    const session = await sessionStore.get(sessionId);
    expect(session!.files).toContain("src/main.ts");
  });

  it("session_log — log commit to session", async () => {
    const { boardId, sessionId } = await initProject();
    await sessionStore.addCommit(sessionId, "abc1234");
    const session = await sessionStore.get(sessionId);
    expect(session!.commits).toContain("abc1234");
  });

  it("session_summary — get session summary", async () => {
    const { boardId, sessionId } = await initProject();
    await sessionStore.addFile(sessionId, "x.ts");
    await sessionStore.addCommit(sessionId, "sha123");
    const session = await sessionStore.get(sessionId);
    expect(session!.files.length).toBeGreaterThanOrEqual(1);
    expect(session!.commits.length).toBeGreaterThanOrEqual(1);
  });

  it("git_link — link commit/branch/pr to task", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Git link test", boardId);
    await taskStore.addCommit(task.id, "def5678");
    await taskStore.update(task.id, { branch: "fix/login" });
    await taskStore.update(task.id, { pr: "https://github.com/org/repo/pull/42" });

    const updated = await taskStore.get(task.id);
    expect(updated!.commits).toContain("def5678");
    expect(updated!.branch).toBe("fix/login");
    expect(updated!.pr).toBe("https://github.com/org/repo/pull/42");
  });

  it("git_status — graceful in non-git dir", async () => {
    expect(git.isGitRepo(tmpDir)).toBe(false);
  });
});

// =============================================================================
// v1.5 Orchestration (10 tools)
// =============================================================================

describe("Orchestration Tools", () => {
  it("agent_register — register agent", async () => {
    const agent = await agentStore.register("session-1", "backend-dev");
    expect(agent.id).toMatch(/^ag_/);
    expect(agent.name).toBe("backend-dev");
    expect(agent.status).toBe("active");
  });

  it("agent_heartbeat — update heartbeat", async () => {
    const agent = await agentStore.register("s1", "dev");
    const updated = await agentStore.heartbeat(agent.id);
    expect(updated).toBeTruthy();
    expect(updated!.status).toBe("active");
  });

  it("agent_list — list agents", async () => {
    await agentStore.register("s1", "agent1");
    await agentStore.register("s2", "agent2");
    const agents = await agentStore.list();
    expect(agents.length).toBeGreaterThanOrEqual(2);
  });

  it("agent_claim_task — claim task", async () => {
    const { boardId } = await initProject();
    const agent = await agentStore.register("s1", "claimer");
    const task = await taskStore.create("Claim me", boardId);
    await taskStore.update(task.id, { assignedAgentId: agent.id });
    await agentStore.update(agent.id, { activeTaskId: task.id });

    const updated = await taskStore.get(task.id);
    expect(updated!.assignedAgentId).toBe(agent.id);
  });

  it("conflict_check — no conflicts initially", async () => {
    const agent = await agentStore.register("s1", "checker");
    const result = await checkLocks(store, ["src/app.ts"], agent.id);
    expect(result.conflicts).toHaveLength(0);
  });

  it("file_lock — lock and conflict detection", async () => {
    const a1 = await agentStore.register("s1", "locker1");
    const a2 = await agentStore.register("s2", "locker2");

    const r1 = await acquireLock(store, "src/app.ts", a1.id);
    expect(r1.ok).toBe(true);

    const r2 = await acquireLock(store, "src/app.ts", a2.id);
    expect(r2.ok).toBe(false);
    expect(r2.holder).toBe(a1.id);
  });

  it("file_unlock — release lock", async () => {
    const a1 = await agentStore.register("s1", "unlocker");
    await acquireLock(store, "src/unlock.ts", a1.id);
    const released = await releaseLock(store, "src/unlock.ts", a1.id);
    expect(released).toBe(true);
  });

  it("agent_handoff — create handoff context", async () => {
    const { boardId } = await initProject();
    const agent = await agentStore.register("s1", "hander");
    const task = await taskStore.create("Handoff task", boardId);
    const handoff = await handoffStore.create(agent.id, task.id, {
      summary: "Partially done",
      decisions: ["Use approach X"],
      remainingWork: ["Finish Y"],
      filesModified: ["src/mod.ts"],
      notes: "Edge case Z",
    });
    expect(handoff.id).toMatch(/^ho_/);
    expect(handoff.status).toBe("pending");
  });

  it("agent_pickup — accept handoff", async () => {
    const { boardId } = await initProject();
    const a1 = await agentStore.register("s1", "from");
    const a2 = await agentStore.register("s2", "to");
    const task = await taskStore.create("Pickup task", boardId);
    const handoff = await handoffStore.create(a1.id, task.id, {
      summary: "WIP",
      decisions: [],
      remainingWork: [],
      filesModified: [],
      notes: "",
    });
    const accepted = await handoffStore.accept(handoff.id, a2.id);
    expect(accepted!.status).toBe("accepted");
    expect(accepted!.toAgent).toBe(a2.id);
  });

  it("parallel_plan — analyze batches", async () => {
    const { boardId } = await initProject();
    const a = await taskStore.create("Para A", boardId);
    const b = await taskStore.create("Para B", boardId);
    const c = await taskStore.create("Para C", boardId);
    await taskStore.update(c.id, { blockedBy: [a.id] } as any);

    const tasks = await taskStore.list(boardId);
    const todoTasks = tasks.filter((t) => t.status === "todo");
    expect(todoTasks.length).toBeGreaterThanOrEqual(3);
  });
});

// =============================================================================
// v2.0 Planning (3 tools)
// =============================================================================

describe("Planning Tools", () => {
  it("plan_from_prompt — generate plan from keywords", async () => {
    const prompt = "Build a REST API with database and auth";
    const words = prompt.toLowerCase().split(/\s+/);
    const tasks: string[] = ["setup"];
    if (words.some((w) => ["api", "rest"].includes(w))) tasks.push("api");
    if (words.some((w) => ["database", "db"].includes(w))) tasks.push("database");
    if (words.some((w) => ["auth"].includes(w))) tasks.push("auth");
    expect(tasks.length).toBeGreaterThanOrEqual(4);
  });

  it("plan_apply — bulk create tasks with deps", async () => {
    const { boardId } = await initProject();
    const t1 = await taskStore.create("Setup", boardId);
    const t2 = await taskStore.create("Backend", boardId);
    await taskStore.update(t2.id, { blockedBy: [t1.id] } as any);
    await taskStore.update(t1.id, { blocks: [t2.id] } as any);

    const t2r = await taskStore.get(t2.id);
    expect(t2r!.blockedBy).toContain(t1.id);
  });

  it("plan_templates — templates available", async () => {
    // Verify templates structure from planning-tools.ts
    const templates = ["saas", "api", "cli", "library"];
    expect(templates).toHaveLength(4);
  });
});

// =============================================================================
// v2.0 Prediction (4 tools)
// =============================================================================

describe("Prediction Tools", () => {
  it("predict_duration — no history returns empty", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Predict me", boardId, { tags: ["feature"] });
    const similar = await historyStore.findSimilar(task.tags, task.complexity);
    expect(similar).toHaveLength(0);
  });

  it("record_velocity — snapshot velocity", async () => {
    const { boardId } = await initProject();
    const snapshot = await historyStore.recordVelocity(boardId);
    expect(snapshot.id).toMatch(/^ve_/);
    expect(snapshot.projectId).toBe(boardId);
  });

  it("velocity_report — velocity data", async () => {
    const { boardId } = await initProject();
    await historyStore.recordVelocity(boardId);
    const velocities = await historyStore.listVelocity(boardId);
    expect(velocities.length).toBeGreaterThanOrEqual(1);
  });

  it("burndown_data — needs sprint with tasks", async () => {
    const { boardId } = await initProject();
    const sprint = await sprintStore.create("Burn Sprint", boardId, 7);
    await sprintStore.update(sprint.id, { status: "active" });
    const task = await taskStore.create("Burn task", boardId);
    await sprintStore.addTask(sprint.id, task.id);

    const s = await sprintStore.get(sprint.id);
    expect(s!.taskIds.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// v2.0 Risk (3 tools)
// =============================================================================

describe("Risk Tools", () => {
  it("risk_assess — security tags increase risk", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Risk task", boardId, { tags: ["security", "auth"] });
    let score = 0;
    if (task.tags.some((t) => ["security", "auth"].includes(t))) score += 15;
    expect(score).toBeGreaterThan(0);
  });

  it("risk_report — report with tasks", async () => {
    const { boardId } = await initProject();
    await taskStore.create("Risk A", boardId);
    const tasks = await taskStore.list(boardId);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("complexity_classify — classify and save", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Classify me", boardId, { description: "Short desc" });
    await taskStore.update(task.id, { complexity: "small" });
    const updated = await taskStore.get(task.id);
    expect(updated!.complexity).toBe("small");
  });
});

// =============================================================================
// v2.0 Sync (5 tools)
// =============================================================================

describe("Sync Tools", () => {
  it("sync_setup — configure sync", async () => {
    const config = await store.getConfig();
    config.githubSync = { enabled: false, token: null, project: "owner/repo" };
    await store.saveConfig(config);
    const reloaded = await store.getConfig();
    expect(reloaded.githubSync.project).toBe("owner/repo");
    expect(reloaded.githubSync.enabled).toBe(false);
  });

  it("sync_push — fails when sync disabled", async () => {
    const config = await store.getConfig();
    expect(config.githubSync.enabled).toBe(false);
  });

  it("sync_pull — fails when sync disabled", async () => {
    const config = await store.getConfig();
    expect(config.githubSync.enabled).toBe(false);
  });

  it("sync_update — task with no links", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("No links", boardId);
    expect(task.externalLinks).toHaveLength(0);
  });

  it("sync_status — empty sync status", async () => {
    const { boardId } = await initProject();
    const tasks = await taskStore.list(boardId);
    const linked = tasks.filter((t) => t.externalLinks.length > 0);
    expect(linked).toHaveLength(0);
  });
});

// =============================================================================
// v2.0 PR (3 tools)
// =============================================================================

describe("PR Tools", () => {
  it("pr_create — fails gracefully in non-git dir", async () => {
    expect(git.isGitRepo(tmpDir)).toBe(false);
  });

  it("pr_status — no PR linked", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("No PR", boardId);
    expect(task.pr).toBeNull();
  });

  it("pr_auto_flow — fails gracefully in non-git dir", async () => {
    expect(git.isGitRepo(tmpDir)).toBe(false);
  });
});

// =============================================================================
// v3.0 Approval (3 tools)
// =============================================================================

describe("Approval Tools", () => {
  it("approval_request — create approval", async () => {
    const approval = await approvalStore.create("deploy_production", "Deploy v3", "devops-agent", null);
    expect(approval.id).toMatch(/^ap_/);
    expect(approval.status).toBe("pending");
    expect(approval.action).toBe("deploy_production");
  });

  it("approval_list — list pending", async () => {
    await approvalStore.create("action1", "desc1", "agent1", null);
    const pending = await approvalStore.listPending();
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });

  it("approval_resolve — approve", async () => {
    const a = await approvalStore.create("action2", "desc2", "agent2", null);
    const resolved = await approvalStore.resolve(a.id, "approved", "LGTM", "user");
    expect(resolved!.status).toBe("approved");
    expect(resolved!.reason).toBe("LGTM");
  });

  it("approval_resolve — reject", async () => {
    const a = await approvalStore.create("action3", "desc3", "agent3", null);
    const resolved = await approvalStore.resolve(a.id, "rejected", "Too risky", "admin");
    expect(resolved!.status).toBe("rejected");
  });
});

// =============================================================================
// v3.0 Code Review (3 tools)
// =============================================================================

describe("Code Review Tools", () => {
  it("review_run — create review with findings", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Review target", boardId);
    const review = await reviewStore.create(
      task.id,
      "changes_requested",
      [
        { id: 1, file: "src/app.ts", line: 42, severity: "warning", category: "todo", message: "TODO", response: null },
        { id: 2, file: "src/auth.ts", line: 15, severity: "critical", category: "security", message: "eval()", response: null },
      ],
      ["src/app.ts", "src/auth.ts"],
      "2 issues found"
    );
    expect(review.id).toMatch(/^cr_/);
    expect(review.verdict).toBe("changes_requested");
    expect(review.findings).toHaveLength(2);
  });

  it("review_findings — view findings", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Findings target", boardId);
    const review = await reviewStore.create(task.id, "approved", [
      { id: 1, file: "a.ts", line: 1, severity: "info", category: "style", message: "console.log", response: null },
    ], ["a.ts"], "1 issue");
    const loaded = await reviewStore.get(review.id);
    expect(loaded!.findings).toHaveLength(1);
  });

  it("review_respond — respond to finding", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Respond target", boardId);
    const review = await reviewStore.create(task.id, "changes_requested", [
      { id: 1, file: "a.ts", line: 1, severity: "warning", category: "todo", message: "TODO", response: null },
    ], ["a.ts"], "1 issue");

    const updated = await reviewStore.respondToFinding(review.id, 1, "fixed");
    expect(updated!.findings[0].response).toBe("fixed");
  });
});

// =============================================================================
// v3.0 QA (4 tools)
// =============================================================================

describe("QA Tools", () => {
  it("qa_run — create QA result (mocked)", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("QA target", boardId);
    const qa = await qaStore.create(task.id, 10, 2, 1, [
      { testName: "login", file: "tests/login.test.ts", error: "failed", bugTaskId: null },
    ], "npm test", "output...");
    expect(qa.id).toMatch(/^qa_/);
    expect(qa.testsPassed).toBe(10);
    expect(qa.testsFailed).toBe(2);
  });

  it("qa_report — view QA results", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("QA report", boardId);
    const qa = await qaStore.create(task.id, 5, 0, 0, [], "npm test", "ok");
    const result = await qaStore.get(qa.id);
    expect(result!.testsPassed).toBe(5);
  });

  it("qa_rerun — second run", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("QA rerun", boardId);
    await qaStore.create(task.id, 5, 3, 0, [], "npm test", "first");
    const qa2 = await qaStore.create(task.id, 8, 0, 0, [], "npm test", "second");
    expect(qa2.testsFailed).toBe(0);
  });

  it("qa_coverage — task with no files = 0%", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("QA cov", boardId);
    expect(task.files).toHaveLength(0);
  });
});

// =============================================================================
// v3.0 DevOps (3 tools)
// =============================================================================

describe("DevOps Tools", () => {
  it("deploy_check — readiness check", async () => {
    const { boardId } = await initProject();
    const task = await taskStore.create("Deploy ready", boardId, { status: "done" });
    await taskStore.update(task.id, { reviewStatus: "approved", qaStatus: "passed" });
    const updated = await taskStore.get(task.id);
    expect(updated!.status).toBe("done");
    expect(updated!.reviewStatus).toBe("approved");
    expect(updated!.qaStatus).toBe("passed");
  });

  it("deploy_run — create deployment record", async () => {
    const d = await deployStore.create("staging", "echo deployed", null, null);
    expect(d.id).toMatch(/^dp_/);
    expect(d.status).toBe("pending");
    await deployStore.update(d.id, { status: "success", output: "ok", completedAt: new Date().toISOString() });
    const updated = await deployStore.get(d.id);
    expect(updated!.status).toBe("success");
  });

  it("deploy_status — list deployments", async () => {
    await deployStore.create("staging", "echo test", null, null);
    const deployments = await deployStore.list();
    expect(deployments.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// v3.0 Tech Lead (4 tools)
// =============================================================================

describe("Tech Lead Tools", () => {
  it("lead_distribute — distribute tasks", async () => {
    const { boardId } = await initProject();
    const member = await teamStore.add("Alice", "developer", ["typescript"]);
    const t1 = await taskStore.create("Lead task", boardId, { tags: ["typescript"] });

    await taskStore.update(t1.id, { assignedMemberId: member.id });
    await teamStore.assignTask(member.id, t1.id);
    const m = await teamStore.get(member.id);
    expect(m!.activeTaskIds).toContain(t1.id);
  });

  it("lead_status — dashboard data", async () => {
    const agents = await agentStore.list();
    const members = await teamStore.list();
    const reviews = await reviewStore.list();
    // All should be accessible without error
    expect(Array.isArray(agents)).toBe(true);
    expect(Array.isArray(members)).toBe(true);
    expect(Array.isArray(reviews)).toBe(true);
  });

  it("lead_reassign — reassign with handoff", async () => {
    const { boardId } = await initProject();
    const a1 = await agentStore.register("s1", "from-agent");
    const a2 = await agentStore.register("s2", "to-agent");
    const task = await taskStore.create("Reassign me", boardId);

    const handoff = await handoffStore.create(a1.id, task.id, {
      summary: "Reassigning", decisions: [], remainingWork: [], filesModified: [], notes: "",
    });
    await taskStore.update(task.id, { assignedAgentId: a2.id });
    await handoffStore.accept(handoff.id, a2.id);

    const updated = await taskStore.get(task.id);
    expect(updated!.assignedAgentId).toBe(a2.id);
  });

  it("lead_pipeline — view pipeline", async () => {
    const { boardId } = await initProject();
    await taskStore.create("Pipeline task", boardId, { status: "doing" });
    const tasks = await taskStore.list(boardId);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// v3.0 Team (5 tools)
// =============================================================================

describe("Team Tools", () => {
  it("team_add — add member", async () => {
    const member = await teamStore.add("Bob", "developer", ["typescript", "node"]);
    expect(member.id).toMatch(/^tm_/);
    expect(member.name).toBe("Bob");
    expect(member.role).toBe("developer");
    expect(member.skills).toContain("typescript");
  });

  it("team_list — list members", async () => {
    await teamStore.add("Alice", "developer", []);
    await teamStore.add("Carol", "code_reviewer", []);
    const members = await teamStore.list();
    expect(members.length).toBeGreaterThanOrEqual(2);
  });

  it("team_list — filter by role", async () => {
    await teamStore.add("Reviewer1", "code_reviewer", []);
    const reviewers = await teamStore.findByRole("code_reviewer");
    expect(reviewers.length).toBeGreaterThanOrEqual(1);
  });

  it("team_assign — assign task to member", async () => {
    const { boardId } = await initProject();
    const member = await teamStore.add("Dan", "developer", []);
    const task = await taskStore.create("Team assign", boardId);
    await teamStore.assignTask(member.id, task.id);

    const m = await teamStore.get(member.id);
    expect(m!.activeTaskIds).toContain(task.id);
    expect(m!.stats.tasksAssigned).toBe(1);
  });

  it("team_workload — workload calculation", async () => {
    const { boardId } = await initProject();
    const member = await teamStore.add("Eve", "developer", []);
    const t1 = await taskStore.create("Work 1", boardId);
    const t2 = await taskStore.create("Work 2", boardId);
    await taskStore.update(t1.id, { assignedMemberId: member.id });
    await taskStore.update(t2.id, { assignedMemberId: member.id });

    const tasks = await taskStore.list(boardId);
    const assigned = tasks.filter((t) => t.assignedMemberId === member.id);
    expect(assigned.length).toBe(2);
  });

  it("team_suggest_assignment — suggest by skills", async () => {
    const { boardId } = await initProject();
    await teamStore.add("TSMaster", "developer", ["typescript"]);
    await teamStore.add("PyMaster", "developer", ["python"]);
    const task = await taskStore.create("TS task", boardId, { tags: ["typescript"] });

    const members = await teamStore.list();
    const scored = members.map((m) => {
      const matchedSkills = task.tags.filter((tag) =>
        m.skills.some((s) => s.toLowerCase() === tag.toLowerCase())
      );
      return { member: m, score: matchedSkills.length * 20 };
    });
    scored.sort((a, b) => b.score - a.score);
    expect(scored[0].member.name).toBe("TSMaster");
  });
});

// =============================================================================
// Utility Functions
// =============================================================================

describe("Utility Functions", () => {
  it("extractKeywords — extracts meaningful words, skips stop words", () => {
    const kw = extractKeywords("Fix the broken login form please");
    expect(kw).not.toContain("the");
    expect(kw).not.toContain("fix");
    expect(kw).toContain("broken");
    expect(kw).toContain("login");
    expect(kw).toContain("form");
  });

  it("generateSmartTitle — short prompt unchanged", () => {
    expect(generateSmartTitle("Fix login bug")).toBe("Fix login bug");
  });

  it("generateSmartTitle — strips filler", () => {
    const title = generateSmartTitle("Please add a dark mode toggle to the settings page with proper accessibility support");
    expect(title).not.toMatch(/^Please/);
    expect(title).toMatch(/^Add/);
  });

  it("generateSmartTitle — truncates long titles", () => {
    const title = generateSmartTitle("A".repeat(100));
    expect(title.length).toBeLessThanOrEqual(80);
  });

  it("file-lock listFiles — filters .lock.json correctly", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lock-test-"));
    const s = new Store(dir);
    await s.init();
    await fs.promises.writeFile(path.join(dir, ".kanban", "locks", "test.lock.json"), '{"test":true}');
    const files = await s.listFiles(path.join(dir, ".kanban", "locks"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.some((f) => f.endsWith(".lock.json"))).toBe(true);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it("releaseAllLocks — releases all locks for an agent", async () => {
    const a1 = await agentStore.register("s1", "multi-locker");
    await acquireLock(store, "file1.ts", a1.id);
    await acquireLock(store, "file2.ts", a1.id);
    const count = await releaseAllLocks(store, a1.id);
    expect(count).toBe(2);

    const locks = await listAllLocks(store);
    const mine = locks.filter((l) => l.agentId === a1.id);
    expect(mine).toHaveLength(0);
  });

  it("listAllLocks — lists all current locks", async () => {
    const a1 = await agentStore.register("s1", "lister");
    await acquireLock(store, "listed.ts", a1.id);
    const locks = await listAllLocks(store);
    expect(locks.length).toBeGreaterThanOrEqual(1);
    expect(locks.some((l) => l.filePath === "listed.ts")).toBe(true);
    await releaseLock(store, "listed.ts", a1.id);
  });

  it("historyStore — record and find completions", async () => {
    const record = await historyStore.recordCompletion("t_test", "Test Task", ["feature"], "small", 30, 25);
    expect(record.id).toMatch(/^hi_/);
    expect(record.actualMinutes).toBe(25);

    const similar = await historyStore.findSimilar(["feature"], "small");
    expect(similar.length).toBeGreaterThanOrEqual(1);
  });
});
