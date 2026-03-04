import * as vscode from "vscode";

export class FileWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher;

  constructor(kanbanDir: string, onChanged: () => void) {
    const pattern = new vscode.RelativePattern(kanbanDir, "**/*.json");
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    // Debounce refresh
    let timeout: NodeJS.Timeout | undefined;
    const debounceRefresh = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(onChanged, 500);
    };

    this.watcher.onDidChange(debounceRefresh);
    this.watcher.onDidCreate(debounceRefresh);
    this.watcher.onDidDelete(debounceRefresh);
  }

  dispose(): void {
    this.watcher.dispose();
  }
}
