export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "low" | "medium" | "high";

// v2.0
export type TaskComplexity = "trivial" | "small" | "medium" | "large" | "epic";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ExternalLink {
  provider: "github" | "linear" | "jira";
  externalId: string;
  url: string;
  syncDirection: "push" | "pull" | "bidirectional";
  lastSyncedAt: string | null;
}

// v3.0
export type ReviewStatus = "pending" | "in_review" | "approved" | "changes_requested";
export type QAStatus = "pending" | "running" | "passed" | "failed";

export interface TimeEntry {
  start: string;
  end: string | null;
}

export interface TaskContext {
  filesViewed: string[];
  decisions: string[];
  remainingWork: string[];
  lastAction: string;
  suggestedApproach: string[];
  relatedFiles: string[];
  savedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string;
  tags: string[];
  branch: string | null;
  commits: string[];
  pr: string | null;
  files: string[];
  timeLog: TimeEntry[];
  totalSeconds: number;
  context: TaskContext | null;
  agentFile: string | null;
  // v1.3: Subtasks
  parentId: string | null;
  subtaskIds: string[];
  // v1.3: Dependencies
  blockedBy: string[];
  blocks: string[];
  // v1.3: Sprints
  sprintId: string | null;
  estimatedMinutes: number | null;
  // v1.5: Multi-agent
  assignedAgentId: string | null;
  // v2.0: AI-native PM
  externalLinks: ExternalLink[];
  predictedMinutes: number | null;
  complexity: TaskComplexity | null;
  riskLevel: RiskLevel | null;
  // v3.0: Autonomous Dev Team
  assignedMemberId: string | null;
  reviewStatus: ReviewStatus | null;
  qaStatus: QAStatus | null;
  deploymentId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

export function comparePriority(a: Task, b: Task): number {
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export function createTask(
  id: string,
  title: string,
  projectId: string,
  opts?: Partial<Pick<Task, "description" | "priority" | "tags" | "branch" | "status">>
): Task {
  const now = new Date().toISOString();
  const status = opts?.status ?? "todo";
  return {
    id,
    title,
    description: opts?.description ?? "",
    status,
    priority: opts?.priority ?? "medium",
    projectId,
    tags: opts?.tags ?? [],
    branch: opts?.branch ?? null,
    commits: [],
    pr: null,
    files: [],
    timeLog: status === "doing" ? [{ start: now, end: null }] : [],
    totalSeconds: 0,
    context: null,
    agentFile: null,
    parentId: null,
    subtaskIds: [],
    blockedBy: [],
    blocks: [],
    sprintId: null,
    estimatedMinutes: null,
    assignedAgentId: null,
    externalLinks: [],
    predictedMinutes: null,
    complexity: null,
    riskLevel: null,
    assignedMemberId: null,
    reviewStatus: null,
    qaStatus: null,
    deploymentId: null,
    createdAt: now,
    updatedAt: now,
    completedAt: status === "done" ? now : null,
  };
}
