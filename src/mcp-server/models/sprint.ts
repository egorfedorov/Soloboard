export type SprintStatus = "planning" | "active" | "completed";

export interface Sprint {
  id: string;
  name: string;
  projectId: string;
  taskIds: string[];
  startDate: string;
  endDate: string;
  status: SprintStatus;
  createdAt: string;
  updatedAt: string;
}

export function createSprint(
  id: string,
  name: string,
  projectId: string,
  durationDays: number = 7
): Sprint {
  const now = new Date();
  const end = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
  return {
    id,
    name,
    projectId,
    taskIds: [],
    startDate: now.toISOString(),
    endDate: end.toISOString(),
    status: "planning",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
