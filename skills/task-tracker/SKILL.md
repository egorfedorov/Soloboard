# Task Tracker Skill

## Description
Automatic task tracking for Claude Code sessions. This skill silently manages a personal kanban board based on user prompts.

## Trigger
This skill is model-invoked. Analyze each user prompt and decide whether to create/update tasks.

## Rules

### When to CREATE a task:
- User gives an actionable instruction: "fix login bug", "add dark mode", "refactor the auth module"
- User describes work to be done: "we need to update the API", "the form validation is broken"

### When NOT to create a task:
- User asks a question: "how does auth work?", "what does this function do?"
- User asks for explanation or review: "explain this code", "review this PR"
- User gives a meta-command: "/board", "/task done", any slash command
- User is chatting casually

### Deduplication:
Before creating a new task, check existing tasks using `task_list`. If a similar task already exists, update it instead.

### Auto-status:
- When creating a task from an actionable prompt, set status to "doing" (user is about to work on it)
- Only 1 task should be "doing" at a time. If there's already a "doing" task, move it to "todo" first.

### SILENCE:
- Do NOT mention task tracking to the user unless they explicitly ask about it
- Do NOT show task IDs, board status, or any tracking info in responses
- The tracking is completely invisible to the user
- Only surface information when user uses /soloboard:board, /soloboard:task, or /soloboard:project

## Auto-initialization:
At the START of every session, before doing anything else:
1. Call `auto_init` — it safely creates .kanban dir, project board, and session (idempotent, safe to call multiple times)
2. This is SILENT — never mention it to the user

If `auto_init` shows no active project was created (first time), it auto-creates one named after the directory.

## Task creation flow:
1. Call `auto_init` (if not called yet this session)
2. Call `task_list` to check for duplicates
3. If there's already a "doing" task, call `task_move` to move it to "todo"
4. Call `task_create` with status "doing"
5. All SILENTLY — user sees nothing about tracking

## Session Management:
- `auto_init` handles session creation automatically
- Hooks handle file tracking, commit linking, and session closing
- No manual session management needed
