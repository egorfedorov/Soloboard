import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  tags: string[];
  assignedAgentId: string | null;
  assignedMemberId: string | null;
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
  activeTaskIds: string[];
}

export class BoardProvider implements vscode.TreeDataProvider<BoardItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BoardItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private kanbanDir: string,
    private mode: "board" | "team" = "board"
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: BoardItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BoardItem): Promise<BoardItem[]> {
    if (this.mode === "team") {
      return this.getTeamChildren(element);
    }
    return this.getBoardChildren(element);
  }

  private async getBoardChildren(element?: BoardItem): Promise<BoardItem[]> {
    if (!element) {
      // Root: show columns
      return [
        new BoardItem("📋 TODO", vscode.TreeItemCollapsibleState.Expanded, "column", "todo"),
        new BoardItem("🔄 DOING", vscode.TreeItemCollapsibleState.Expanded, "column", "doing"),
        new BoardItem("✅ DONE", vscode.TreeItemCollapsibleState.Collapsed, "column", "done"),
      ];
    }

    if (element.contextValue === "column") {
      const tasks = this.readTasks();
      return tasks
        .filter((t) => t.status === element.statusFilter)
        .map((t) => {
          const icon = t.priority === "high" ? "🔴" : t.priority === "medium" ? "🟡" : "🟢";
          const assignee = t.assignedAgentId ?? t.assignedMemberId ?? "";
          const label = `${icon} ${t.title}${assignee ? ` [${assignee}]` : ""}`;
          return new BoardItem(label, vscode.TreeItemCollapsibleState.None, "task", undefined, t.id);
        });
    }

    return [];
  }

  private async getTeamChildren(element?: BoardItem): Promise<BoardItem[]> {
    if (!element) {
      const members = this.readTeam();
      if (members.length === 0) {
        return [new BoardItem("No team members yet", vscode.TreeItemCollapsibleState.None, "info")];
      }
      return members.map((m) =>
        new BoardItem(
          `${m.name} (${m.role})`,
          vscode.TreeItemCollapsibleState.Collapsed,
          "member",
          undefined,
          m.id
        )
      );
    }

    if (element.contextValue === "member" && element.itemId) {
      const members = this.readTeam();
      const member = members.find((m) => m.id === element.itemId);
      if (!member) return [];
      const tasks = this.readTasks();
      return member.activeTaskIds
        .map((tid) => tasks.find((t) => t.id === tid))
        .filter((t): t is Task => t !== undefined)
        .map((t) => new BoardItem(`${t.title} [${t.status}]`, vscode.TreeItemCollapsibleState.None, "task", undefined, t.id));
    }

    return [];
  }

  private readTasks(): Task[] {
    const tasksDir = path.join(this.kanbanDir, "tasks");
    try {
      const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".json"));
      return files.map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(tasksDir, f), "utf-8"));
        } catch {
          return null;
        }
      }).filter((t): t is Task => t !== null);
    } catch {
      return [];
    }
  }

  private readTeam(): TeamMember[] {
    const teamDir = path.join(this.kanbanDir, "team");
    try {
      const files = fs.readdirSync(teamDir).filter((f) => f.endsWith(".json"));
      return files.map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(teamDir, f), "utf-8"));
        } catch {
          return null;
        }
      }).filter((m): m is TeamMember => m !== null);
    } catch {
      return [];
    }
  }
}

class BoardItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly statusFilter?: string,
    public readonly itemId?: string
  ) {
    super(label, collapsibleState);
    if (contextValue === "task" && itemId) {
      this.tooltip = `Task: ${itemId}`;
      this.description = itemId;
    }
  }
}
