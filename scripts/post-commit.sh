#!/bin/bash
# SoloBoard: Post-commit hook
# Links git commits to the active task

KANBAN_DIR="${PROJECT_ROOT:-.}/.kanban"
CONFIG_FILE="$KANBAN_DIR/config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  exit 0
fi

# Get latest commit SHA
COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null)
if [ -z "$COMMIT_SHA" ]; then
  exit 0
fi

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

# Link commit to session
python3 -c "
import json
f = '$SESSION_FILE'
s = json.load(open(f))
sha = '$COMMIT_SHA'
if sha not in s.get('commits', []):
    s.setdefault('commits', []).append(sha)
    json.dump(s, open(f, 'w'), indent=2)
" 2>/dev/null

# Link commit to active task
if [ -n "$ACTIVE_TASK" ]; then
  TASK_FILE="$KANBAN_DIR/tasks/$ACTIVE_TASK.json"
  if [ -f "$TASK_FILE" ]; then
    python3 -c "
import json
from datetime import datetime
f = '$TASK_FILE'
t = json.load(open(f))
sha = '$COMMIT_SHA'
if sha not in t.get('commits', []):
    t.setdefault('commits', []).append(sha)
    t['updatedAt'] = datetime.utcnow().isoformat() + 'Z'
    json.dump(t, open(f, 'w'), indent=2)
" 2>/dev/null
  fi
fi
