import { Store } from "./store.js";
import { Session, createSession } from "../models/session.js";
import { generateSessionId } from "../utils/id.js";

export class SessionStore {
  constructor(private store: Store) {}

  async create(projectId: string): Promise<Session> {
    const id = generateSessionId();
    const session = createSession(id, projectId);
    await this.store.writeJson(this.store.sessionPath(id), session);
    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    return this.store.readJson<Session>(this.store.sessionPath(sessionId));
  }

  async update(sessionId: string, updates: Partial<Omit<Session, "id" | "startedAt">>): Promise<Session | null> {
    const session = await this.get(sessionId);
    if (!session) return null;
    const updated: Session = { ...session, ...updates };
    await this.store.writeJson(this.store.sessionPath(sessionId), updated);
    return updated;
  }

  async end(sessionId: string): Promise<Session | null> {
    return this.update(sessionId, { endedAt: new Date().toISOString() });
  }

  async addCreatedTask(sessionId: string, taskId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    if (!session.createdTasks.includes(taskId)) {
      session.createdTasks.push(taskId);
      await this.store.writeJson(this.store.sessionPath(sessionId), session);
    }
  }

  async addCompletedTask(sessionId: string, taskId: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    if (!session.completedTasks.includes(taskId)) {
      session.completedTasks.push(taskId);
      await this.store.writeJson(this.store.sessionPath(sessionId), session);
    }
  }

  async addCommit(sessionId: string, sha: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    if (!session.commits.includes(sha)) {
      session.commits.push(sha);
      await this.store.writeJson(this.store.sessionPath(sessionId), session);
    }
  }

  async addFile(sessionId: string, filePath: string): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) return;
    if (!session.files.includes(filePath)) {
      session.files.push(filePath);
      await this.store.writeJson(this.store.sessionPath(sessionId), session);
    }
  }

  async setActiveTask(sessionId: string, taskId: string | null): Promise<void> {
    await this.update(sessionId, { activeTaskId: taskId });
  }
}
