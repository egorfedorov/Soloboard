export interface Session {
  id: string;
  projectId: string;
  activeTaskId: string | null;
  createdTasks: string[];
  completedTasks: string[];
  commits: string[];
  files: string[];
  startedAt: string;
  endedAt: string | null;
}

export function createSession(id: string, projectId: string): Session {
  return {
    id,
    projectId,
    activeTaskId: null,
    createdTasks: [],
    completedTasks: [],
    commits: [],
    files: [],
    startedAt: new Date().toISOString(),
    endedAt: null,
  };
}
