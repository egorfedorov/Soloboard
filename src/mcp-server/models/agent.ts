export type AgentStatus = "active" | "idle" | "disconnected";

export interface AgentMetrics {
  tasksCompleted: number;
  filesModified: number;
  totalActiveSeconds: number;
}

export interface AgentRecord {
  id: string;
  sessionId: string;
  name: string;
  activeTaskId: string | null;
  lockedFiles: string[];
  status: AgentStatus;
  metrics: AgentMetrics;
  lastHeartbeat: string;
  registeredAt: string;
}

export function createAgent(
  id: string,
  sessionId: string,
  name: string
): AgentRecord {
  const now = new Date().toISOString();
  return {
    id,
    sessionId,
    name,
    activeTaskId: null,
    lockedFiles: [],
    status: "active",
    metrics: { tasksCompleted: 0, filesModified: 0, totalActiveSeconds: 0 },
    lastHeartbeat: now,
    registeredAt: now,
  };
}
