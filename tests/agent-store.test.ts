import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/mcp-server/storage/store.js';
import { AgentStore } from '../src/mcp-server/storage/agent-store.js';

let tmpDir: string;
let store: Store;
let agentStore: AgentStore;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'soloboard-agent-test-'));
  store = new Store(tmpDir);
  await store.init();
  agentStore = new AgentStore(store);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('AgentStore', () => {
  describe('register', () => {
    it('creates agent with correct fields', async () => {
      const agent = await agentStore.register('session-1', 'Agent Alpha');

      expect(agent.id).toMatch(/^ag_/);
      expect(agent.sessionId).toBe('session-1');
      expect(agent.name).toBe('Agent Alpha');
      expect(agent.status).toBe('active');
      expect(agent.activeTaskId).toBeNull();
      expect(agent.lockedFiles).toEqual([]);
      expect(agent.metrics).toEqual({
        tasksCompleted: 0,
        filesModified: 0,
        totalActiveSeconds: 0,
      });
      expect(agent.lastHeartbeat).toBeDefined();
      expect(agent.registeredAt).toBeDefined();
    });

    it('persists agent to disk', async () => {
      const agent = await agentStore.register('session-1', 'Agent Alpha');
      const loaded = await store.readJson(store.agentPath(agent.id));
      expect(loaded).toEqual(agent);
    });
  });

  describe('get', () => {
    it('returns agent by ID', async () => {
      const created = await agentStore.register('session-1', 'Agent Alpha');
      const retrieved = await agentStore.get(created.id);
      expect(retrieved).toEqual(created);
    });

    it('returns null for missing agent', async () => {
      const result = await agentStore.get('ag_nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('heartbeat', () => {
    it('updates lastHeartbeat timestamp', async () => {
      const agent = await agentStore.register('session-1', 'Agent Alpha');
      const originalHeartbeat = agent.lastHeartbeat;

      // Wait briefly to ensure timestamp differs
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = await agentStore.heartbeat(agent.id);
      expect(updated).not.toBeNull();
      expect(new Date(updated!.lastHeartbeat).getTime())
        .toBeGreaterThanOrEqual(new Date(originalHeartbeat).getTime());
      expect(updated!.status).toBe('active');
    });

    it('returns null for missing agent', async () => {
      const result = await agentStore.heartbeat('ag_missing');
      expect(result).toBeNull();
    });
  });

  describe('cleanupStale', () => {
    it('marks agents with old heartbeats as disconnected', async () => {
      const agent = await agentStore.register('session-1', 'Stale Agent');

      // Manually set lastHeartbeat to 10 minutes ago
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      await agentStore.update(agent.id, { lastHeartbeat: tenMinutesAgo });

      const staleIds = await agentStore.cleanupStale();
      expect(staleIds).toContain(agent.id);

      const updated = await agentStore.get(agent.id);
      expect(updated!.status).toBe('disconnected');
    });

    it('does not mark recent agents as stale', async () => {
      await agentStore.register('session-1', 'Fresh Agent');

      const staleIds = await agentStore.cleanupStale();
      expect(staleIds).toHaveLength(0);
    });

    it('does not re-mark already disconnected agents', async () => {
      const agent = await agentStore.register('session-1', 'Already Disconnected');
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      await agentStore.update(agent.id, { lastHeartbeat: tenMinutesAgo, status: 'disconnected' });

      const staleIds = await agentStore.cleanupStale();
      expect(staleIds).toHaveLength(0);
    });
  });

  describe('list', () => {
    it('returns all agents', async () => {
      await agentStore.register('session-1', 'Agent A');
      await agentStore.register('session-2', 'Agent B');
      await agentStore.register('session-3', 'Agent C');

      const agents = await agentStore.list();
      expect(agents).toHaveLength(3);
    });

    it('returns empty array when no agents exist', async () => {
      const agents = await agentStore.list();
      expect(agents).toEqual([]);
    });
  });

  describe('listActive', () => {
    it('returns only active and idle agents', async () => {
      const a1 = await agentStore.register('session-1', 'Active Agent');
      const a2 = await agentStore.register('session-2', 'Idle Agent');
      const a3 = await agentStore.register('session-3', 'Disconnected Agent');

      await agentStore.update(a2.id, { status: 'idle' });
      await agentStore.update(a3.id, { status: 'disconnected' });

      const active = await agentStore.listActive();
      expect(active).toHaveLength(2);
      expect(active.map(a => a.id).sort()).toEqual([a1.id, a2.id].sort());
    });
  });

  describe('delete', () => {
    it('removes agent', async () => {
      const agent = await agentStore.register('session-1', 'Delete Me');
      const result = await agentStore.delete(agent.id);
      expect(result).toBe(true);

      const retrieved = await agentStore.get(agent.id);
      expect(retrieved).toBeNull();
    });

    it('returns false for non-existent agent', async () => {
      const result = await agentStore.delete('ag_missing');
      expect(result).toBe(false);
    });
  });
});
