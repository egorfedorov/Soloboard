import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface FileMatch {
  file: string;
  reason: string;
}

export interface ProjectAnalysis {
  relatedFiles: FileMatch[];
  recentChanges: Array<{ sha: string; message: string; date: string }>;
  hasTests: boolean;
  testFiles: string[];
  suggestedApproach: string[];
  autoTags: string[];
  suggestedPriority: "low" | "medium" | "high";
  smartTitle: string;
}

/** Extract meaningful keywords from a prompt */
export function extractKeywords(prompt: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "must", "to", "of",
    "in", "for", "on", "with", "at", "by", "from", "as", "into", "through",
    "it", "its", "this", "that", "these", "those", "i", "we", "you", "they",
    "me", "us", "him", "her", "them", "my", "our", "your", "his", "their",
    "and", "or", "but", "not", "no", "so", "if", "then", "than", "too",
    "very", "just", "also", "like", "make", "get", "let", "fix", "add",
    "update", "change", "create", "remove", "delete", "please", "want",
  ]);

  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\-_./]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  return [...new Set(words)];
}

/** Find files in the project matching keywords */
export function findRelatedFiles(projectRoot: string, keywords: string[], limit: number = 10): FileMatch[] {
  const results: FileMatch[] = [];

  for (const keyword of keywords) {
    try {
      // Search filenames
      const fileOutput = execSync(
        `find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.kanban/*' -iname '*${keyword}*' 2>/dev/null | head -5`,
        { cwd: projectRoot, encoding: "utf-8", timeout: 5000 }
      ).trim();

      if (fileOutput) {
        for (const f of fileOutput.split("\n")) {
          if (f && !results.some((r) => r.file === f)) {
            results.push({ file: f, reason: `filename matches "${keyword}"` });
          }
        }
      }
    } catch { /* ignore */ }

    try {
      // Search file contents (grep)
      const grepOutput = execSync(
        `grep -rl --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.py' --include='*.cpp' --include='*.h' --include='*.rs' --include='*.go' -i '${keyword}' . 2>/dev/null | grep -v node_modules | grep -v dist | grep -v .kanban | head -5`,
        { cwd: projectRoot, encoding: "utf-8", timeout: 5000 }
      ).trim();

      if (grepOutput) {
        for (const f of grepOutput.split("\n")) {
          if (f && !results.some((r) => r.file === f)) {
            results.push({ file: f, reason: `contains "${keyword}"` });
          }
        }
      }
    } catch { /* ignore */ }

    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}

/** Find test files related to keywords */
export function findTestFiles(projectRoot: string, keywords: string[]): string[] {
  const testFiles: string[] = [];
  for (const keyword of keywords) {
    try {
      const output = execSync(
        `find . -type f \\( -name '*.test.*' -o -name '*.spec.*' -o -name 'test_*' -o -path '*/tests/*' -o -path '*/test/*' \\) -not -path '*/node_modules/*' -not -path '*/dist/*' 2>/dev/null | grep -i '${keyword}' | head -5`,
        { cwd: projectRoot, encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (output) {
        for (const f of output.split("\n")) {
          if (f && !testFiles.includes(f)) testFiles.push(f);
        }
      }
    } catch { /* ignore */ }
  }
  return testFiles;
}

/** Get recent git changes related to keywords */
export function getRelatedCommits(
  projectRoot: string,
  keywords: string[],
  limit: number = 5
): Array<{ sha: string; message: string; date: string }> {
  const results: Array<{ sha: string; message: string; date: string }> = [];
  for (const keyword of keywords) {
    try {
      const output = execSync(
        `git log --all --oneline --format='%h|%s|%ad' --date=short -10 --grep='${keyword}' 2>/dev/null`,
        { cwd: projectRoot, encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (output) {
        for (const line of output.split("\n")) {
          const [sha, message, date] = line.split("|");
          if (sha && !results.some((r) => r.sha === sha)) {
            results.push({ sha, message: message || "", date: date || "" });
          }
        }
      }
    } catch { /* ignore */ }
    if (results.length >= limit) break;
  }
  return results.slice(0, limit);
}

/** Get files changed frequently (hotspots) */
export function getHotspots(projectRoot: string, limit: number = 10): Array<{ file: string; changes: number }> {
  try {
    const output = execSync(
      `git log --all --name-only --format='' -100 2>/dev/null | grep -v '^$' | sort | uniq -c | sort -rn | head -${limit}`,
      { cwd: projectRoot, encoding: "utf-8", timeout: 5000 }
    ).trim();
    if (!output) return [];
    return output.split("\n").map((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      return { file: match[2], changes: parseInt(match[1]) };
    }).filter(Boolean) as Array<{ file: string; changes: number }>;
  } catch {
    return [];
  }
}

/** Auto-detect tags from keywords and file types */
export function detectTags(keywords: string[], relatedFiles: FileMatch[]): string[] {
  const tags: string[] = [];
  const keywordSet = new Set(keywords.map((k) => k.toLowerCase()));

  // Topic-based tags
  const topicMap: Record<string, string[]> = {
    performance: ["slow", "fast", "optimize", "perf", "latency", "speed", "cache"],
    bug: ["bug", "fix", "broken", "crash", "error", "issue", "wrong"],
    feature: ["feature", "new", "implement", "build", "design"],
    refactor: ["refactor", "clean", "restructure", "rewrite", "simplify"],
    security: ["auth", "login", "password", "token", "security", "permission", "access"],
    testing: ["test", "spec", "coverage", "mock"],
    ui: ["ui", "ux", "frontend", "css", "style", "layout", "component", "button"],
    api: ["api", "endpoint", "route", "rest", "graphql", "request", "response"],
    database: ["database", "db", "query", "migration", "schema", "sql", "model"],
    devops: ["deploy", "ci", "cd", "docker", "pipeline", "build"],
  };

  for (const [tag, triggers] of Object.entries(topicMap)) {
    if (triggers.some((t) => keywordSet.has(t) || keywords.some((k) => k.includes(t)))) {
      tags.push(tag);
    }
  }

  // File-type based tags
  const exts = relatedFiles.map((f) => path.extname(f.file).toLowerCase());
  if (exts.some((e) => [".tsx", ".jsx", ".svelte", ".vue"].includes(e))) tags.push("frontend");
  if (exts.some((e) => [".cpp", ".h", ".rs", ".go"].includes(e))) tags.push("backend");
  if (exts.some((e) => [".css", ".scss", ".less"].includes(e)) && !tags.includes("ui")) tags.push("ui");

  return [...new Set(tags)].slice(0, 5);
}

/** Suggest priority based on keywords and hotspot overlap */
export function suggestPriority(
  keywords: string[],
  relatedFiles: FileMatch[],
  hotspots: Array<{ file: string; changes: number }>
): "low" | "medium" | "high" {
  const keywordSet = new Set(keywords.map((k) => k.toLowerCase()));

  // High priority indicators
  const highPri = ["crash", "broken", "urgent", "critical", "security", "auth", "login", "payment", "prod", "production"];
  if (highPri.some((h) => keywordSet.has(h) || keywords.some((k) => k.includes(h)))) return "high";

  // Check if related files are hotspots
  const hotspotFiles = new Set(hotspots.slice(0, 5).map((h) => h.file));
  const hitCount = relatedFiles.filter((f) => {
    const clean = f.file.startsWith("./") ? f.file.slice(2) : f.file;
    return hotspotFiles.has(clean);
  }).length;
  if (hitCount >= 2) return "high";

  // Low priority indicators
  const lowPri = ["docs", "readme", "comment", "typo", "cleanup", "minor", "cosmetic"];
  if (lowPri.some((l) => keywordSet.has(l) || keywords.some((k) => k.includes(l)))) return "low";

  return "medium";
}

/** Generate a better title from a raw prompt */
export function generateSmartTitle(prompt: string): string {
  // Already short and good
  if (prompt.length <= 60) return prompt;

  // Remove filler phrases
  let title = prompt
    .replace(/^(please|can you|could you|i want to|i need to|we need to|let's|let us|hey|ok|okay)\s+/i, "")
    .replace(/\s+(please|thanks|thank you|asap|urgently)$/i, "")
    .trim();

  // Capitalize first letter
  title = title.charAt(0).toUpperCase() + title.slice(1);

  // Truncate if still long
  if (title.length > 80) {
    title = title.slice(0, 77) + "...";
  }

  return title;
}

/** Full project analysis for a task prompt */
export function analyzeForTask(projectRoot: string, prompt: string): ProjectAnalysis {
  const keywords = extractKeywords(prompt);
  const relatedFiles = findRelatedFiles(projectRoot, keywords);
  const recentChanges = getRelatedCommits(projectRoot, keywords);
  const testFiles = findTestFiles(projectRoot, keywords);
  const hotspots = getHotspots(projectRoot);
  const autoTags = detectTags(keywords, relatedFiles);
  const suggestedPriority = suggestPriority(keywords, relatedFiles, hotspots);
  const smartTitle = generateSmartTitle(prompt);

  // Generate suggested approach
  const suggestedApproach: string[] = [];
  if (relatedFiles.length > 0) {
    suggestedApproach.push(`Check ${relatedFiles.slice(0, 3).map((f) => f.file).join(", ")}`);
  }
  if (recentChanges.length > 0) {
    suggestedApproach.push(`Related commit: ${recentChanges[0].sha} "${recentChanges[0].message}"`);
  }
  if (testFiles.length > 0) {
    suggestedApproach.push(`Tests exist: ${testFiles.slice(0, 2).join(", ")}`);
  } else if (relatedFiles.length > 0) {
    suggestedApproach.push("No existing tests found — consider adding tests");
  }
  const hotspotHits = relatedFiles.filter((f) => {
    const clean = f.file.startsWith("./") ? f.file.slice(2) : f.file;
    return hotspots.some((h) => h.file === clean);
  });
  if (hotspotHits.length > 0) {
    suggestedApproach.push(`Hotspot files (frequently changed): ${hotspotHits.map((f) => f.file).join(", ")}`);
  }

  return {
    relatedFiles,
    recentChanges,
    hasTests: testFiles.length > 0,
    testFiles,
    suggestedApproach,
    autoTags,
    suggestedPriority,
    smartTitle,
  };
}
