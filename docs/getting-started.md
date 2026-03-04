# Getting Started with SoloBoard

SoloBoard is an autonomous development orchestrator for Claude Code. It silently tracks your tasks, manages your board, and stays out of your way -- until you need it.

This guide walks you through installation, first use, and the most common workflows.

---

## Prerequisites

- **Node.js 18+** -- check with `node --version`
- **Claude Code** installed and working -- [install guide](https://docs.anthropic.com/en/docs/claude-code)
- **(Optional) `gh` CLI** -- for GitHub integration (`pr_create`, `sync_push`, etc.)

---

## Installation

### Option A: npm global (recommended)

```bash
npm install -g soloboard
cd my-project
soloboard install
```

### Option B: Clone and build

```bash
git clone https://github.com/egorfedorov/Soloboard.git
cd Soloboard && npm install && npm run build
bash install.sh /path/to/your/project
```

Both options do the same thing:

1. Add the SoloBoard MCP server to your project's `.mcp.json`
2. Install hooks in `.claude/settings.json` (file tracking, commit linking)
3. Add agent instructions to `CLAUDE.md`
4. Initialize the `.kanban/` directory
5. Add `.kanban/sessions/` to `.gitignore`

---

## First Use -- Zero Setup

SoloBoard is invisible. There is no init command to run, no config to write. Just open Claude Code in your project:

```
cd my-project
claude
```

Then start working as you normally would:

```
you > fix the login bug on mobile
```

That's it. Behind the scenes, SoloBoard:

- Initializes the board automatically (if it hasn't already)
- Detects that "fix the login bug on mobile" is an actionable task (not a question)
- Creates a task and moves it to DOING
- Analyzes your project to find related files, set tags, and assign priority

You never see any of this unless you ask.

---

## Viewing Your Board

When you want to see what's on the board, use the slash command:

```
you > /soloboard-board
```

Example output:

```
# my-project

## TODO (1)
  - [!!] Add user settings page (t_abc123) [backend, ui]

## DOING (1)
  - [!!] Fix login bug on mobile (t_jkl012) [auth, mobile]
    branch: fix/login-mobile
    commits: abc1234

## DONE (3)
  - [!] Setup auth middleware (t_mno345)
  - [!] Add dark mode (t_pqr678)
  - [!] Refactor API layer (t_stu901)
```

Priority indicators: `[!!!]` high, `[!!]` medium, `[!]` low.

---

## Common Workflows

### Basic Task Tracking

The board tracks your work automatically based on your prompts.

**Actionable prompt -- task created:**

```
you > refactor the database connection pool
```

A new task is created in DOING. If you already had a task in DOING, it gets moved back to TODO and its context is saved.

**Question -- nothing happens:**

```
you > how does the auth middleware work?
```

SoloBoard recognizes this as a question and does not create a task.

**Switching context:**

```
you > fix the login bug on mobile
                                    <- task created: "Fix login bug on mobile"

you > actually, let's add rate limiting first
                                    <- previous task saved to TODO
                                    <- new task created: "Add rate limiting"
```

**Marking a task done:**

```
you > /soloboard-task done
```

The active task moves to DONE. Time spent is recorded automatically.

**Viewing the active task:**

```
you > /soloboard-task
```

Shows full details: title, priority, tags, linked commits, files touched, and timestamps.

---

### Multi-Task Projects

For larger projects, you can plan and organize work ahead of time.

**Create tasks manually:**

```
you > /soloboard-task create Migrate database to PostgreSQL
```

**Plan from a description:**

Tell Claude what you want to build, and SoloBoard breaks it into tasks with dependencies:

```
you > I want to build an auth system with JWT, refresh tokens,
      and role-based access control
```

Claude uses `plan_from_prompt` to generate a structured breakdown:

```
Plan: Auth System (5 tasks)

1. [!!] Setup JWT signing and verification
2. [!!] Implement refresh token rotation
   blocked by: #1
3. [!!!] Add role-based access control
   blocked by: #1
4. [!] Create auth middleware
   blocked by: #1, #2
5. [!] Write integration tests
   blocked by: #3, #4
```

Then `plan_apply` creates all the tasks at once with their dependencies wired up.

**Dependencies:**

Tasks can block each other. A blocked task cannot move to DOING until its blockers are done.

```
you > make "Write tests" depend on "Add role-based access control"
```

Use `critical_path` to find the longest dependency chain -- the bottleneck that determines your project timeline.

**Sprints:**

Group tasks into time-boxed sprints for focused delivery:

```
you > create a sprint called "Auth MVP" for this week, add the first 3 auth tasks
```

View sprint progress with burndown tracking:

```
you > show the current sprint
```

---

### Team and Multi-Agent

SoloBoard supports multiple Claude Code agents working in parallel on the same project.

**Register agents:**

Each agent registers itself to coordinate with others:

```
you > register as the backend agent
```

Uses `agent_register` to create an agent session.

**Claim tasks:**

Agents claim tasks to prevent two agents from working on the same thing:

```
you > claim the "Add rate limiting" task
```

If another agent already claimed it, the claim fails.

**Lock files:**

Prevent concurrent edits to the same files:

```
you > lock src/auth/middleware.ts and src/auth/jwt.ts
```

Other agents will see these files are locked and work on something else.

**Handoff context:**

When one agent finishes part of a task and another needs to continue:

```
you > hand off this task with context about what I've done so far
```

Creates a handoff package with full context: files examined, decisions made, remaining work. The next agent picks it up with `agent_pickup`.

---

### Code Review and QA

SoloBoard includes tools for automated quality checks.

**Pre-close review:**

Before marking an important task done, run a review:

```
you > review this task before closing it
```

Uses `task_review` to check for:
- Leftover TODOs in changed files
- Missing tests for new code
- Type errors
- Uncommitted changes

**Automated code review:**

Run a deeper review on specific files or the whole task:

```
you > run a code review on the auth changes
```

Uses `review_run` to scan for TODOs, type errors, security issues, and style problems. View findings with `review_findings` and respond to each one.

**QA automation:**

Run your test suite and parse the results:

```
you > run QA on the auth module
```

Uses `qa_run` to execute tests, parse failures, and automatically create bug tasks for anything that broke. Re-run after fixes with `qa_rerun` to compare results.

**Approval workflow:**

For critical decisions, request human approval:

```
you > request approval to deploy to production
```

Uses `approval_request`. The approval stays pending until a human resolves it with `approval_resolve`.

---

### Git Integration

SoloBoard links your git activity to tasks automatically.

**Commits are auto-linked:**

When you commit while a task is in DOING, the commit SHA is recorded on the task.

**PR auto-flow:**

Create a complete PR workflow in one step:

```
you > create a PR for this task
```

Uses `pr_auto_flow` to: create a branch, commit changes, push, open a PR, and link it back to the task.

**External sync:**

Push tasks to GitHub Issues, Linear, or Jira:

```
you > sync this task to GitHub Issues
```

Set up with `sync_setup`, then push and pull with `sync_push` and `sync_pull`. Status changes sync bidirectionally with `sync_update`.

---

## Slash Commands Reference

SoloBoard adds three slash commands to Claude Code:

| Command | Subcommands | What it does |
|---------|-------------|-------------|
| `/soloboard-board` | *(none)* | Display the kanban board with all columns |
| `/soloboard-task` | *(none)* | Show the active (DOING) task |
| | `done` | Move active task to DONE |
| | `todo` | Move active task back to TODO |
| | `create <title>` | Create a new task |
| | `<id-or-name>` | Show details for a specific task |
| | `delete <id-or-name>` | Archive a task |
| `/soloboard-project` | *(none)* | Show active project info |
| | `create <name>` | Create a new project board |
| | `list` | List all projects |
| | `switch <name-or-id>` | Switch to a different project |

---

## Configuration

SoloBoard stores everything in the `.kanban/` directory at the root of your project.

```
.kanban/
  config.json          # Active project, session, settings
  boards/              # Board definitions (columns and task IDs)
  tasks/               # One JSON file per task
  sprints/             # Sprint definitions
  archive/             # Completed old tasks
  sessions/            # Session logs (gitignored)
  agents/              # Agent registrations (multi-agent)
  locks/               # File locks (multi-agent)
  ...
```

**Config file:** `.kanban/config.json`

```json
{
  "activeProjectId": null,
  "activeSessionId": null,
  "kanbanDir": ".kanban",
  "autoTrack": true,
  "autoArchiveDays": 30
}
```

- `autoTrack` -- whether to auto-create tasks from prompts (default: true)
- `autoArchiveDays` -- move DONE tasks to archive after this many days (default: 30)

**Safe to commit:** The `.kanban/` directory is designed to be committed to git. Session files are automatically gitignored since they are ephemeral. Committing tasks, boards, and sprints lets your whole team share the board state.

---

## Tips and Best Practices

**Let the board manage itself.** The less you think about SoloBoard, the better it works. Just describe what you want to build, and it tracks the work.

**Use `/soloboard-board` sparingly.** Check the board when you want an overview or need to decide what to work on next. You do not need to check it after every prompt.

**Use sprints for larger projects.** If you have more than 5-6 tasks, group them into sprints. This gives you burndown tracking and helps focus your work.

**Run `task_review` before closing important tasks.** The pre-close review catches leftover TODOs, missing tests, and uncommitted changes that are easy to miss.

**Use `plan_from_prompt` for feature planning.** Instead of manually creating tasks one by one, describe the whole feature and let SoloBoard break it down with dependencies.

**Use `suggest_next` when you are unsure what to do.** It analyzes priorities, blockers, and dependencies to recommend the highest-impact task to work on next.

---

## Troubleshooting

**"I don't see any SoloBoard tools in Claude Code"**

Make sure SoloBoard is registered in your project's `.mcp.json`. Run:

```bash
cat .mcp.json
```

You should see a `soloboard` entry under `mcpServers`. If not, re-run the install:

```bash
soloboard install
# or: bash /path/to/soloboard/install.sh
```

**"Tasks aren't being created from my prompts"**

SoloBoard relies on Claude calling `task_smart_create` when it detects an actionable prompt. Check that:

1. The `CLAUDE.md` file in your project contains the SoloBoard agent instructions (look for `<!-- SOLOBOARD:START -->`)
2. The `.claude/settings.json` file has the SoloBoard hooks configured
3. You are giving actionable prompts, not questions. "Fix the login bug" creates a task. "How does the login work?" does not.

**"The board is empty even though I've been working"**

The board auto-initializes on the first interaction via `auto_init`. If nothing has run yet:

1. Start a new Claude Code session: `claude`
2. Give an actionable prompt: "fix the login bug"
3. Then check: `/soloboard-board`

If the board is still empty, check that the MCP server is running by looking for errors in Claude Code's output.

**"I want to start fresh"**

Delete the `.kanban/` directory and SoloBoard will re-initialize on the next session:

```bash
rm -rf .kanban/
```

**"How do I uninstall?"**

Remove these files and sections:

1. Delete the `soloboard` entry from `.mcp.json`
2. Remove the SoloBoard hooks from `.claude/settings.json`
3. Remove the `<!-- SOLOBOARD:START -->` ... `<!-- SOLOBOARD:END -->` block from `CLAUDE.md`
4. Delete `.kanban/` if you want to remove all task data
5. Delete `.claude/commands/soloboard-*.md`
