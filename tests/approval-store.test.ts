import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/mcp-server/storage/store.js';
import { ApprovalStore } from '../src/mcp-server/storage/approval-store.js';

let tmpDir: string;
let store: Store;
let approvalStore: ApprovalStore;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'soloboard-approval-test-'));
  store = new Store(tmpDir);
  await store.init();
  approvalStore = new ApprovalStore(store);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('ApprovalStore', () => {
  describe('create', () => {
    it('creates approval with correct fields', async () => {
      const approval = await approvalStore.create(
        'deploy',
        'Deploy to production',
        'agent-1',
        't_task1'
      );

      expect(approval.id).toMatch(/^ap_/);
      expect(approval.action).toBe('deploy');
      expect(approval.description).toBe('Deploy to production');
      expect(approval.requestedBy).toBe('agent-1');
      expect(approval.taskId).toBe('t_task1');
      expect(approval.status).toBe('pending');
      expect(approval.reason).toBeNull();
      expect(approval.resolvedBy).toBeNull();
      expect(approval.createdAt).toBeDefined();
      expect(approval.resolvedAt).toBeNull();
    });

    it('creates approval without taskId', async () => {
      const approval = await approvalStore.create(
        'config_change',
        'Change deploy target',
        'agent-1',
        null
      );

      expect(approval.taskId).toBeNull();
    });

    it('persists approval to disk', async () => {
      const approval = await approvalStore.create(
        'deploy',
        'Deploy to prod',
        'agent-1',
        't_task1'
      );
      const loaded = await store.readJson(store.approvalPath(approval.id));
      expect(loaded).toEqual(approval);
    });
  });

  describe('get', () => {
    it('returns approval by ID', async () => {
      const created = await approvalStore.create('deploy', 'Deploy', 'agent-1', null);
      const retrieved = await approvalStore.get(created.id);
      expect(retrieved).toEqual(created);
    });

    it('returns null for missing approval', async () => {
      const result = await approvalStore.get('ap_nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('returns all approvals sorted by createdAt descending', async () => {
      await approvalStore.create('deploy', 'First', 'agent-1', null);
      await approvalStore.create('review', 'Second', 'agent-2', null);
      await approvalStore.create('config', 'Third', 'agent-3', null);

      const approvals = await approvalStore.list();
      expect(approvals).toHaveLength(3);

      // Sorted by createdAt descending (newest first)
      for (let i = 0; i < approvals.length - 1; i++) {
        expect(approvals[i].createdAt >= approvals[i + 1].createdAt).toBe(true);
      }
    });

    it('returns empty array when no approvals', async () => {
      const approvals = await approvalStore.list();
      expect(approvals).toEqual([]);
    });
  });

  describe('listPending', () => {
    it('returns only pending approvals', async () => {
      const a1 = await approvalStore.create('deploy', 'Pending 1', 'agent-1', null);
      const a2 = await approvalStore.create('review', 'Will resolve', 'agent-2', null);
      await approvalStore.create('config', 'Pending 2', 'agent-3', null);

      // Resolve one approval
      await approvalStore.resolve(a2.id, 'approved', 'LGTM', 'user');

      const pending = await approvalStore.listPending();
      expect(pending).toHaveLength(2);
      expect(pending.every(a => a.status === 'pending')).toBe(true);
      expect(pending.map(a => a.id)).not.toContain(a2.id);
    });
  });

  describe('resolve', () => {
    it('approves with reason', async () => {
      const approval = await approvalStore.create('deploy', 'Deploy', 'agent-1', null);
      const resolved = await approvalStore.resolve(approval.id, 'approved', 'Looks good', 'reviewer');

      expect(resolved).not.toBeNull();
      expect(resolved!.status).toBe('approved');
      expect(resolved!.reason).toBe('Looks good');
      expect(resolved!.resolvedBy).toBe('reviewer');
      expect(resolved!.resolvedAt).toBeDefined();
    });

    it('rejects with reason', async () => {
      const approval = await approvalStore.create('deploy', 'Deploy', 'agent-1', null);
      const resolved = await approvalStore.resolve(approval.id, 'rejected', 'Not ready', 'reviewer');

      expect(resolved).not.toBeNull();
      expect(resolved!.status).toBe('rejected');
      expect(resolved!.reason).toBe('Not ready');
    });

    it('returns null for missing approval', async () => {
      const result = await approvalStore.resolve('ap_missing', 'approved', 'ok', 'user');
      expect(result).toBeNull();
    });

    it('persists resolved status to disk', async () => {
      const approval = await approvalStore.create('deploy', 'Deploy', 'agent-1', null);
      await approvalStore.resolve(approval.id, 'approved', 'Ship it', 'reviewer');

      const loaded = await approvalStore.get(approval.id);
      expect(loaded!.status).toBe('approved');
      expect(loaded!.reason).toBe('Ship it');
    });
  });
});
