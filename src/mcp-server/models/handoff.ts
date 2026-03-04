export interface HandoffContextData {
  summary: string;
  decisions: string[];
  remainingWork: string[];
  filesModified: string[];
  notes: string;
}

export interface HandoffContext {
  id: string;
  fromAgent: string;
  toAgent: string | null;
  taskId: string;
  context: HandoffContextData;
  status: "pending" | "accepted" | "expired";
  createdAt: string;
  acceptedAt: string | null;
}

export function createHandoff(
  id: string,
  fromAgent: string,
  taskId: string,
  context: HandoffContextData
): HandoffContext {
  return {
    id,
    fromAgent,
    toAgent: null,
    taskId,
    context,
    status: "pending",
    createdAt: new Date().toISOString(),
    acceptedAt: null,
  };
}
