import { Store } from "./store.js";
import { TeamMember, createTeamMember } from "../models/team.js";
import { RoleName } from "../models/agent-role.js";
import { generateTeamMemberId } from "../utils/id.js";

export class TeamStore {
  constructor(private store: Store) {}

  async add(name: string, role: RoleName, skills: string[]): Promise<TeamMember> {
    const id = generateTeamMemberId();
    const member = createTeamMember(id, name, role, skills);
    await this.store.writeJson(this.store.teamMemberPath(id), member);
    return member;
  }

  async get(memberId: string): Promise<TeamMember | null> {
    return this.store.readJson<TeamMember>(this.store.teamMemberPath(memberId));
  }

  async update(memberId: string, updates: Partial<Omit<TeamMember, "id" | "createdAt">>): Promise<TeamMember | null> {
    const member = await this.get(memberId);
    if (!member) return null;
    const updated: TeamMember = { ...member, ...updates };
    await this.store.writeJson(this.store.teamMemberPath(memberId), updated);
    return updated;
  }

  async list(): Promise<TeamMember[]> {
    const files = await this.store.listFiles(this.store.teamDir);
    const members: TeamMember[] = [];
    for (const file of files) {
      const m = await this.store.readJson<TeamMember>(`${this.store.teamDir}/${file}`);
      if (m) members.push(m);
    }
    return members;
  }

  async findByRole(role: RoleName): Promise<TeamMember[]> {
    const all = await this.list();
    return all.filter((m) => m.role === role);
  }

  async findBySkill(skill: string): Promise<TeamMember[]> {
    const all = await this.list();
    return all.filter((m) => m.skills.some((s) => s.toLowerCase().includes(skill.toLowerCase())));
  }

  async assignTask(memberId: string, taskId: string): Promise<TeamMember | null> {
    const member = await this.get(memberId);
    if (!member) return null;
    if (!member.activeTaskIds.includes(taskId)) {
      member.activeTaskIds.push(taskId);
      member.stats.tasksAssigned++;
      await this.store.writeJson(this.store.teamMemberPath(memberId), member);
    }
    return member;
  }

  async completeTask(memberId: string, taskId: string, minutes: number): Promise<TeamMember | null> {
    const member = await this.get(memberId);
    if (!member) return null;
    member.activeTaskIds = member.activeTaskIds.filter((id) => id !== taskId);
    member.stats.tasksCompleted++;
    const total = member.stats.averageCompletionMinutes * (member.stats.tasksCompleted - 1) + minutes;
    member.stats.averageCompletionMinutes = Math.round(total / member.stats.tasksCompleted);
    await this.store.writeJson(this.store.teamMemberPath(memberId), member);
    return member;
  }

  async delete(memberId: string): Promise<boolean> {
    return this.store.deleteFile(this.store.teamMemberPath(memberId));
  }
}
