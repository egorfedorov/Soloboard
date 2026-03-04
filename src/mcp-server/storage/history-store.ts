import { Store } from "./store.js";
import { CompletionRecord, VelocitySnapshot, createCompletionRecord } from "../models/history.js";
import { generateHistoryId, generateVelocityId } from "../utils/id.js";

export class HistoryStore {
  constructor(private store: Store) {}

  async recordCompletion(
    taskId: string,
    title: string,
    tags: string[],
    complexity: string | null,
    estimatedMinutes: number | null,
    actualMinutes: number
  ): Promise<CompletionRecord> {
    const id = generateHistoryId();
    const record = createCompletionRecord(id, taskId, title, tags, complexity, estimatedMinutes, actualMinutes);
    await this.store.writeJson(this.store.historyPath(id), record);
    return record;
  }

  async listCompletions(): Promise<CompletionRecord[]> {
    const files = await this.store.listFiles(this.store.historyDir);
    const records: CompletionRecord[] = [];
    for (const file of files) {
      const r = await this.store.readJson<CompletionRecord>(`${this.store.historyDir}/${file}`);
      if (r) records.push(r);
    }
    return records.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  }

  async findSimilar(tags: string[], complexity: string | null): Promise<CompletionRecord[]> {
    const all = await this.listCompletions();
    return all.filter((r) => {
      const tagOverlap = r.tags.some((t) => tags.includes(t));
      const complexityMatch = complexity ? r.complexity === complexity : true;
      return tagOverlap || complexityMatch;
    });
  }

  async recordVelocity(projectId: string): Promise<VelocitySnapshot> {
    const id = generateVelocityId();
    const today = new Date().toISOString().slice(0, 10);
    const completions = await this.listCompletions();
    const todayCompletions = completions.filter((c) => c.completedAt.startsWith(today));
    const totalMinutes = todayCompletions.reduce((sum, c) => sum + c.actualMinutes, 0);

    const snapshot: VelocitySnapshot = {
      id,
      date: today,
      tasksCompleted: todayCompletions.length,
      totalMinutes,
      averageMinutes: todayCompletions.length > 0 ? Math.round(totalMinutes / todayCompletions.length) : 0,
      projectId,
    };
    await this.store.writeJson(this.store.velocityPath(id), snapshot);
    return snapshot;
  }

  async listVelocity(projectId?: string): Promise<VelocitySnapshot[]> {
    const files = await this.store.listFiles(this.store.velocityDir);
    const snapshots: VelocitySnapshot[] = [];
    for (const file of files) {
      const s = await this.store.readJson<VelocitySnapshot>(`${this.store.velocityDir}/${file}`);
      if (s && (!projectId || s.projectId === projectId)) snapshots.push(s);
    }
    return snapshots.sort((a, b) => a.date.localeCompare(b.date));
  }
}
