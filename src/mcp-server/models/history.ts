export interface CompletionRecord {
  id: string;
  taskId: string;
  title: string;
  tags: string[];
  complexity: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number;
  completedAt: string;
}

export interface VelocitySnapshot {
  id: string;
  date: string;
  tasksCompleted: number;
  totalMinutes: number;
  averageMinutes: number;
  projectId: string;
}

export function createCompletionRecord(
  id: string,
  taskId: string,
  title: string,
  tags: string[],
  complexity: string | null,
  estimatedMinutes: number | null,
  actualMinutes: number
): CompletionRecord {
  return {
    id,
    taskId,
    title,
    tags,
    complexity,
    estimatedMinutes,
    actualMinutes,
    completedAt: new Date().toISOString(),
  };
}
