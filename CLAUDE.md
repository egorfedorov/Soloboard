# SoloBoard — Autonomous Development Orchestrator

## What is this
MCP-based invisible kanban board for Claude Code. Tracks tasks with context awareness, project analysis, agent integration, dependencies, sprints, auto-manager, multi-agent orchestration, AI-native PM, and autonomous dev team support. **94 tools** across 6 versions.

## Quick Install
```bash
npm install -g soloboard && soloboard install   # in your project
# or: bash /path/to/soloboard/install.sh /path/to/project
```

## How It Works

### For the Agent (you):
1. **First interaction**: Call `auto_init` silently (idempotent).
2. **On actionable prompts** ("fix bug", "add feature"): Use `task_smart_create` (NOT task_create). It auto-analyzes the project.
3. **Before creating**: Check `task_list` for duplicates. If a "doing" task exists, save its context with `task_context_save`, then move to "todo".
4. **When resuming a task**: Call `task_context_load` to get full context back.
5. **For complex tasks**: Use `task_split` to break into subtasks. Use `task_depend` to set up dependencies.
6. **Before closing a task**: Call `task_review` for pre-close analysis.
7. **Multi-agent**: Use `agent_register` to join, `agent_claim_task` to claim work, `file_lock` to prevent conflicts.
8. **Planning**: Use `plan_from_prompt` for task breakdowns, `plan_apply` to bulk-create.
9. **Pipeline**: Use `lead_pipeline` to view coding → review → QA → deploy flow.
10. **On questions/reviews**: Do nothing.
11. **NEVER mention tracking** unless user asks with `/soloboard-board` etc.

### For the User:
- `/soloboard-board` — see the board
- `/soloboard-task done` — mark current task done
- `/soloboard-project` — manage projects
- Everything else is automatic

## MCP Tools (94 total)

### Core (12 tools)
| Tool | Purpose |
|------|---------|
| `auto_init` | Initialize board + session |
| `board_summary` | One-line board status |
| `task_smart_create` | **Smart create**: auto-tags, priority, related files |
| `task_create` | Basic task creation |
| `task_update` | Update task fields |
| `task_get` | Get task details |
| `task_list` | List tasks |
| `task_move` | Move task between columns |
| `task_delete` | Archive/delete task |
| `task_prioritize` | Change priority + sort |
| `task_time` | Time tracking report |
| `task_analyze` | Deep project analysis for task |

### Intelligence (5 tools)
| Tool | Purpose |
|------|---------|
| `task_context_save` | Save context snapshot |
| `task_context_load` | Load context when resuming |
| `task_agent_create` | Generate .claude/agents/ file |
| `task_agent_delete` | Clean up agent file |
| `task_review` | Pre-close analysis checklist |

### Dependencies & Subtasks (5 tools)
| Tool | Purpose |
|------|---------|
| `task_depend` | Add/remove dependency between tasks |
| `task_blockers` | Show dependency graph |
| `critical_path` | Find the bottleneck chain |
| `task_split` | Break task into subtasks |
| `task_subtasks` | View subtask progress |

### Sprints & Focus (7 tools)
| Tool | Purpose |
|------|---------|
| `sprint_create` | Create a time-boxed sprint |
| `sprint_add` | Add tasks to a sprint |
| `sprint_close` | Close sprint, carry over incomplete |
| `sprint_view` | Sprint progress with burndown |
| `standup` | Daily standup summary |
| `pomodoro_start` | Start a focus session |
| `pomodoro_status` | Check pomodoro timer |

### Auto-Manager (5 tools)
| Tool | Purpose |
|------|---------|
| `manager_report` | Health score, velocity, stalls, suggestions |
| `stall_detect` | Find tasks with no recent activity |
| `suggest_next` | "What to work on next" |
| `auto_reprioritize` | Smart priority adjustment |
| `gantt_view` | Text-based Gantt chart |

### Board & Export (6 tools)
| Tool | Purpose |
|------|---------|
| `board_view` | Full board view |
| `board_export` | Export as markdown |
| `dashboard` | Multi-project overview |
| `project_create` | Create project |
| `project_list` | List projects |
| `project_switch` | Switch active project |

### Session & Git (4 tools)
| Tool | Purpose |
|------|---------|
| `session_log` | Log file/commit to session |
| `session_summary` | Session summary |
| `git_link` | Link commit/branch/PR to task |
| `git_status` | Git repo status |

