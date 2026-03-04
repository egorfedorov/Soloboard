import { nanoid } from "nanoid";

export function generateId(prefix?: string): string {
  const id = nanoid(12);
  return prefix ? `${prefix}_${id}` : id;
}

export function generateTaskId(): string {
  return generateId("t");
}

export function generateBoardId(): string {
  return generateId("b");
}

export function generateSessionId(): string {
  return generateId("s");
}

export function generateSprintId(): string {
  return generateId("sp");
}

// v1.5: Multi-agent
export function generateAgentId(): string {
  return generateId("ag");
}

export function generateHandoffId(): string {
  return generateId("ho");
}

// v2.0: AI-native PM
export function generateHistoryId(): string {
  return generateId("hi");
}

export function generateVelocityId(): string {
  return generateId("ve");
}

// v3.0: Autonomous Dev Team
export function generateApprovalId(): string {
  return generateId("ap");
}

export function generateReviewId(): string {
  return generateId("cr");
}

export function generateQAId(): string {
  return generateId("qa");
}

export function generateDeploymentId(): string {
  return generateId("dp");
}

export function generateTeamMemberId(): string {
  return generateId("tm");
}
