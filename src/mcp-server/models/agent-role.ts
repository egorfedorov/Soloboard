export type RoleName = "tech_lead" | "code_reviewer" | "qa_agent" | "devops_agent" | "developer";

export interface RoleConfig {
  name: RoleName;
  description: string;
  capabilities: string[];
  autoAssignable: boolean;
}

export const DEFAULT_ROLES: Record<RoleName, RoleConfig> = {
  tech_lead: {
    name: "tech_lead",
    description: "Distributes work, manages pipeline, reviews architecture",
    capabilities: ["distribute", "reassign", "pipeline", "review"],
    autoAssignable: false,
  },
  code_reviewer: {
    name: "code_reviewer",
    description: "Reviews code changes for quality and correctness",
    capabilities: ["review", "findings", "respond"],
    autoAssignable: true,
  },
  qa_agent: {
    name: "qa_agent",
    description: "Runs tests, reports failures, verifies fixes",
    capabilities: ["test", "coverage", "report"],
    autoAssignable: true,
  },
  devops_agent: {
    name: "devops_agent",
    description: "Manages deployments and infrastructure",
    capabilities: ["deploy", "check", "monitor"],
    autoAssignable: true,
  },
  developer: {
    name: "developer",
    description: "Implements features and fixes bugs",
    capabilities: ["code", "test", "debug"],
    autoAssignable: true,
  },
};
