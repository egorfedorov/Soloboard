import { Store } from "./store.js";
import { QAResult, TestFailure, createQAResult } from "../models/qa.js";
import { generateQAId } from "../utils/id.js";

export class QAStore {
  constructor(private store: Store) {}

  async create(
    taskId: string,
    passed: number,
    failed: number,
    skipped: number,
    failures: TestFailure[],
    command: string,
    output: string
  ): Promise<QAResult> {
    const id = generateQAId();
    const result = createQAResult(id, taskId, passed, failed, skipped, failures, command, output);
    await this.store.writeJson(this.store.qaPath(id), result);
    return result;
  }

  async get(qaId: string): Promise<QAResult | null> {
    return this.store.readJson<QAResult>(this.store.qaPath(qaId));
  }

  async update(qaId: string, updates: Partial<Omit<QAResult, "id" | "ranAt">>): Promise<QAResult | null> {
    const result = await this.get(qaId);
    if (!result) return null;
    const updated: QAResult = { ...result, ...updates };
    await this.store.writeJson(this.store.qaPath(qaId), updated);
    return updated;
  }

  async list(): Promise<QAResult[]> {
    const files = await this.store.listFiles(this.store.qaDir);
    const results: QAResult[] = [];
    for (const file of files) {
      const r = await this.store.readJson<QAResult>(`${this.store.qaDir}/${file}`);
      if (r) results.push(r);
    }
    return results.sort((a, b) => b.ranAt.localeCompare(a.ranAt));
  }

  async findByTask(taskId: string): Promise<QAResult[]> {
    const all = await this.list();
    return all.filter((r) => r.taskId === taskId);
  }

  async getLatest(taskId: string): Promise<QAResult | null> {
    const results = await this.findByTask(taskId);
    return results[0] ?? null;
  }
}
