import { Store } from "./store.js";
import { Sprint, SprintStatus, createSprint } from "../models/sprint.js";
import { generateSprintId } from "../utils/id.js";

export class SprintStore {
  constructor(private store: Store) {}

  async create(name: string, projectId: string, durationDays?: number): Promise<Sprint> {
    const id = generateSprintId();
    const sprint = createSprint(id, name, projectId, durationDays);
    await this.store.writeJson(this.store.sprintPath(id), sprint);
    return sprint;
  }

  async get(sprintId: string): Promise<Sprint | null> {
    return this.store.readJson<Sprint>(this.store.sprintPath(sprintId));
  }

  async update(sprintId: string, updates: Partial<Omit<Sprint, "id" | "createdAt">>): Promise<Sprint | null> {
    const sprint = await this.get(sprintId);
    if (!sprint) return null;
    const updated: Sprint = {
      ...sprint,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeJson(this.store.sprintPath(sprintId), updated);
    return updated;
  }

  async list(projectId?: string): Promise<Sprint[]> {
    const files = await this.store.listFiles(this.store.sprintsDir);
    const sprints: Sprint[] = [];
    for (const file of files) {
      const sprint = await this.store.readJson<Sprint>(`${this.store.sprintsDir}/${file}`);
      if (sprint && (!projectId || sprint.projectId === projectId)) {
        sprints.push(sprint);
      }
    }
    return sprints;
  }

  async getActive(projectId: string): Promise<Sprint | null> {
    const sprints = await this.list(projectId);
    return sprints.find((s) => s.status === "active") ?? null;
  }

  async addTask(sprintId: string, taskId: string): Promise<Sprint | null> {
    const sprint = await this.get(sprintId);
    if (!sprint) return null;
    if (!sprint.taskIds.includes(taskId)) {
      sprint.taskIds.push(taskId);
      sprint.updatedAt = new Date().toISOString();
      await this.store.writeJson(this.store.sprintPath(sprintId), sprint);
    }
    return sprint;
  }

  async removeTask(sprintId: string, taskId: string): Promise<Sprint | null> {
    const sprint = await this.get(sprintId);
    if (!sprint) return null;
    sprint.taskIds = sprint.taskIds.filter((id) => id !== taskId);
    sprint.updatedAt = new Date().toISOString();
    await this.store.writeJson(this.store.sprintPath(sprintId), sprint);
    return sprint;
  }

  async findByName(name: string, projectId?: string): Promise<Sprint | null> {
    const sprints = await this.list(projectId);
    const lower = name.toLowerCase();
    return sprints.find((s) => s.name.toLowerCase() === lower) ??
      sprints.find((s) => s.name.toLowerCase().includes(lower)) ?? null;
  }
}
