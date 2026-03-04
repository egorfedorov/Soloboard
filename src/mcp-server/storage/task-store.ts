import { Store } from "./store.js";
import { Task, createTask, TaskStatus, TaskPriority } from "../models/task.js";
import { generateTaskId } from "../utils/id.js";

export class TaskStore {
  constructor(private store: Store) {}

  async create(
    title: string,
    projectId: string,
    opts?: { description?: string; priority?: TaskPriority; tags?: string[]; branch?: string; status?: TaskStatus }
  ): Promise<Task> {
    const id = generateTaskId();
    const task = createTask(id, title, projectId, opts);
    await this.store.writeJson(this.store.taskPath(id), task);
    return task;
  }

  async get(taskId: string): Promise<Task | null> {
    return this.store.readJson<Task>(this.store.taskPath(taskId));
  }

  async update(taskId: string, updates: Partial<Omit<Task, "id" | "createdAt">>): Promise<Task | null> {
    const task = await this.get(taskId);
    if (!task) return null;

    const updated: Task = {
      ...task,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (updates.status === "done" && task.status !== "done") {
      updated.completedAt = new Date().toISOString();
    }

    await this.store.writeJson(this.store.taskPath(taskId), updated);
    return updated;
  }

  async delete(taskId: string): Promise<boolean> {
    return this.store.deleteFile(this.store.taskPath(taskId));
  }

  async list(projectId?: string): Promise<Task[]> {
    const files = await this.store.listFiles(this.store.tasksDir);
    const tasks: Task[] = [];
    for (const file of files) {
      const task = await this.store.readJson<Task>(
        `${this.store.tasksDir}/${file}`
      );
      if (task && (!projectId || task.projectId === projectId)) {
        tasks.push(task);
      }
    }
    return tasks;
  }

  async archive(taskId: string): Promise<boolean> {
    const task = await this.get(taskId);
    if (!task) return false;
    await this.store.writeJson(this.store.archivePath(taskId), task);
    await this.store.deleteFile(this.store.taskPath(taskId));
    return true;
  }

  async findByTitle(query: string, projectId?: string): Promise<Task | null> {
    const tasks = await this.list(projectId);
    const lower = query.toLowerCase();
    return (
      tasks.find((t) => t.title.toLowerCase() === lower) ??
      tasks.find((t) => t.title.toLowerCase().includes(lower)) ??
      null
    );
  }

  async resolve(idOrQuery: string, projectId?: string): Promise<Task | null> {
    // Try exact ID first
    const byId = await this.get(idOrQuery);
    if (byId) return byId;
    // Try fuzzy title match
    return this.findByTitle(idOrQuery, projectId);
  }

  async addFile(taskId: string, filePath: string): Promise<Task | null> {
    const task = await this.get(taskId);
    if (!task) return null;
    if (!task.files.includes(filePath)) {
      task.files.push(filePath);
      task.updatedAt = new Date().toISOString();
      await this.store.writeJson(this.store.taskPath(taskId), task);
    }
    return task;
  }

  async addCommit(taskId: string, sha: string): Promise<Task | null> {
    const task = await this.get(taskId);
    if (!task) return null;
    if (!task.commits.includes(sha)) {
      task.commits.push(sha);
      task.updatedAt = new Date().toISOString();
      await this.store.writeJson(this.store.taskPath(taskId), task);
    }
    return task;
  }
}
