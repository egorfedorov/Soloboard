import { execSync } from "node:child_process";
import { ExternalIssue, ExternalProvider } from "../models/external.js";

// GitHub via gh CLI
export function ghCreateIssue(title: string, body: string, labels: string[], repo?: string): string | null {
  try {
    const args = [`gh issue create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`];
    if (labels.length > 0) args.push(`--label "${labels.join(",")}"`);
    if (repo) args.push(`--repo "${repo}"`);
    const result = execSync(args.join(" "), { encoding: "utf-8", timeout: 30000 }).trim();
    return result; // Returns URL
  } catch {
    return null;
  }
}

export function ghGetIssue(issueNumber: string, repo?: string): ExternalIssue | null {
  try {
    const repoArg = repo ? `--repo "${repo}"` : "";
    const result = execSync(
      `gh issue view ${issueNumber} --json number,title,body,state,url,labels,assignees ${repoArg}`,
      { encoding: "utf-8", timeout: 30000 }
    );
    const data = JSON.parse(result);
    return {
      provider: "github",
      externalId: String(data.number),
      title: data.title,
      description: data.body ?? "",
      status: data.state,
      url: data.url,
      labels: (data.labels ?? []).map((l: { name: string }) => l.name),
      assignee: data.assignees?.[0]?.login ?? null,
    };
  } catch {
    return null;
  }
}

export function ghListIssues(repo?: string, state?: string, limit?: number): ExternalIssue[] {
  try {
    const repoArg = repo ? `--repo "${repo}"` : "";
    const stateArg = state ? `--state "${state}"` : "";
    const limitArg = `--limit ${limit ?? 30}`;
    const result = execSync(
      `gh issue list ${repoArg} ${stateArg} ${limitArg} --json number,title,body,state,url,labels,assignees`,
      { encoding: "utf-8", timeout: 30000 }
    );
    const data = JSON.parse(result);
    return data.map((d: Record<string, unknown>) => ({
      provider: "github" as const,
      externalId: String(d.number),
      title: d.title as string,
      description: (d.body as string) ?? "",
      status: d.state as string,
      url: d.url as string,
      labels: ((d.labels as Array<{ name: string }>) ?? []).map((l) => l.name),
      assignee: (d.assignees as Array<{ login: string }>)?.[0]?.login ?? null,
    }));
  } catch {
    return [];
  }
}

export function ghUpdateIssueState(issueNumber: string, state: "open" | "closed", repo?: string): boolean {
  try {
    const repoArg = repo ? `--repo "${repo}"` : "";
    const cmd = state === "closed" ? "close" : "reopen";
    execSync(`gh issue ${cmd} ${issueNumber} ${repoArg}`, { encoding: "utf-8", timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

// Linear REST API
export async function linearCreateIssue(
  token: string,
  teamId: string,
  title: string,
  description: string
): Promise<{ id: string; url: string } | null> {
  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        query: `mutation { issueCreate(input: { teamId: "${teamId}", title: "${title.replace(/"/g, '\\"')}", description: "${description.replace(/"/g, '\\"')}" }) { success issue { id url } } }`,
      }),
    });
    const data = await res.json() as { data?: { issueCreate?: { issue?: { id: string; url: string } } } };
    return data.data?.issueCreate?.issue ?? null;
  } catch {
    return null;
  }
}

// Jira REST API
export async function jiraCreateIssue(
  baseUrl: string,
  email: string,
  token: string,
  projectKey: string,
  summary: string,
  description: string
): Promise<{ key: string; url: string } | null> {
  try {
    const res = await fetch(`${baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
      },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary,
          description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ text: description, type: "text" }] }] },
          issuetype: { name: "Task" },
        },
      }),
    });
    const data = await res.json() as { key?: string };
    if (data.key) return { key: data.key, url: `${baseUrl}/browse/${data.key}` };
    return null;
  } catch {
    return null;
  }
}

// PR helpers via gh CLI
export function ghCreateBranch(branchName: string, cwd: string): boolean {
  try {
    execSync(`git checkout -b "${branchName}"`, { cwd, encoding: "utf-8", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

export function ghPushBranch(branchName: string, cwd: string): boolean {
  try {
    execSync(`git push -u origin "${branchName}"`, { cwd, encoding: "utf-8", timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

export function ghCreatePR(title: string, body: string, cwd: string): string | null {
  try {
    const result = execSync(
      `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`,
      { cwd, encoding: "utf-8", timeout: 30000 }
    );
    return result.trim();
  } catch {
    return null;
  }
}

export function ghPRStatus(prNumber: string, repo?: string): Record<string, unknown> | null {
  try {
    const repoArg = repo ? `--repo "${repo}"` : "";
    const result = execSync(
      `gh pr view ${prNumber} --json number,title,state,mergeable,reviewDecision,statusCheckRollup,url ${repoArg}`,
      { encoding: "utf-8", timeout: 30000 }
    );
    return JSON.parse(result);
  } catch {
    return null;
  }
}
