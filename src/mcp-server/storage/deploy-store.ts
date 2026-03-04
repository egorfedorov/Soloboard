import { Store } from "./store.js";
import { DeploymentRecord, DeployEnvironment, DeploymentStatus, createDeployment } from "../models/deployment.js";
import { generateDeploymentId } from "../utils/id.js";

export class DeployStore {
  constructor(private store: Store) {}

  async create(
    environment: DeployEnvironment,
    command: string,
    taskId: string | null,
    approvalId: string | null
  ): Promise<DeploymentRecord> {
    const id = generateDeploymentId();
    const deployment = createDeployment(id, environment, command, taskId, approvalId);
    await this.store.writeJson(this.store.deploymentPath(id), deployment);
    return deployment;
  }

  async get(deployId: string): Promise<DeploymentRecord | null> {
    return this.store.readJson<DeploymentRecord>(this.store.deploymentPath(deployId));
  }

  async update(deployId: string, updates: Partial<Omit<DeploymentRecord, "id" | "startedAt">>): Promise<DeploymentRecord | null> {
    const deployment = await this.get(deployId);
    if (!deployment) return null;
    const updated: DeploymentRecord = { ...deployment, ...updates };
    await this.store.writeJson(this.store.deploymentPath(deployId), updated);
    return updated;
  }

  async list(): Promise<DeploymentRecord[]> {
    const files = await this.store.listFiles(this.store.deploymentsDir);
    const deployments: DeploymentRecord[] = [];
    for (const file of files) {
      const d = await this.store.readJson<DeploymentRecord>(`${this.store.deploymentsDir}/${file}`);
      if (d) deployments.push(d);
    }
    return deployments.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async getLatest(environment?: DeployEnvironment): Promise<DeploymentRecord | null> {
    const all = await this.list();
    if (environment) {
      return all.find((d) => d.environment === environment) ?? null;
    }
    return all[0] ?? null;
  }
}
