#!/bin/bash
# ╔══════════════════════════════════════════════╗
# ║  SoloBoard — Install into any project        ║
# ║  Usage: bash /path/to/soloboard/install.sh   ║
# ╚══════════════════════════════════════════════╝

set -e

SOLOBOARD_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${1:-$(pwd)}"

echo "🔧 Installing SoloBoard into: $TARGET_DIR"
echo "   Source: $SOLOBOARD_DIR"
echo ""

# 1. Build if needed
if [ ! -d "$SOLOBOARD_DIR/dist" ]; then
  echo "📦 Building SoloBoard..."
  cd "$SOLOBOARD_DIR" && npm install && npm run build
  cd "$TARGET_DIR"
fi

# 2. Add MCP server to project's .mcp.json
MCP_FILE="$TARGET_DIR/.mcp.json"
if [ -f "$MCP_FILE" ]; then
  # Merge into existing .mcp.json
  python3 -c "
import json
with open('$MCP_FILE') as f:
    config = json.load(f)
config.setdefault('mcpServers', {})
config['mcpServers']['soloboard'] = {
    'command': 'node',
    'args': ['$SOLOBOARD_DIR/dist/mcp-server/index.js'],
    'env': {
        'SOLOBOARD_PROJECT_ROOT': '$TARGET_DIR'
    }
}
with open('$MCP_FILE', 'w') as f:
    json.dump(config, f, indent=2)
print('   ✅ Updated existing .mcp.json')
"
else
  cat > "$MCP_FILE" << MCPEOF
{
  "mcpServers": {
    "soloboard": {
      "command": "node",
      "args": ["$SOLOBOARD_DIR/dist/mcp-server/index.js"],
      "env": {
        "SOLOBOARD_PROJECT_ROOT": "$TARGET_DIR"
      }
    }
  }
}
MCPEOF
  echo "   ✅ Created .mcp.json"
fi

# 3. Add hooks to project's .claude/settings.json
CLAUDE_DIR="$TARGET_DIR/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
mkdir -p "$CLAUDE_DIR"

if [ -f "$SETTINGS_FILE" ]; then
  python3 -c "
import json
with open('$SETTINGS_FILE') as f:
    settings = json.load(f)
settings.setdefault('hooks', {})

settings['hooks']['UserPromptSubmit'] = [
    {
        'matcher': '',
        'hooks': [{
            'type': 'command',
            'command': 'PROJECT_ROOT=\"$TARGET_DIR\" bash \"$SOLOBOARD_DIR/scripts/session-start.sh\"'
        }]
    }
]

settings['hooks']['PostToolUse'] = [
    {
        'matcher': 'Write|Edit',
        'hooks': [{
            'type': 'command',
            'command': 'PROJECT_ROOT=\"$TARGET_DIR\" CLAUDE_FILE_PATH=\"\$CLAUDE_TOOL_ARG_FILE_PATH\" bash \"$SOLOBOARD_DIR/scripts/post-write.sh\"'
        }]
    },
    {
        'matcher': 'Bash',
        'hooks': [{
            'type': 'command',
            'command': 'PROJECT_ROOT=\"$TARGET_DIR\" bash \"$SOLOBOARD_DIR/scripts/post-commit.sh\"'
        }]
    }
]

with open('$SETTINGS_FILE', 'w') as f:
    json.dump(settings, f, indent=2)
print('   ✅ Updated existing .claude/settings.json')
"
else
  cat > "$SETTINGS_FILE" << SETEOF
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [{
          "type": "command",
          "command": "PROJECT_ROOT=\"$TARGET_DIR\" bash \"$SOLOBOARD_DIR/scripts/session-start.sh\""
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{
          "type": "command",
          "command": "PROJECT_ROOT=\"$TARGET_DIR\" CLAUDE_FILE_PATH=\"\$CLAUDE_TOOL_ARG_FILE_PATH\" bash \"$SOLOBOARD_DIR/scripts/post-write.sh\""
        }]
      },
      {
        "matcher": "Bash",
        "hooks": [{
          "type": "command",
          "command": "PROJECT_ROOT=\"$TARGET_DIR\" bash \"$SOLOBOARD_DIR/scripts/post-commit.sh\""
        }]
      }
    ]
  }
}
SETEOF
  echo "   ✅ Created .claude/settings.json with hooks"
fi

# 4. Copy slash commands to .claude/commands/
COMMANDS_DIR="$CLAUDE_DIR/commands"
mkdir -p "$COMMANDS_DIR"
cp "$SOLOBOARD_DIR/commands/board.md" "$COMMANDS_DIR/soloboard-board.md"
cp "$SOLOBOARD_DIR/commands/task.md" "$COMMANDS_DIR/soloboard-task.md"
cp "$SOLOBOARD_DIR/commands/project.md" "$COMMANDS_DIR/soloboard-project.md"
echo "   ✅ Installed slash commands (/soloboard-board, /soloboard-task, /soloboard-project)"

