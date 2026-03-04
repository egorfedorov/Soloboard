import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { ApprovalStore } from "../storage/approval-store.js";

export function registerApprovalTools(
  server: McpServer,
  store: Store,
  approvalStore: ApprovalStore
) {
  // 1. approval_request
  server.tool(
    "approval_request",
    "Create an approval request for human review",
    {
      action: z.string().describe("Action requiring approval (e.g., 'deploy_production', 'delete_data')"),
      description: z.string().describe("Detailed description of what will happen"),
      requestedBy: z.string().describe("Who is requesting (agent name or ID)"),
      taskId: z.string().optional().describe("Related task ID"),
    },
    async ({ action, description, requestedBy, taskId }) => {
      const approval = await approvalStore.create(action, description, requestedBy, taskId ?? null);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, approvalId: approval.id, status: approval.status }) }] };
    }
  );

  // 2. approval_list
  server.tool(
    "approval_list",
    "List pending approval requests",
    {
      all: z.boolean().optional().describe("Show all approvals, not just pending"),
    },
    async ({ all }) => {
      const approvals = all ? await approvalStore.list() : await approvalStore.listPending();
      const summary = approvals.map((a) => ({
        id: a.id,
        action: a.action,
        description: a.description,
        requestedBy: a.requestedBy,
        taskId: a.taskId,
        status: a.status,
        createdAt: a.createdAt,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, count: summary.length, approvals: summary }) }] };
    }
  );

  // 3. approval_resolve
  server.tool(
    "approval_resolve",
    "Approve or reject a pending approval request",
    {
      approvalId: z.string().describe("Approval ID to resolve"),
      status: z.enum(["approved", "rejected"]).describe("Decision"),
      reason: z.string().describe("Reason for decision"),
      resolvedBy: z.string().optional().describe("Who resolved (default: user)"),
    },
    async ({ approvalId, status, reason, resolvedBy }) => {
      const approval = await approvalStore.resolve(approvalId, status, reason, resolvedBy ?? "user");
      if (!approval) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Approval not found" }) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, id: approval.id, status: approval.status, reason: approval.reason }) }] };
    }
  );
}
