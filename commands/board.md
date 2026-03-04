# /soloboard:board

Display the current kanban board.

## Behavior

1. Call the `board_view` MCP tool to get the current board state
2. Display the board in a clean, readable format
3. Show task counts per column
4. Highlight the currently active "doing" task if any
5. If no project exists, suggest creating one with `/soloboard:project create <name>`

## Example Output

```
# My Project

## TODO (3)
  - [!!] Add user settings page (t_abc123)
  - [!] Update README (t_def456)
  - [!!!] Fix memory leak (t_ghi789)

## DOING (1)
  - [!!] Implement dark mode (t_jkl012) [ui, frontend]

## DONE (5)
  - [!] Setup project structure (t_mno345)
  ...
```
