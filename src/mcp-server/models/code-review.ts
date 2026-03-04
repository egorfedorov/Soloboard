export type ReviewVerdict = "approved" | "changes_requested" | "needs_discussion";
export type FindingSeverity = "info" | "warning" | "error" | "critical";
export type FindingCategory = "bug" | "style" | "performance" | "security" | "todo" | "type_error" | "missing_test";
export type FindingResponse = "fixed" | "wont_fix" | "acknowledged";

export interface ReviewFinding {
  id: number;
  file: string;
  line: number | null;
  severity: FindingSeverity;
  category: FindingCategory;
  message: string;
  response: FindingResponse | null;
}

export interface CodeReviewResult {
  id: string;
  taskId: string;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  filesReviewed: string[];
  summary: string;
  reviewedAt: string;
}

export function createCodeReview(
  id: string,
  taskId: string,
  verdict: ReviewVerdict,
  findings: ReviewFinding[],
  filesReviewed: string[],
  summary: string
): CodeReviewResult {
  return {
    id,
    taskId,
    verdict,
    findings,
    filesReviewed,
    summary,
    reviewedAt: new Date().toISOString(),
  };
}
