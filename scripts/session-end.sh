#!/bin/bash
# SoloBoard: Session end hook
# Closes the active session

KANBAN_DIR="${PROJECT_ROOT:-.}/.kanban"
CONFIG_FILE="$KANBAN_DIR/config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  exit 0
fi

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
if [ -f "$SESSION_FILE" ]; then
  python3 -c "
import json
from datetime import datetime
f = '$SESSION_FILE'
s = json.load(open(f))
s['endedAt'] = datetime.utcnow().isoformat() + 'Z'
json.dump(s, open(f, 'w'), indent=2)
" 2>/dev/null
fi

# Clear active session in config
python3 -c "
import json
f = '$CONFIG_FILE'
c = json.load(open(f))
c['activeSessionId'] = None
json.dump(c, open(f, 'w'), indent=2)
" 2>/dev/null
