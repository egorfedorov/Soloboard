import { execSync } from "node:child_process";

export function getCurrentBranch(cwd: string): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

export function getLatestCommitSha(cwd: string): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

export function getCommitMessage(cwd: string, sha: string): string | null {
  try {
    return execSync(`git log -1 --format=%s ${sha}`, { cwd, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

export function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

export function getGitStatus(cwd: string): string | null {
  try {
    return execSync("git status --short", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

export function getRecentCommits(cwd: string, count: number = 5): Array<{ sha: string; message: string }> {
  try {
    const output = execSync(`git log -${count} --format=%h:%s`, { cwd, encoding: "utf-8" }).trim();
    if (!output) return [];
    return output.split("\n").map((line) => {
      const [sha, ...rest] = line.split(":");
      return { sha, message: rest.join(":") };
    });
  } catch {
    return [];
  }
}
