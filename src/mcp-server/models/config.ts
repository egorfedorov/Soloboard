export interface SyncConfig {
  enabled: boolean;
  token: string | null;
  project: string | null;
}

export interface RoleConfig {
  enabled: boolean;
  autoAssign: boolean;
}

export interface Config {
  activeProjectId: string | null;
  activeSessionId: string | null;
  kanbanDir: string;
  autoTrack: boolean;
  autoArchiveDays: number;
  // v1.5: Multi-agent
  multiAgentEnabled: boolean;
  maxParallelAgents: number;
  // v2.0: AI-native PM
  githubSync: SyncConfig;
  linearSync: SyncConfig;
  jiraSync: SyncConfig;
  // v3.0: Autonomous Dev Team
  teamMode: boolean;
  roles: Record<string, RoleConfig>;
  deployCommand: string | null;
  autoReview: boolean;
  autoQA: boolean;
  autoDeploy: boolean;
}

export const DEFAULT_CONFIG: Config = {
  activeProjectId: null,
  activeSessionId: null,
  kanbanDir: ".kanban",
  autoTrack: true,
  autoArchiveDays: 30,
  multiAgentEnabled: false,
  maxParallelAgents: 4,
  githubSync: { enabled: false, token: null, project: null },
  linearSync: { enabled: false, token: null, project: null },
  jiraSync: { enabled: false, token: null, project: null },
  teamMode: false,
  roles: {},
  deployCommand: null,
  autoReview: false,
  autoQA: false,
  autoDeploy: false,
};
