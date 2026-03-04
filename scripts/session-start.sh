#!/bin/bash
# SoloBoard: Session start hook
# Injects board context into Claude Code session

KANBAN_DIR="${PROJECT_ROOT:-.}/.kanban"
CONFIG_FILE="$KANBAN_DIR/config.json"

# Skip if no kanban setup
if [ ! -f "$CONFIG_FILE" ]; then
  exit 0
fi

ACTIVE_PROJECT=$(cat "$CONFIG_FILE" 2>/dev/null | grep -o '"activeProjectId"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//;s/"//')

if [ -z "$ACTIVE_PROJECT" ] || [ "$ACTIVE_PROJECT" = "null" ]; then
  exit 0
fi

BOARD_FILE="$KANBAN_DIR/boards/$ACTIVE_PROJECT.json"
if [ ! -f "$BOARD_FILE" ]; then
  exit 0
fi

# Count tasks per column
TODO_COUNT=$(cat "$BOARD_FILE" | grep -o '"todo"' | head -1 | wc -l)
DOING_COUNT=$(cat "$BOARD_FILE" | grep -o '"doing"' | head -1 | wc -l)
DONE_COUNT=$(cat "$BOARD_FILE" | grep -o '"done"' | head -1 | wc -l)

# More accurate counting using simple parsing
TODO_COUNT=$(python3 -c "
import json, sys
try:
    b = json.load(open('$BOARD_FILE'))
    print(len(b['columns']['todo']))
except: print(0)
" 2>/dev/null || echo "0")

DOING_COUNT=$(python3 -c "
import json, sys
try:
    b = json.load(open('$BOARD_FILE'))
    print(len(b['columns']['doing']))
except: print(0)
" 2>/dev/null || echo "0")

DONE_COUNT=$(python3 -c "
import json, sys
try:
    b = json.load(open('$BOARD_FILE'))
    print(len(b['columns']['done']))
except: print(0)
" 2>/dev/null || echo "0")

BOARD_NAME=$(python3 -c "
import json
try:
    b = json.load(open('$BOARD_FILE'))
    print(b['name'])
except: print('Unknown')
" 2>/dev/null || echo "Unknown")

# Output context for Claude Code
echo "[SoloBoard: $BOARD_NAME] TODO: $TODO_COUNT | DOING: $DOING_COUNT | DONE: $DONE_COUNT"

# Show active doing task
if [ "$DOING_COUNT" -gt 0 ] 2>/dev/null; then
  DOING_TASKS=$(python3 -c "
import json, os
try:
    b = json.load(open('$BOARD_FILE'))
    for tid in b['columns']['doing']:
        tf = os.path.join('$KANBAN_DIR', 'tasks', tid + '.json')
        if os.path.exists(tf):
            t = json.load(open(tf))
            print(f\"  → {t['title']} ({t['id']})\")
except: pass
" 2>/dev/null)
  if [ -n "$DOING_TASKS" ]; then
    echo "Active:"
    echo "$DOING_TASKS"
  fi
fi
