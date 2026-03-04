<p align="center">
  <img src="logo.svg" width="100" alt="SoloBoard">
</p>

<h1 align="center">SoloBoard</h1>

<p align="center">
  <strong>Invisible personal kanban for Claude Code</strong><br>
  You code. Board tracks. That's it.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude_Code-plugin-7c6aef?style=flat-square" alt="Claude Code Plugin">
  <img src="https://img.shields.io/badge/MCP-server-a78bfa?style=flat-square" alt="MCP Server">
  <img src="https://img.shields.io/badge/tools-27-34d399?style=flat-square" alt="27 Tools">
  <img src="https://img.shields.io/badge/license-MIT-60a5fa?style=flat-square" alt="MIT">
</p>

---

## What is this?

SoloBoard is a Claude Code plugin that **silently** tracks your tasks as you work. No setup commands, no context switching, no overhead. Just code — the board manages itself.

```
you > fix the login bug on mobile
                                    ← task silently created in DOING

claude > Found the issue in auth.ts:47...
                                    ← files auto-tracked to task

you > commit this
                                    ← commit SHA auto-linked to task

you > /soloboard-board

  TODO (1)       DOING (1)              DONE (3)
                 → Fix login bug        ✓ Setup auth
                   on mobile            ✓ Add dark mode
                   abc1234              ✓ Refactor API
```

## Install

### Option A: npm global (recommended)
```bash
npm install -g soloboard
soloboard install            # in your project directory
```

### Option B: Clone & build
```bash
git clone https://github.com/egorfedorov/Soloboard.git
cd Soloboard && npm install && npm run build
bash install.sh /path/to/your/project
```

Then just `cd your-project && claude` — the board manages itself.

## How it works

| You do | SoloBoard does (silently) |
|--------|--------------------------|
| `"fix the login bug"` | Creates task → DOING |
| `"how does auth work?"` | Nothing — it's a question |
| `"add dark mode"` | Moves previous task → TODO, creates new → DOING |
| Edit files | Auto-tracks changed files to active task |
| `git commit` | Auto-links commit SHA to active task |
| `/soloboard-board` | Shows the kanban board |
| `/soloboard-task done` | Moves active task → DONE |

## Commands

| Command | What it does |
|---------|-------------|
| `/soloboard-board` | View your kanban board |
| `/soloboard-task` | Show active task / `done` / `create <title>` / `delete <name>` |
| `/soloboard-project` | Show project / `create <name>` / `list` / `switch <name>` |

## Features

- **Zero friction** — no setup commands, board auto-initializes on first prompt
- **Silent tracking** — tasks created from actionable prompts, questions ignored
- **Smart task creation** — analyzes project to find related files, auto-tags, and sets priority
- **Task context** — saves what you examined, decisions made, remaining work per task
- **Task agents** — auto-generates `.claude/agents/` files for complex tasks
- **Auto-review** — pre-close analysis checks for TODOs, tests, type errors before marking done
- **Git integration** — commits, branches, and PRs auto-linked to tasks
- **Fuzzy search** — say "move login bug to done" and it finds the right task
- **File-per-task storage** — each task is a JSON file in `.kanban/tasks/`, git-friendly
- **Safe** — only touches `.kanban/` in your project, no network, no dangerous ops
- **3 statuses** — TODO, DOING, DONE. That's it.
- **Time tracking** — automatic: tracks time in DOING, shows per-task and total
- **Priority sorting** — high tasks float to top of each column automatically
- **Markdown export** — export the board as markdown for reports or sharing
- **Multi-project dashboard** — see all projects at a glance with `dashboard`
- **Global CLI** — `npm install -g soloboard && soloboard install`

## Architecture

```
soloboard/
├── src/mcp-server/
│   ├── index.ts              # Entry point (stdio transport)
│   ├── server.ts             # MCP server + 27 tools
│   ├── tools/
│   │   ├── task-tools.ts     # create/update/get/list/move/delete
│   │   ├── board-tools.ts    # view/project-create/list/switch
│   │   ├── session-tools.ts  # log/summary
│   │   ├── git-tools.ts      # link/status
│   │   ├── init-tools.ts     # auto_init/board_summary
│   │   ├── export-tools.ts   # export/dashboard/prioritize/time
│   │   ├── smart-tools.ts    # smart_create/analyze (project analysis)
│   │   ├── context-tools.ts  # context_save/load (task continuity)
│   │   ├── agent-tools.ts    # agent_create/delete (.claude/agents/)
│   │   └── review-tools.ts   # pre-close review & checklist
│   ├── storage/              # Atomic writes, file-per-task
│   ├── models/               # Task, Board, Session, Config
│   └── utils/                # nanoid, git helpers, project analyzer
├── scripts/                  # Hook scripts (session, files, commits)
├── commands/                 # Slash command definitions
├── skills/                   # Smart auto-tracking skill
└── install.sh                # One-command installer
```

**Data stored in your project:**

```
.kanban/
├── config.json               # Active project + session
├── boards/{id}.json          # Board columns (task IDs)
├── tasks/{id}.json           # One file per task (with context)
├── archive/{id}.json         # Completed old tasks
└── sessions/{id}.json        # Session logs (gitignored)
```

## MCP Tools (27)

| Tool | Purpose |
|------|---------|
| **Init** | |
| `auto_init` | Initialize board + session (idempotent) |
| `board_summary` | One-line status for context injection |
| **Smart Tasks** | |
| `task_smart_create` | Create task with auto-analysis, tags, priority |
| `task_create` | Create task with title, priority, tags |
| `task_update` | Update task fields |
| `task_get` | Get task by ID or fuzzy name |
| `task_list` | List tasks, filter by status |
| `task_move` | Move between TODO/DOING/DONE |
| `task_delete` | Archive or delete task |
| `task_prioritize` | Change priority + auto-sort column |
| `task_time` | Time tracking report per task or all |
| `task_analyze` | Deep project analysis for a task |
| **Context & Agents** | |
| `task_context_save` | Save context: files, decisions, remaining work |
| `task_context_load` | Load context when resuming a task |
| `task_agent_create` | Generate `.claude/agents/` file for a task |
| `task_agent_delete` | Clean up agent file when done |
| `task_review` | Pre-close: TODOs, tests, changes, type check |
| **Board & Export** | |
| `board_view` | Full kanban board (sorted by priority) |
| `board_export` | Export board as markdown |
| `dashboard` | Multi-project overview with time totals |
| `project_create` | Create project board |
| `project_list` | List all projects |
| `project_switch` | Switch active project |
| **Session & Git** | |
| `session_log` | Log file/commit to session |
| `session_summary` | Session activity summary |
| `git_link` | Link commit/branch/PR to task |
| `git_status` | Git repo status + recent commits |

## What install.sh does

1. Adds SoloBoard MCP server to `.mcp.json`
2. Creates hooks in `.claude/settings.json` (file tracking, commit linking)
3. Injects agent instructions into `CLAUDE.md`
4. Initializes `.kanban/` directory
5. Adds `.kanban/sessions/` to `.gitignore`

All reversible. Delete these files to uninstall.

## Dependencies

Only 3 runtime dependencies:

- `@modelcontextprotocol/sdk` — MCP protocol
- `zod` — schema validation
- `nanoid` — ID generation

## License

MIT
