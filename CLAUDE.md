# SoloBoard — Intelligent Task Tracker Plugin

## What is this
MCP-based invisible kanban board for Claude Code. Tracks tasks with context awareness, project analysis, agent integration, and auto-review.

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
5. **Before closing a task**: Call `task_review` for pre-close analysis.
6. **On questions/reviews**: Do nothing.
7. **NEVER mention tracking** unless user asks with `/soloboard:board` etc.

### For the User:
- `/soloboard:board` — see the board
- `/soloboard:task done` — mark current task done
- `/soloboard:project` — manage projects
- Everything else is automatic

## MCP Tools (27 total)
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
| `task_context_save` | Save context snapshot |
| `task_context_load` | Load context when resuming |
| `task_agent_create` | Generate .claude/agents/ file |
| `task_agent_delete` | Clean up agent file |
| `task_review` | Pre-close analysis checklist |
| `board_view` | Full board view |
| `board_export` | Export as markdown |
| `dashboard` | Multi-project overview |
| `project_create` | Create project |
| `project_list` | List projects |
| `project_switch` | Switch active project |
| `session_log` | Log file/commit to session |
| `session_summary` | Session summary |
| `git_link` | Link commit/branch/PR to task |
| `git_status` | Git repo status |

## Build
```bash
npm install && npm run build
```
