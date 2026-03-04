import fs from "node:fs";
import path from "node:path";
import { Config, DEFAULT_CONFIG } from "../models/config.js";

export class Store {
  private baseDir: string;

  constructor(projectRoot: string) {
    this.baseDir = path.join(projectRoot, ".kanban");
  }

  get root(): string {
    return this.baseDir;
  }

  async init(): Promise<void> {
    const dirs = ["boards", "tasks", "archive", "sessions"];
    for (const dir of dirs) {
      await fs.promises.mkdir(path.join(this.baseDir, dir), { recursive: true });
    }
    const configPath = path.join(this.baseDir, "config.json");
    if (!fs.existsSync(configPath)) {
      await this.writeJson(configPath, DEFAULT_CONFIG);
    }
  }

  async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const data = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async writeJson<T>(filePath: string, data: T): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmpPath = filePath + ".tmp";
    await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.promises.rename(tmpPath, filePath);
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      await fs.promises.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(dir: string): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(dir);
      return entries.filter((e) => e.endsWith(".json"));
    } catch {
      return [];
    }
  }

  async getConfig(): Promise<Config> {
    const config = await this.readJson<Config>(path.join(this.baseDir, "config.json"));
    return config ?? { ...DEFAULT_CONFIG };
  }

  async saveConfig(config: Config): Promise<void> {
    await this.writeJson(path.join(this.baseDir, "config.json"), config);
  }

  taskPath(taskId: string): string {
    return path.join(this.baseDir, "tasks", `${taskId}.json`);
  }

  archivePath(taskId: string): string {
    return path.join(this.baseDir, "archive", `${taskId}.json`);
  }

  boardPath(boardId: string): string {
    return path.join(this.baseDir, "boards", `${boardId}.json`);
  }

  sessionPath(sessionId: string): string {
    return path.join(this.baseDir, "sessions", `${sessionId}.json`);
  }

  get tasksDir(): string {
    return path.join(this.baseDir, "tasks");
  }

  get archiveDir(): string {
    return path.join(this.baseDir, "archive");
  }

  get boardsDir(): string {
    return path.join(this.baseDir, "boards");
  }

  get sessionsDir(): string {
    return path.join(this.baseDir, "sessions");
  }
}
