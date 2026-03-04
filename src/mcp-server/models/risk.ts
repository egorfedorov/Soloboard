export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskFactor {
  name: string;
  description: string;
  severity: RiskLevel;
}

export interface RiskAssessment {
  taskId: string;
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
  mitigations: string[];
  assessedAt: string;
}
