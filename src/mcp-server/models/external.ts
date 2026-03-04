export type ExternalProvider = "github" | "linear" | "jira";

export interface ExternalIssue {
  provider: ExternalProvider;
  externalId: string;
  title: string;
  description: string;
  status: string;
  url: string;
  labels: string[];
  assignee: string | null;
}
