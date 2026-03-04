export type DeploymentStatus = "pending" | "running" | "success" | "failed" | "rolled_back";
export type DeployEnvironment = "staging" | "production" | "preview";

export interface DeploymentRecord {
  id: string;
  taskId: string | null;
  environment: DeployEnvironment;
  status: DeploymentStatus;
  command: string;
  output: string;
  approvalId: string | null;
  startedAt: string;
  completedAt: string | null;
}

export function createDeployment(
  id: string,
  environment: DeployEnvironment,
  command: string,
  taskId: string | null,
  approvalId: string | null
): DeploymentRecord {
  return {
    id,
    taskId,
    environment,
    status: "pending",
    command,
    output: "",
    approvalId,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
}