### v1.5: Multi-Agent Orchestration (10 tools)
| Tool | Purpose |
|------|---------|
| `agent_register` | Register agent session for multi-agent work |
| `agent_heartbeat` | Update heartbeat, clean stale agents |
| `agent_list` | List active agents + tasks + locked files |
| `agent_claim_task` | Assign task to agent (fails if already claimed) |
| `conflict_check` | Check if files are locked by another agent |
| `file_lock` | Lock files to prevent concurrent edits |
| `file_unlock` | Release file locks |
| `agent_handoff` | Create handoff context + release locks |
| `agent_pickup` | Accept handoff, get full context |
| `parallel_plan` | Analyze deps, suggest parallelizable batches |

### v2.0: Planning & Prediction (7 tools)
| Tool | Purpose |
|------|---------|
| `plan_from_prompt` | NL description → structured task breakdown |
| `plan_apply` | Bulk-create tasks from plan with deps |
| `plan_templates` | Pre-built templates (SaaS, API, CLI, library) |
| `predict_duration` | Predict task time from history |
| `velocity_report` | Tasks/day trends, sprint projection |
| `burndown_data` | ASCII burndown chart for sprint |
| `record_velocity` | Snapshot daily velocity |

### v2.0: Risk Assessment (3 tools)
| Tool | Purpose |
|------|---------|
| `risk_assess` | Git hotspots + deps + complexity → risk level |
| `risk_report` | All tasks ranked by risk with mitigations |
| `complexity_classify` | Auto-classify trivial/small/medium/large/epic |

### v2.0: External Sync (5 tools)
| Tool | Purpose |
|------|---------|
| `sync_setup` | Configure GitHub/Linear/Jira credentials |
| `sync_push` | Push task to external tool |
| `sync_pull` | Import issues from external tool |
| `sync_update` | Sync status changes bidirectionally |
| `sync_status` | Show sync state for all linked tasks |

### v2.0: Pull Requests (3 tools)
| Tool | Purpose |
|------|---------|
| `pr_create` | Branch + push + PR + link to task |
| `pr_status` | Check PR review/CI/merge status |
| `pr_auto_flow` | Full flow: branch → commit → push → PR → link |

### v3.0: Approvals (3 tools)
| Tool | Purpose |
|------|---------|
| `approval_request` | Create approval for human review |
| `approval_list` | List pending approvals |
| `approval_resolve` | Approve/reject with reason |

### v3.0: Code Review (3 tools)
| Tool | Purpose |
|------|---------|
| `review_run` | Analyze files: TODOs, type errors, security |
| `review_findings` | View review findings |
| `review_respond` | Respond: fixed/wont_fix/acknowledged |

### v3.0: QA & Testing (4 tools)
| Tool | Purpose |
|------|---------|
| `qa_run` | Run tests, parse results, create bug tasks |
| `qa_report` | View QA results |
| `qa_rerun` | Re-run after fixes, compare with previous |
| `qa_coverage` | Check test coverage for changed files |

### v3.0: DevOps (3 tools)
| Tool | Purpose |
|------|---------|
| `deploy_check` | Readiness check: done, reviewed, QA passed |
| `deploy_run` | Execute deploy (approval required for prod) |
| `deploy_status` | Deployment history and status |

### v3.0: Tech Lead (4 tools)
| Tool | Purpose |
|------|---------|
| `lead_distribute` | Distribute tasks by deps/complexity/skills |
| `lead_status` | Dashboard: agents, tasks, pipeline |
| `lead_reassign` | Reassign task with handoff context |
| `lead_pipeline` | Full pipeline: coding → review → QA → deploy |

### v3.0: Team Management (5 tools)
| Tool | Purpose |
|------|---------|
| `team_add` | Add team member with skills |
| `team_list` | List members with stats |
| `team_assign` | Assign task to member |
| `team_workload` | Workload distribution view |
| `team_suggest_assignment` | Auto-suggest member by skills/availability |

## .kanban/ Directory Structure
```
.kanban/
├── boards/       # Board/project files
├── tasks/        # Active tasks
├── archive/      # Archived tasks
├── sessions/     # Work sessions
├── sprints/      # Sprint definitions
├── agents/       # v1.5: Agent registrations
├── handoffs/     # v1.5: Handoff contexts
├── locks/        # v1.5: Advisory file locks
├── history/      # v2.0: Completion records
├── velocity/     # v2.0: Velocity snapshots
├── approvals/    # v3.0: Approval requests
├── reviews/      # v3.0: Code review results
├── qa/           # v3.0: QA test results
├── deployments/  # v3.0: Deployment records
├── team/         # v3.0: Team members
└── config.json   # Global configuration
```

## Build
```bash
npm install && npm run build
```

## VSCode Extension
```bash
cd vscode-extension && npm install && npm run compile
```
Provides TreeView of board and team, auto-refreshes on .kanban/ changes.
