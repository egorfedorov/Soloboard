export interface Config {
  activeProjectId: string | null;
  activeSessionId: string | null;
  kanbanDir: string;
  autoTrack: boolean;
  autoArchiveDays: number;
}

export const DEFAULT_CONFIG: Config = {
  activeProjectId: null,
  activeSessionId: null,
  kanbanDir: ".kanban",
  autoTrack: true,
  autoArchiveDays: 30,
};
