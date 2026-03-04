import { nanoid } from "nanoid";

export function generateId(prefix?: string): string {
  const id = nanoid(12);
  return prefix ? `${prefix}_${id}` : id;
}

export function generateTaskId(): string {
  return generateId("t");
}

export function generateBoardId(): string {
  return generateId("b");
}

export function generateSessionId(): string {
  return generateId("s");
}
