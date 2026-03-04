export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalRequest {
  id: string;
  action: string;
  description: string;
  requestedBy: string;
  taskId: string | null;
  status: ApprovalStatus;
  reason: string | null;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export function createApprovalRequest(
  id: string,
  action: string,
  description: string,
  requestedBy: string,
  taskId: string | null
): ApprovalRequest {
  return {
    id,
    action,
    description,
    requestedBy,
    taskId,
    status: "pending",
    reason: null,
    resolvedBy: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
}