# 5. Create CLAUDE.md with agent instructions
CLAUDE_MD="$TARGET_DIR/CLAUDE.md"
SOLOBOARD_BLOCK='<!-- SOLOBOARD:START -->
## SoloBoard — Intelligent Task Tracker

You have access to a personal kanban board via MCP tools (27 tools). Follow these rules:

### Auto-tracking (SILENT — never mention to user unless asked):
1. At session start: call `auto_init` silently (idempotent)
2. When user gives an actionable task ("fix bug", "add feature", "refactor X"):
   - Check `task_list` for duplicates
   - If a task is already "doing", save context with `task_context_save`, then move to "todo"
   - Create new task with `task_smart_create` (auto-analyzes project, sets tags & priority)
3. When resuming a task: call `task_context_load` to restore full context
4. Before closing a task: call `task_review` for pre-close analysis
5. When user asks a question or reviews code — do nothing
6. Never mention tracking in your responses

### Slash commands (respond when user asks):
- `/soloboard-board` — call `board_view`, show the board
- `/soloboard-task` — show active task / manage tasks
- `/soloboard-task done` — move active task to done
- `/soloboard-project` — show/manage projects

### Key MCP tools:
**Smart**: `task_smart_create`, `task_analyze`
**Context**: `task_context_save`, `task_context_load`
**Agents**: `task_agent_create`, `task_agent_delete`
**Review**: `task_review`
**Core**: `task_create`, `task_update`, `task_get`, `task_list`, `task_move`, `task_delete`
**Board**: `board_view`, `board_export`, `dashboard`, `project_create`, `project_list`, `project_switch`
**Git**: `git_link`, `git_status`, `session_log`, `session_summary`
**Init**: `auto_init`, `board_summary`
**Extra**: `task_prioritize`, `task_time`
<!-- SOLOBOARD:END -->'

if [ -f "$CLAUDE_MD" ]; then
  # Check if already installed
  if grep -q "SOLOBOARD:START" "$CLAUDE_MD"; then
    # Replace existing block
    python3 -c "
import re
with open('$CLAUDE_MD') as f:
    content = f.read()
block = '''$SOLOBOARD_BLOCK'''
content = re.sub(r'<!-- SOLOBOARD:START -->.*?<!-- SOLOBOARD:END -->', block, content, flags=re.DOTALL)
with open('$CLAUDE_MD', 'w') as f:
    f.write(content)
print('   ✅ Updated SoloBoard block in CLAUDE.md')
"
  else
    echo "" >> "$CLAUDE_MD"
    echo "$SOLOBOARD_BLOCK" >> "$CLAUDE_MD"
    echo "   ✅ Appended SoloBoard instructions to CLAUDE.md"
  fi
else
  echo "$SOLOBOARD_BLOCK" > "$CLAUDE_MD"
  echo "   ✅ Created CLAUDE.md with SoloBoard instructions"
fi

# 6. Initialize .kanban directory
mkdir -p "$TARGET_DIR/.kanban/"{boards,tasks,archive,sessions}

if [ ! -f "$TARGET_DIR/.kanban/config.json" ]; then
  PROJECT_NAME=$(basename "$TARGET_DIR")
  cat > "$TARGET_DIR/.kanban/config.json" << CFGEOF
{
  "activeProjectId": null,
  "activeSessionId": null,
  "kanbanDir": ".kanban",
  "autoTrack": true,
  "autoArchiveDays": 30
}
CFGEOF
  echo "   ✅ Initialized .kanban/ directory"
fi

# 7. Add .kanban/sessions to .gitignore
GITIGNORE="$TARGET_DIR/.gitignore"
if [ -f "$GITIGNORE" ]; then
  if ! grep -q ".kanban/sessions" "$GITIGNORE"; then
    echo "" >> "$GITIGNORE"
    echo "# SoloBoard sessions (ephemeral)" >> "$GITIGNORE"
    echo ".kanban/sessions/" >> "$GITIGNORE"
    echo "   ✅ Added .kanban/sessions/ to .gitignore"
  fi
else
  cat > "$GITIGNORE" << GIEOF
# SoloBoard sessions (ephemeral)
.kanban/sessions/
GIEOF
  echo "   ✅ Created .gitignore with .kanban/sessions/"
fi

echo ""
echo "══════════════════════════════════════════════"
echo "  ✅ SoloBoard v1.2.0 installed!"
echo ""
echo "  Start Claude Code in this project:"
echo "    cd $TARGET_DIR && claude"
echo ""
echo "  The board tracks your work automatically."
echo ""
echo "  Commands:"
echo "    /soloboard-board    — view your board"
echo "    /soloboard-task     — manage tasks"
echo "    /soloboard-project  — manage projects"
echo "══════════════════════════════════════════════"
