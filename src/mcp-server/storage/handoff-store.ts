import { Store } from "./store.js";
import { HandoffContext, HandoffContextData, createHandoff } from "../models/handoff.js";
import { generateHandoffId } from "../utils/id.js";

export class HandoffStore {
  constructor(private store: Store) {}

  async create(fromAgent: string, taskId: string, context: HandoffContextData): Promise<HandoffContext> {
    const id = generateHandoffId();
    const handoff = createHandoff(id, fromAgent, taskId, context);
    await this.store.writeJson(this.store.handoffPath(id), handoff);
    return handoff;
  }

  async get(handoffId: string): Promise<HandoffContext | null> {
    return this.store.readJson<HandoffContext>(this.store.handoffPath(handoffId));
  }

  async update(handoffId: string, updates: Partial<Omit<HandoffContext, "id" | "createdAt">>): Promise<HandoffContext | null> {
    const handoff = await this.get(handoffId);
    if (!handoff) return null;
    const updated: HandoffContext = { ...handoff, ...updates };
    await this.store.writeJson(this.store.handoffPath(handoffId), updated);
    return updated;
  }

  async list(): Promise<HandoffContext[]> {
    const files = await this.store.listFiles(this.store.handoffsDir);
    const handoffs: HandoffContext[] = [];
    for (const file of files) {
      const h = await this.store.readJson<HandoffContext>(`${this.store.handoffsDir}/${file}`);
      if (h) handoffs.push(h);
    }
    return handoffs;
  }

  async listPending(): Promise<HandoffContext[]> {
    const all = await this.list();
    return all.filter((h) => h.status === "pending");
  }

  async findByTask(taskId: string): Promise<HandoffContext[]> {
    const all = await this.list();
    return all.filter((h) => h.taskId === taskId);
  }

  async accept(handoffId: string, toAgent: string): Promise<HandoffContext | null> {
    return this.update(handoffId, {
      toAgent,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });
  }
}
