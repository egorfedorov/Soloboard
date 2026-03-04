import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/mcp-server/storage/store.js';
import { TeamStore } from '../src/mcp-server/storage/team-store.js';

let tmpDir: string;
let store: Store;
let teamStore: TeamStore;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'soloboard-team-test-'));
  store = new Store(tmpDir);
  await store.init();
  teamStore = new TeamStore(store);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('TeamStore', () => {
  describe('add', () => {
    it('creates team member with correct fields', async () => {
      const member = await teamStore.add('Alice', 'developer', ['typescript', 'react']);

      expect(member.id).toMatch(/^tm_/);
      expect(member.name).toBe('Alice');
      expect(member.role).toBe('developer');
      expect(member.skills).toEqual(['typescript', 'react']);
      expect(member.activeTaskIds).toEqual([]);
      expect(member.stats).toEqual({
        tasksCompleted: 0,
        tasksAssigned: 0,
        averageCompletionMinutes: 0,
      });
      expect(member.createdAt).toBeDefined();
    });

    it('persists member to disk', async () => {
      const member = await teamStore.add('Bob', 'qa_agent', ['testing']);
      const loaded = await store.readJson(store.teamMemberPath(member.id));
      expect(loaded).toEqual(member);
    });
  });

  describe('get', () => {
    it('returns member by ID', async () => {
      const created = await teamStore.add('Alice', 'developer', ['typescript']);
      const retrieved = await teamStore.get(created.id);
      expect(retrieved).toEqual(created);
    });

    it('returns null for missing member', async () => {
      const result = await teamStore.get('tm_nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('returns all members', async () => {
      await teamStore.add('Alice', 'developer', ['typescript']);
      await teamStore.add('Bob', 'qa_agent', ['testing']);
      await teamStore.add('Carol', 'tech_lead', ['architecture']);

      const members = await teamStore.list();
      expect(members).toHaveLength(3);
    });

    it('returns empty array when no members exist', async () => {
      const members = await teamStore.list();
      expect(members).toEqual([]);
    });
  });

  describe('findByRole', () => {
    it('returns members matching role', async () => {
      await teamStore.add('Alice', 'developer', ['typescript']);
      await teamStore.add('Bob', 'developer', ['python']);
      await teamStore.add('Carol', 'qa_agent', ['testing']);

      const developers = await teamStore.findByRole('developer');
      expect(developers).toHaveLength(2);
      expect(developers.every(m => m.role === 'developer')).toBe(true);
    });

    it('returns empty array when no match', async () => {
      await teamStore.add('Alice', 'developer', ['typescript']);
      const leads = await teamStore.findByRole('tech_lead');
      expect(leads).toEqual([]);
    });
  });

  describe('findBySkill', () => {
    it('returns members with matching skill (case-insensitive, substring)', async () => {
      await teamStore.add('Alice', 'developer', ['TypeScript', 'React']);
      await teamStore.add('Bob', 'developer', ['Python', 'Django']);
      await teamStore.add('Carol', 'qa_agent', ['typescript-testing']);

      const tsMembers = await teamStore.findBySkill('typescript');
      expect(tsMembers).toHaveLength(2);
    });

    it('returns empty array when no match', async () => {
      await teamStore.add('Alice', 'developer', ['typescript']);
      const rustMembers = await teamStore.findBySkill('rust');
      expect(rustMembers).toEqual([]);
    });
  });

  describe('assignTask', () => {
    it('increments tasksAssigned and adds to activeTaskIds', async () => {
      const member = await teamStore.add('Alice', 'developer', ['typescript']);

      const updated = await teamStore.assignTask(member.id, 't_task1');
      expect(updated).not.toBeNull();
      expect(updated!.activeTaskIds).toContain('t_task1');
      expect(updated!.stats.tasksAssigned).toBe(1);
    });

    it('does not duplicate task assignment', async () => {
      const member = await teamStore.add('Alice', 'developer', ['typescript']);
      await teamStore.assignTask(member.id, 't_task1');
      await teamStore.assignTask(member.id, 't_task1');

      const loaded = await teamStore.get(member.id);
      expect(loaded!.activeTaskIds).toEqual(['t_task1']);
    });

    it('returns null for missing member', async () => {
      const result = await teamStore.assignTask('tm_missing', 't_task1');
      expect(result).toBeNull();
    });

    it('can assign multiple tasks', async () => {
      const member = await teamStore.add('Alice', 'developer', ['typescript']);
      await teamStore.assignTask(member.id, 't_task1');
      await teamStore.assignTask(member.id, 't_task2');

      const loaded = await teamStore.get(member.id);
      expect(loaded!.activeTaskIds).toEqual(['t_task1', 't_task2']);
      expect(loaded!.stats.tasksAssigned).toBe(2);
    });
  });

  describe('completeTask', () => {
    it('increments tasksCompleted and removes from activeTaskIds', async () => {
      const member = await teamStore.add('Alice', 'developer', ['typescript']);
      await teamStore.assignTask(member.id, 't_task1');

      const updated = await teamStore.completeTask(member.id, 't_task1', 30);
      expect(updated).not.toBeNull();
      expect(updated!.activeTaskIds).not.toContain('t_task1');
      expect(updated!.stats.tasksCompleted).toBe(1);
      expect(updated!.stats.averageCompletionMinutes).toBe(30);
    });

    it('calculates running average of completion time', async () => {
      const member = await teamStore.add('Alice', 'developer', ['typescript']);
      await teamStore.assignTask(member.id, 't_task1');
      await teamStore.assignTask(member.id, 't_task2');

      await teamStore.completeTask(member.id, 't_task1', 20);
      const after2 = await teamStore.completeTask(member.id, 't_task2', 40);

      expect(after2!.stats.tasksCompleted).toBe(2);
      // (0 * 0 + 20) / 1 = 20, then (20 * 1 + 40) / 2 = 30
      expect(after2!.stats.averageCompletionMinutes).toBe(30);
    });

    it('returns null for missing member', async () => {
      const result = await teamStore.completeTask('tm_missing', 't_task1', 30);
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes member', async () => {
      const member = await teamStore.add('Alice', 'developer', ['typescript']);
      const result = await teamStore.delete(member.id);
      expect(result).toBe(true);

      const retrieved = await teamStore.get(member.id);
      expect(retrieved).toBeNull();
    });

    it('returns false for non-existent member', async () => {
      const result = await teamStore.delete('tm_missing');
      expect(result).toBe(false);
    });
  });
});
