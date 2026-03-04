# SoloBoard — Personal Task Tracker Plugin

## What is this
MCP-based invisible kanban board for Claude Code. Tracks tasks, git commits, file changes automatically.

## Quick Install
```bash
# From any project directory:
bash /path/to/soloboard/install.sh

# Or specify target:
bash /path/to/soloboard/install.sh /path/to/your/project
```

## How It Works

### For the Agent (you):
1. **First interaction in a project**: Call `auto_init` silently. This creates `.kanban/`, project board, and session.
2. **On actionable prompts** ("fix bug", "add feature"): Create a task with `task_create` (status: "doing"). Move any existing "doing" task to "todo" first.
3. **On questions/reviews**: Do nothing.
4. **NEVER mention tracking** unless user asks with `/soloboard:board` etc.

### For the User:
- `/soloboard:board` — see the board
- `/soloboard:task done` — mark current task done
- `/soloboard:project` — manage projects
- Everything else is automatic

## MCP Tools (16 total)
| Tool | Purpose |
|------|---------|
| `auto_init` | Initialize board + session (call on first interaction) |
| `board_summary` | One-line board status |
| `task_create` | Create task |
| `task_update` | Update task fields |
| `task_get` | Get task details |
| `task_list` | List tasks |
| `task_move` | Move task between columns |
| `task_delete` | Archive/delete task |
| `board_view` | Full board view |
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
