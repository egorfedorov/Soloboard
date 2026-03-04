import { Store } from "./store.js";
import { AgentRecord, createAgent } from "../models/agent.js";
import { generateAgentId } from "../utils/id.js";

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export class AgentStore {
  constructor(private store: Store) {}

  async register(sessionId: string, name: string): Promise<AgentRecord> {
    const id = generateAgentId();
    const agent = createAgent(id, sessionId, name);
    await this.store.writeJson(this.store.agentPath(id), agent);
    return agent;
  }

  async get(agentId: string): Promise<AgentRecord | null> {
    return this.store.readJson<AgentRecord>(this.store.agentPath(agentId));
  }

  async update(agentId: string, updates: Partial<Omit<AgentRecord, "id" | "registeredAt">>): Promise<AgentRecord | null> {
    const agent = await this.get(agentId);
    if (!agent) return null;
    const updated: AgentRecord = { ...agent, ...updates };
    await this.store.writeJson(this.store.agentPath(agentId), updated);
    return updated;
  }

  async heartbeat(agentId: string): Promise<AgentRecord | null> {
    return this.update(agentId, { lastHeartbeat: new Date().toISOString(), status: "active" });
  }

  async list(): Promise<AgentRecord[]> {
    const files = await this.store.listFiles(this.store.agentsDir);
    const agents: AgentRecord[] = [];
    for (const file of files) {
      const agent = await this.store.readJson<AgentRecord>(`${this.store.agentsDir}/${file}`);
      if (agent) agents.push(agent);
    }
    return agents;
  }

  async listActive(): Promise<AgentRecord[]> {
    const all = await this.list();
    return all.filter((a) => a.status === "active" || a.status === "idle");
  }

  async cleanupStale(): Promise<string[]> {
    const all = await this.list();
    const now = Date.now();
    const stale: string[] = [];
    for (const agent of all) {
      const elapsed = now - new Date(agent.lastHeartbeat).getTime();
      if (elapsed > STALE_THRESHOLD_MS && agent.status !== "disconnected") {
        await this.update(agent.id, { status: "disconnected" });
        stale.push(agent.id);
      }
    }
    return stale;
  }

  async delete(agentId: string): Promise<boolean> {
    return this.store.deleteFile(this.store.agentPath(agentId));
  }
}
