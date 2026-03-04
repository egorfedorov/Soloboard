# /soloboard:project

Manage project boards.

## Usage

- `/soloboard:project` — Show active project info
- `/soloboard:project create <name>` — Create a new project board
- `/soloboard:project list` — List all projects
- `/soloboard:project switch <name-or-id>` — Switch active project

## Behavior

### No arguments
Call `project_list` and `board_view` to show the active project's name, task counts, and board overview.

### `create <name>`
Call `project_create` with the given name. This also initializes the `.kanban/` directory if it doesn't exist.

### `list`
Call `project_list` and display all projects with their task counts. Mark the active project.

### `switch <name-or-id>`
Call `project_switch` with the given name or ID. Display confirmation with the new active project's board.
