import { Store } from "./store.js";
import { ApprovalRequest, ApprovalStatus, createApprovalRequest } from "../models/approval.js";
import { generateApprovalId } from "../utils/id.js";

export class ApprovalStore {
  constructor(private store: Store) {}

  async create(action: string, description: string, requestedBy: string, taskId: string | null): Promise<ApprovalRequest> {
    const id = generateApprovalId();
    const approval = createApprovalRequest(id, action, description, requestedBy, taskId);
    await this.store.writeJson(this.store.approvalPath(id), approval);
    return approval;
  }

  async get(approvalId: string): Promise<ApprovalRequest | null> {
    return this.store.readJson<ApprovalRequest>(this.store.approvalPath(approvalId));
  }

  async update(approvalId: string, updates: Partial<Omit<ApprovalRequest, "id" | "createdAt">>): Promise<ApprovalRequest | null> {
    const approval = await this.get(approvalId);
    if (!approval) return null;
    const updated: ApprovalRequest = { ...approval, ...updates };
    await this.store.writeJson(this.store.approvalPath(approvalId), updated);
    return updated;
  }

  async list(): Promise<ApprovalRequest[]> {
    const files = await this.store.listFiles(this.store.approvalsDir);
    const approvals: ApprovalRequest[] = [];
    for (const file of files) {
      const a = await this.store.readJson<ApprovalRequest>(`${this.store.approvalsDir}/${file}`);
      if (a) approvals.push(a);
    }
    return approvals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listPending(): Promise<ApprovalRequest[]> {
    const all = await this.list();
    return all.filter((a) => a.status === "pending");
  }

  async resolve(approvalId: string, status: "approved" | "rejected", reason: string, resolvedBy: string): Promise<ApprovalRequest | null> {
    return this.update(approvalId, { status, reason, resolvedBy, resolvedAt: new Date().toISOString() });
  }
}
