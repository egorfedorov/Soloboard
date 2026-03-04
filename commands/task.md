# /soloboard:task

Manage individual tasks on the board.

## Usage

- `/soloboard:task` — Show the currently active (doing) task
- `/soloboard:task done` — Move the active task to done
- `/soloboard:task todo` — Move the active task back to todo
- `/soloboard:task create <title>` — Create a new task
- `/soloboard:task <id-or-name>` — Show details for a specific task
- `/soloboard:task delete <id-or-name>` — Archive a task

## Behavior

### No arguments
Call `task_list` with status "doing". If there's an active task, display its full details including:
- Title, description, priority, tags
- Linked branch, commits, PR
- Files touched
- Timestamps

### `done` / `todo` / `doing`
Move the currently active task to the specified status using `task_move`.

### `create <title>`
Create a new task with the given title using `task_create`. Ask for optional details if the user provides just a title.

### `<id-or-name>`
Look up a task by ID or fuzzy title match using `task_get` and display full details.

### `delete <id-or-name>`
Archive the specified task using `task_delete`.
