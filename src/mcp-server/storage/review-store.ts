import { Store } from "./store.js";
import { CodeReviewResult, ReviewFinding, FindingResponse, createCodeReview, ReviewVerdict } from "../models/code-review.js";
import { generateReviewId } from "../utils/id.js";

export class ReviewStore {
  constructor(private store: Store) {}

  async create(
    taskId: string,
    verdict: ReviewVerdict,
    findings: ReviewFinding[],
    filesReviewed: string[],
    summary: string
  ): Promise<CodeReviewResult> {
    const id = generateReviewId();
    const review = createCodeReview(id, taskId, verdict, findings, filesReviewed, summary);
    await this.store.writeJson(this.store.reviewPath(id), review);
    return review;
  }

  async get(reviewId: string): Promise<CodeReviewResult | null> {
    return this.store.readJson<CodeReviewResult>(this.store.reviewPath(reviewId));
  }

  async update(reviewId: string, updates: Partial<Omit<CodeReviewResult, "id" | "reviewedAt">>): Promise<CodeReviewResult | null> {
    const review = await this.get(reviewId);
    if (!review) return null;
    const updated: CodeReviewResult = { ...review, ...updates };
    await this.store.writeJson(this.store.reviewPath(reviewId), updated);
    return updated;
  }

  async list(): Promise<CodeReviewResult[]> {
    const files = await this.store.listFiles(this.store.reviewsDir);
    const reviews: CodeReviewResult[] = [];
    for (const file of files) {
      const r = await this.store.readJson<CodeReviewResult>(`${this.store.reviewsDir}/${file}`);
      if (r) reviews.push(r);
    }
    return reviews.sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
  }

  async findByTask(taskId: string): Promise<CodeReviewResult[]> {
    const all = await this.list();
    return all.filter((r) => r.taskId === taskId);
  }

  async respondToFinding(reviewId: string, findingId: number, response: FindingResponse): Promise<CodeReviewResult | null> {
    const review = await this.get(reviewId);
    if (!review) return null;
    const finding = review.findings.find((f) => f.id === findingId);
    if (!finding) return null;
    finding.response = response;
    await this.store.writeJson(this.store.reviewPath(reviewId), review);
    return review;
  }
}
