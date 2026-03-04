# Task Tracker Skill

## Description
Automatic intelligent task tracking for Claude Code sessions. This skill silently manages a personal kanban board with context awareness, smart analysis, and agent integration.

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

### Smart Task Creation:
Use `task_smart_create` instead of `task_create`. It automatically:
- Generates a clean title from messy prompts ("this is slow" → "Optimize performance of [module]")
- Finds related files in the project
- Auto-tags based on content (#bug, #feature, #performance, #security, #ui, etc.)
- Sets priority based on urgency keywords and code hotspots
- Saves initial analysis as task context

### Deduplication:
Before creating a new task, check existing tasks using `task_list`. If a similar task already exists, update it instead.

### Auto-status:
- When creating a task from an actionable prompt, set status to "doing" (user is about to work on it)
- Only 1 task should be "doing" at a time. If there's already a "doing" task:
  1. Save its context with `task_context_save` (what was done, what's left)
  2. Move it to "todo" with `task_move`
  3. Then create the new task

### Context Management:
- When SWITCHING tasks (moving current "doing" to "todo"):
  - Call `task_context_save` on the old task with: files you examined, decisions made, remaining work
- When RESUMING a task (moving a "todo" back to "doing"):
  - Call `task_context_load` to get the full context back
  - Use the loaded context to continue work seamlessly

### Task Review on Completion:
- When user says "done" or you complete the task's objective:
  - Call `task_review` to get a pre-close analysis
  - The review checks: files changed, commits made, TODOs left, tests exist, types check
  - If all checks pass, move to done silently
  - If there are warnings, mention them briefly before closing

### Agent Creation:
- For complex tasks (multiple files, estimated >30 min), consider creating an agent:
  - Call `task_agent_create` with constraints and test commands
  - This creates a `.claude/agents/task-*.md` file that can be launched in any session
- When a task with an agent is completed:
  - Call `task_agent_delete` to clean up

### SILENCE:
- Do NOT mention task tracking to the user unless they explicitly ask about it
- Do NOT show task IDs, board status, or any tracking info in responses
- The tracking is completely invisible to the user
- Only surface information when user uses /soloboard:board, /soloboard:task, or /soloboard:project
- Analysis results (related files, suggested approach) should inform YOUR work, not be shown to the user

## Auto-initialization:
At the START of every session, before doing anything else:
1. Call `auto_init` — it safely creates .kanban dir, project board, and session (idempotent)
2. This is SILENT — never mention it to the user

## Smart Task Creation Flow:
1. Call `auto_init` (if not called yet this session)
2. Call `task_list` to check for duplicates
3. If there's already a "doing" task:
   a. Call `task_context_save` on it
   b. Call `task_move` to move it to "todo"
4. Call `task_smart_create` with the user's prompt (NOT task_create)
5. Use the analysis from task_smart_create to inform your work approach
6. All SILENTLY — user sees nothing about tracking

## Session Management:
- `auto_init` handles session creation automatically
- Hooks handle file tracking, commit linking, and session closing
- No manual session management needed
