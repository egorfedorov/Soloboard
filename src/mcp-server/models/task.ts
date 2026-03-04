export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "low" | "medium" | "high";

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
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export function createTask(
  id: string,
  title: string,
  projectId: string,
  opts?: Partial<Pick<Task, "description" | "priority" | "tags" | "branch" | "status">>
): Task {
  const now = new Date().toISOString();
  return {
    id,
    title,
    description: opts?.description ?? "",
    status: opts?.status ?? "todo",
    priority: opts?.priority ?? "medium",
    projectId,
    tags: opts?.tags ?? [],
    branch: opts?.branch ?? null,
    commits: [],
    pr: null,
    files: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}
