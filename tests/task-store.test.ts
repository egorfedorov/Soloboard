import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/mcp-server/storage/store.js';
import { TaskStore } from '../src/mcp-server/storage/task-store.js';

let tmpDir: string;
let store: Store;
let taskStore: TaskStore;

const PROJECT_ID = 'test-project';

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'soloboard-task-test-'));
  store = new Store(tmpDir);
  await store.init();
  taskStore = new TaskStore(store);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('TaskStore', () => {
  describe('create', () => {
    it('returns task with correct fields', async () => {
      const task = await taskStore.create('Fix login bug', PROJECT_ID, {
        description: 'Login fails on Safari',
        priority: 'high',
        tags: ['bug', 'auth'],
      });

      expect(task.id).toMatch(/^t_/);
      expect(task.title).toBe('Fix login bug');
      expect(task.description).toBe('Login fails on Safari');
      expect(task.status).toBe('todo');
      expect(task.priority).toBe('high');
      expect(task.projectId).toBe(PROJECT_ID);
      expect(task.tags).toEqual(['bug', 'auth']);
      expect(task.createdAt).toBeDefined();
      expect(task.updatedAt).toBeDefined();
      expect(task.completedAt).toBeNull();
      expect(task.commits).toEqual([]);
      expect(task.files).toEqual([]);
      expect(task.timeLog).toEqual([]);
      expect(task.totalSeconds).toBe(0);
    });

    it('uses default values when no opts provided', async () => {
      const task = await taskStore.create('Simple task', PROJECT_ID);

      expect(task.description).toBe('');
      expect(task.priority).toBe('medium');
      expect(task.tags).toEqual([]);
      expect(task.branch).toBeNull();
    });

    it('persists task to disk', async () => {
      const task = await taskStore.create('Persisted task', PROJECT_ID);
      const loaded = await store.readJson(store.taskPath(task.id));
      expect(loaded).toEqual(task);
    });
  });

  describe('get', () => {
    it('returns task by ID', async () => {
      const created = await taskStore.create('Test task', PROJECT_ID);
      const retrieved = await taskStore.get(created.id);

      expect(retrieved).toEqual(created);
    });

    it('returns null for missing task', async () => {
      const result = await taskStore.get('t_nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('modifies fields', async () => {
      const task = await taskStore.create('Original title', PROJECT_ID);
      const updated = await taskStore.update(task.id, {
        title: 'Updated title',
        description: 'New description',
        priority: 'high',
      });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('Updated title');
      expect(updated!.description).toBe('New description');
      expect(updated!.priority).toBe('high');
      expect(updated!.updatedAt).not.toBe(task.updatedAt);
    });

    it('returns null for non-existent task', async () => {
      const result = await taskStore.update('t_missing', { title: 'nope' });
      expect(result).toBeNull();
    });

    it('handles status transition to doing (starts time tracking)', async () => {
      const task = await taskStore.create('Time test', PROJECT_ID);
      const updated = await taskStore.update(task.id, { status: 'doing' });

      expect(updated!.status).toBe('doing');
      expect(updated!.timeLog).toHaveLength(1);
      expect(updated!.timeLog[0].start).toBeDefined();
      expect(updated!.timeLog[0].end).toBeNull();
    });

    it('handles status transition from doing to done (stops time tracking)', async () => {
      const task = await taskStore.create('Time test', PROJECT_ID);
      await taskStore.update(task.id, { status: 'doing' });

      // Small delay so elapsed time is measurable
      const done = await taskStore.update(task.id, { status: 'done' });

      expect(done!.status).toBe('done');
      expect(done!.timeLog).toHaveLength(1);
      expect(done!.timeLog[0].end).not.toBeNull();
      expect(done!.completedAt).toBeDefined();
      expect(done!.totalSeconds).toBeGreaterThanOrEqual(0);
    });

    it('handles status transition from doing back to todo', async () => {
      const task = await taskStore.create('Paused task', PROJECT_ID);
      await taskStore.update(task.id, { status: 'doing' });
      const paused = await taskStore.update(task.id, { status: 'todo' });

      expect(paused!.status).toBe('todo');
      expect(paused!.timeLog).toHaveLength(1);
      expect(paused!.timeLog[0].end).not.toBeNull();
    });
  });

  describe('delete', () => {
    it('removes task', async () => {
      const task = await taskStore.create('Delete me', PROJECT_ID);
      const result = await taskStore.delete(task.id);
      expect(result).toBe(true);

      const retrieved = await taskStore.get(task.id);
      expect(retrieved).toBeNull();
    });

    it('returns false for non-existent task', async () => {
      const result = await taskStore.delete('t_missing');
      expect(result).toBe(false);
    });
  });

  describe('list', () => {
    it('returns all tasks for project', async () => {
      await taskStore.create('Task 1', PROJECT_ID);
      await taskStore.create('Task 2', PROJECT_ID);
      await taskStore.create('Task 3', PROJECT_ID);

      const tasks = await taskStore.list(PROJECT_ID);
      expect(tasks).toHaveLength(3);
    });

    it('filters by projectId', async () => {
      await taskStore.create('Task A', 'project-a');
      await taskStore.create('Task B', 'project-b');
      await taskStore.create('Task C', 'project-a');

      const tasksA = await taskStore.list('project-a');
      expect(tasksA).toHaveLength(2);
      expect(tasksA.every(t => t.projectId === 'project-a')).toBe(true);

      const tasksB = await taskStore.list('project-b');
      expect(tasksB).toHaveLength(1);
      expect(tasksB[0].projectId).toBe('project-b');
    });

    it('returns all tasks when no projectId given', async () => {
      await taskStore.create('Task A', 'project-a');
      await taskStore.create('Task B', 'project-b');

      const allTasks = await taskStore.list();
      expect(allTasks).toHaveLength(2);
    });

    it('returns empty array when no tasks exist', async () => {
      const tasks = await taskStore.list(PROJECT_ID);
      expect(tasks).toEqual([]);
    });
  });

  describe('archive', () => {
    it('moves task to archive directory', async () => {
      const task = await taskStore.create('Archive me', PROJECT_ID);
      const result = await taskStore.archive(task.id);
      expect(result).toBe(true);

      // Not in tasks anymore
      const fromTasks = await taskStore.get(task.id);
      expect(fromTasks).toBeNull();

      // Is in archive
      const fromArchive = await store.readJson(store.archivePath(task.id));
      expect(fromArchive).not.toBeNull();
    });

    it('returns false for non-existent task', async () => {
      const result = await taskStore.archive('t_missing');
      expect(result).toBe(false);
    });
  });

  describe('findByTitle', () => {
    it('finds exact match (case-insensitive)', async () => {
      await taskStore.create('Fix Login Bug', PROJECT_ID);
      await taskStore.create('Add signup page', PROJECT_ID);

      const found = await taskStore.findByTitle('fix login bug', PROJECT_ID);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Fix Login Bug');
    });

    it('finds fuzzy (substring) match', async () => {
      await taskStore.create('Fix the login bug in Safari', PROJECT_ID);

      const found = await taskStore.findByTitle('login bug', PROJECT_ID);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Fix the login bug in Safari');
    });

    it('returns null when no match', async () => {
      await taskStore.create('Fix login bug', PROJECT_ID);
      const found = await taskStore.findByTitle('signup', PROJECT_ID);
      expect(found).toBeNull();
    });

    it('prefers exact match over fuzzy match', async () => {
      await taskStore.create('Login Bug', PROJECT_ID);
      await taskStore.create('Fix Login Bug in Safari', PROJECT_ID);

      const found = await taskStore.findByTitle('login bug', PROJECT_ID);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Login Bug');
    });
  });

  describe('resolve', () => {
    it('resolves by exact ID', async () => {
      const task = await taskStore.create('Resolve test', PROJECT_ID);
      const found = await taskStore.resolve(task.id);
      expect(found).toEqual(task);
    });

    it('resolves by title when ID not found', async () => {
      await taskStore.create('My special task', PROJECT_ID);
      const found = await taskStore.resolve('my special task', PROJECT_ID);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('My special task');
    });

    it('returns null when nothing matches', async () => {
      const found = await taskStore.resolve('nonexistent', PROJECT_ID);
      expect(found).toBeNull();
    });
  });

  describe('addFile', () => {
    it('adds file path to task', async () => {
      const task = await taskStore.create('File test', PROJECT_ID);
      const updated = await taskStore.addFile(task.id, 'src/index.ts');

      expect(updated).not.toBeNull();
      expect(updated!.files).toContain('src/index.ts');
    });

    it('does not duplicate file paths', async () => {
      const task = await taskStore.create('File test', PROJECT_ID);
      await taskStore.addFile(task.id, 'src/index.ts');
      await taskStore.addFile(task.id, 'src/index.ts');

      const loaded = await taskStore.get(task.id);
      expect(loaded!.files).toEqual(['src/index.ts']);
    });

    it('returns null for non-existent task', async () => {
      const result = await taskStore.addFile('t_missing', 'src/index.ts');
      expect(result).toBeNull();
    });
  });

  describe('addCommit', () => {
    it('adds commit SHA to task', async () => {
      const task = await taskStore.create('Commit test', PROJECT_ID);
      const updated = await taskStore.addCommit(task.id, 'abc123');

      expect(updated).not.toBeNull();
      expect(updated!.commits).toContain('abc123');
    });

    it('does not duplicate commit SHAs', async () => {
      const task = await taskStore.create('Commit test', PROJECT_ID);
      await taskStore.addCommit(task.id, 'abc123');
      await taskStore.addCommit(task.id, 'abc123');

      const loaded = await taskStore.get(task.id);
      expect(loaded!.commits).toEqual(['abc123']);
    });

    it('returns null for non-existent task', async () => {
      const result = await taskStore.addCommit('t_missing', 'abc123');
      expect(result).toBeNull();
    });
  });
});
