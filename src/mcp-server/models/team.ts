import { RoleName } from "./agent-role.js";

export interface TeamMemberStats {
  tasksCompleted: number;
  tasksAssigned: number;
  averageCompletionMinutes: number;
}

export interface TeamMember {
  id: string;
  name: string;
  role: RoleName;
  skills: string[];
  activeTaskIds: string[];
  stats: TeamMemberStats;
  createdAt: string;
}

export function createTeamMember(
  id: string,
  name: string,
  role: RoleName,
  skills: string[]
): TeamMember {
  return {
    id,
    name,
    role,
    skills,
    activeTaskIds: [],
    stats: { tasksCompleted: 0, tasksAssigned: 0, averageCompletionMinutes: 0 },
    createdAt: new Date().toISOString(),
  };
}
