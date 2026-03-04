#!/bin/bash
# SoloBoard: Post-write hook
# Tracks file changes to the active task

KANBAN_DIR="${PROJECT_ROOT:-.}/.kanban"
CONFIG_FILE="$KANBAN_DIR/config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  exit 0
fi

# The file path comes from the hook context
FILE_PATH="${CLAUDE_FILE_PATH:-$1}"
if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Skip .kanban internal files
case "$FILE_PATH" in
  *.kanban/*) exit 0 ;;
esac

# Get active session
ACTIVE_SESSION=$(python3 -c "
import json
try:
    c = json.load(open('$CONFIG_FILE'))
    print(c.get('activeSessionId', '') or '')
except: print('')
" 2>/dev/null)

if [ -z "$ACTIVE_SESSION" ]; then
  exit 0
fi

SESSION_FILE="$KANBAN_DIR/sessions/$ACTIVE_SESSION.json"
if [ ! -f "$SESSION_FILE" ]; then
  exit 0
fi

# Get active task from session
ACTIVE_TASK=$(python3 -c "
import json
try:
    s = json.load(open('$SESSION_FILE'))
    print(s.get('activeTaskId', '') or '')
except: print('')
" 2>/dev/null)

# Add file to session
python3 -c "
import json
f = '$SESSION_FILE'
s = json.load(open(f))
fp = '$FILE_PATH'
if fp not in s.get('files', []):
    s.setdefault('files', []).append(fp)
    json.dump(s, open(f, 'w'), indent=2)
" 2>/dev/null

# Add file to active task
if [ -n "$ACTIVE_TASK" ]; then
  TASK_FILE="$KANBAN_DIR/tasks/$ACTIVE_TASK.json"
  if [ -f "$TASK_FILE" ]; then
    python3 -c "
import json
from datetime import datetime
f = '$TASK_FILE'
t = json.load(open(f))
fp = '$FILE_PATH'
if fp not in t.get('files', []):
    t.setdefault('files', []).append(fp)
    t['updatedAt'] = datetime.utcnow().isoformat() + 'Z'
    json.dump(t, open(f, 'w'), indent=2)
" 2>/dev/null
  fi
fi
