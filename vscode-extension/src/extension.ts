import * as vscode from "vscode";
import { BoardProvider } from "./board-provider";
import { FileWatcher } from "./file-watcher";

export function activate(context: vscode.ExtensionContext) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  const kanbanDir = `${workspaceRoot}/.kanban`;

  const boardProvider = new BoardProvider(kanbanDir);
  const boardTree = vscode.window.createTreeView("soloboard.board", {
    treeDataProvider: boardProvider,
    showCollapseAll: true,
  });

  const teamProvider = new BoardProvider(kanbanDir, "team");
  const teamTree = vscode.window.createTreeView("soloboard.team", {
    treeDataProvider: teamProvider,
  });

  const watcher = new FileWatcher(kanbanDir, () => {
    boardProvider.refresh();
    teamProvider.refresh();
  });

  const refreshCmd = vscode.commands.registerCommand("soloboard.refresh", () => {
    boardProvider.refresh();
    teamProvider.refresh();
  });

  context.subscriptions.push(boardTree, teamTree, refreshCmd, watcher);
}

export function deactivate() {}
