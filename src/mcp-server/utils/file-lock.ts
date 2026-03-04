import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "../storage/store.js";

export interface FileLock {
  filePath: string;
  agentId: string;
  lockedAt: string;
}

function hashPath(filePath: string): string {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 16);
}

export async function acquireLock(
  store: Store,
  filePath: string,
  agentId: string
): Promise<{ ok: boolean; holder?: string }> {
  const lockPath = path.join(store.root, "locks", `${hashPath(filePath)}.lock.json`);
  const existing = await store.readJson<FileLock>(lockPath);
  if (existing && existing.agentId !== agentId) {
    return { ok: false, holder: existing.agentId };
  }
  const lock: FileLock = { filePath, agentId, lockedAt: new Date().toISOString() };
  await store.writeJson(lockPath, lock);
  return { ok: true };
}

export async function releaseLock(
  store: Store,
  filePath: string,
  agentId: string
): Promise<boolean> {
  const lockPath = path.join(store.root, "locks", `${hashPath(filePath)}.lock.json`);
  const existing = await store.readJson<FileLock>(lockPath);
  if (!existing || existing.agentId !== agentId) return false;
  await store.deleteFile(lockPath);
  return true;
}

export async function releaseAllLocks(store: Store, agentId: string): Promise<number> {
  const locksDir = path.join(store.root, "locks");
  const files = await store.listFiles(locksDir);
  let released = 0;
  for (const file of files) {
    const lock = await store.readJson<FileLock>(path.join(locksDir, file));
    if (lock && lock.agentId === agentId) {
      await store.deleteFile(path.join(locksDir, file));
      released++;
    }
  }
  return released;
}

export async function checkLocks(
  store: Store,
  filePaths: string[],
  agentId: string
): Promise<{ conflicts: Array<{ filePath: string; holder: string }> }> {
  const conflicts: Array<{ filePath: string; holder: string }> = [];
  const locksDir = path.join(store.root, "locks");
  for (const fp of filePaths) {
    const lockPath = path.join(locksDir, `${hashPath(fp)}.lock.json`);
    const lock = await store.readJson<FileLock>(lockPath);
    if (lock && lock.agentId !== agentId) {
      conflicts.push({ filePath: fp, holder: lock.agentId });
    }
  }
  return { conflicts };
}

export async function listAllLocks(store: Store): Promise<FileLock[]> {
  const locksDir = path.join(store.root, "locks");
  const files = await store.listFiles(locksDir);
  const locks: FileLock[] = [];
  for (const file of files) {
    const lock = await store.readJson<FileLock>(path.join(locksDir, file));
    if (lock) locks.push(lock);
  }
  return locks;
}
