import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Store } from "./storage/store.js";
import { TaskStore } from "./storage/task-store.js";
import { BoardStore } from "./storage/board-store.js";
import { SessionStore } from "./storage/session-store.js";
import { SprintStore } from "./storage/sprint-store.js";
// v1.5
import { AgentStore } from "./storage/agent-store.js";
import { HandoffStore } from "./storage/handoff-store.js";
// v2.0
import { HistoryStore } from "./storage/history-store.js";
// v3.0
import { ApprovalStore } from "./storage/approval-store.js";
import { ReviewStore } from "./storage/review-store.js";
import { QAStore } from "./storage/qa-store.js";
import { DeployStore } from "./storage/deploy-store.js";
import { TeamStore } from "./storage/team-store.js";

// v1.0 tools
import { registerTaskTools } from "./tools/task-tools.js";
import { registerBoardTools } from "./tools/board-tools.js";
import { registerSessionTools } from "./tools/session-tools.js";
import { registerGitTools } from "./tools/git-tools.js";
import { registerInitTools } from "./tools/init-tools.js";
import { registerExportTools } from "./tools/export-tools.js";
// v1.2 tools
import { registerContextTools } from "./tools/context-tools.js";
import { registerSmartTools } from "./tools/smart-tools.js";
import { registerAgentTools } from "./tools/agent-tools.js";
import { registerReviewTools } from "./tools/review-tools.js";
// v1.3 tools
import { registerDependencyTools } from "./tools/dependency-tools.js";
import { registerSubtaskTools } from "./tools/subtask-tools.js";
import { registerSprintTools } from "./tools/sprint-tools.js";
import { registerStandupTools } from "./tools/standup-tools.js";
// v1.4 tools
import { registerManagerTools } from "./tools/manager-tools.js";
// v1.5 tools
import { registerOrchestrationTools } from "./tools/orchestration-tools.js";
// v2.0 tools
import { registerPlanningTools } from "./tools/planning-tools.js";
import { registerPredictionTools } from "./tools/prediction-tools.js";
import { registerRiskTools } from "./tools/risk-tools.js";
import { registerSyncTools } from "./tools/sync-tools.js";
import { registerPRTools } from "./tools/pr-tools.js";
// v3.0 tools
import { registerApprovalTools } from "./tools/approval-tools.js";
import { registerCodeReviewTools } from "./tools/code-review-tools.js";
import { registerQATools } from "./tools/qa-tools.js";
import { registerDevopsTools } from "./tools/devops-tools.js";
import { registerTechLeadTools } from "./tools/tech-lead-tools.js";
import { registerTeamTools } from "./tools/team-tools.js";

export function createSoloboardServer(projectRoot: string): McpServer {
  const server = new McpServer({
    name: "soloboard",
    version: "3.0.1",
  });

  // Core stores
  const store = new Store(projectRoot);
  const taskStore = new TaskStore(store);
  const boardStore = new BoardStore(store);
  const sessionStore = new SessionStore(store);
  const sprintStore = new SprintStore(store);

  // v1.5 stores
  const agentStore = new AgentStore(store);
  const handoffStore = new HandoffStore(store);

  // v2.0 stores
  const historyStore = new HistoryStore(store);

  // v3.0 stores
  const approvalStore = new ApprovalStore(store);
  const reviewStore = new ReviewStore(store);
  const qaStore = new QAStore(store);
  const deployStore = new DeployStore(store);
  const teamStore = new TeamStore(store);

  // v1.0: Core (12 tools)
  registerTaskTools(server, store, taskStore, boardStore, sessionStore, historyStore);
  registerBoardTools(server, store, taskStore, boardStore);
  registerSessionTools(server, store, sessionStore, taskStore);
  registerGitTools(server, store, taskStore, boardStore, projectRoot);
  registerInitTools(server, store, boardStore, sessionStore, projectRoot);
  registerExportTools(server, store, taskStore, boardStore);

  // v1.2: Intelligence (5 tools)
  registerContextTools(server, store, taskStore);
  registerSmartTools(server, store, taskStore, boardStore, sessionStore, projectRoot);
  registerAgentTools(server, store, taskStore, projectRoot);
  registerReviewTools(server, store, taskStore, boardStore, projectRoot);

  // v1.3: Dependencies & Structure (10 tools)
  registerDependencyTools(server, store, taskStore, boardStore);
  registerSubtaskTools(server, store, taskStore, boardStore, sessionStore);
  registerSprintTools(server, store, taskStore, sprintStore);
  registerStandupTools(server, store, taskStore, boardStore, sprintStore);

  // v1.4: Auto-Manager (5 tools)
  registerManagerTools(server, store, taskStore, boardStore, sprintStore);

  // v1.5: Multi-Agent Orchestration (10 tools)
  registerOrchestrationTools(server, store, taskStore, agentStore, handoffStore);

  // v2.0: AI-native PM (18 tools)
  registerPlanningTools(server, store, taskStore, boardStore, sprintStore);
  registerPredictionTools(server, store, taskStore, historyStore, sprintStore);
  registerRiskTools(server, store, taskStore, projectRoot);
  registerSyncTools(server, store, taskStore);
  registerPRTools(server, store, taskStore, projectRoot);

  // v3.0: Autonomous Dev Team (22 tools)
  registerApprovalTools(server, store, approvalStore);
  registerCodeReviewTools(server, store, taskStore, reviewStore, projectRoot);
  registerQATools(server, store, taskStore, boardStore, qaStore, projectRoot);
  registerDevopsTools(server, store, taskStore, deployStore, approvalStore, reviewStore, qaStore, projectRoot);
  registerTechLeadTools(server, store, taskStore, agentStore, handoffStore, reviewStore, qaStore, deployStore, teamStore);
  registerTeamTools(server, store, taskStore, teamStore);

  return server;
}
