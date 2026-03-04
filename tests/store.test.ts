import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/mcp-server/storage/store.js';
import { DEFAULT_CONFIG } from '../src/mcp-server/models/config.js';

let tmpDir: string;
let store: Store;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'soloboard-test-'));
  store = new Store(tmpDir);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('Store', () => {
  describe('init', () => {
    it('creates all required directories', async () => {
      await store.init();

      const expectedDirs = [
        'boards', 'tasks', 'archive', 'sessions', 'sprints',
        'agents', 'handoffs', 'locks',
        'history', 'velocity',
        'approvals', 'reviews', 'qa', 'deployments', 'team',
      ];

      for (const dir of expectedDirs) {
        const dirPath = path.join(tmpDir, '.kanban', dir);
        const stat = await fs.promises.stat(dirPath);
        expect(stat.isDirectory()).toBe(true);
      }
    });

    it('creates default config.json', async () => {
      await store.init();

      const configPath = path.join(tmpDir, '.kanban', 'config.json');
      const data = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
      expect(data).toEqual(DEFAULT_CONFIG);
    });

    it('does not overwrite existing config on re-init', async () => {
      await store.init();
      const customConfig = { ...DEFAULT_CONFIG, autoTrack: false };
      await store.saveConfig(customConfig);

      await store.init();

      const config = await store.getConfig();
      expect(config.autoTrack).toBe(false);
    });
  });

  describe('readJson / writeJson', () => {
    it('roundtrips JSON data', async () => {
      await store.init();
      const filePath = path.join(tmpDir, '.kanban', 'test.json');
      const data = { foo: 'bar', num: 42, nested: { a: [1, 2, 3] } };

      await store.writeJson(filePath, data);
      const result = await store.readJson(filePath);

      expect(result).toEqual(data);
    });

    it('returns null for non-existent file', async () => {
      const result = await store.readJson('/nonexistent/path.json');
      expect(result).toBeNull();
    });

    it('creates parent directories when writing', async () => {
      const filePath = path.join(tmpDir, 'deep', 'nested', 'file.json');
      await store.writeJson(filePath, { value: 1 });

      const result = await store.readJson(filePath);
      expect(result).toEqual({ value: 1 });
    });
  });

  describe('deleteFile', () => {
    it('deletes an existing file and returns true', async () => {
      await store.init();
      const filePath = path.join(tmpDir, '.kanban', 'temp.json');
      await store.writeJson(filePath, { test: true });

      const result = await store.deleteFile(filePath);
      expect(result).toBe(true);

      const exists = fs.existsSync(filePath);
      expect(exists).toBe(false);
    });

    it('returns false for non-existent file', async () => {
      const result = await store.deleteFile('/nonexistent/file.json');
      expect(result).toBe(false);
    });
  });

  describe('listFiles', () => {
    it('lists only .json files in a directory', async () => {
      await store.init();
      const dir = path.join(tmpDir, '.kanban', 'tasks');

      await fs.promises.writeFile(path.join(dir, 'task1.json'), '{}');
      await fs.promises.writeFile(path.join(dir, 'task2.json'), '{}');
      await fs.promises.writeFile(path.join(dir, 'readme.txt'), 'hello');

      const files = await store.listFiles(dir);
      expect(files).toHaveLength(2);
      expect(files.sort()).toEqual(['task1.json', 'task2.json']);
    });

    it('returns empty array for non-existent directory', async () => {
      const files = await store.listFiles('/nonexistent/dir');
      expect(files).toEqual([]);
    });

    it('returns empty array for empty directory', async () => {
      await store.init();
      const files = await store.listFiles(store.tasksDir);
      expect(files).toEqual([]);
    });
  });

  describe('getConfig / saveConfig', () => {
    it('returns default config when no config file exists', async () => {
      const config = await store.getConfig();
      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('roundtrips config', async () => {
      await store.init();
      const config = await store.getConfig();
      config.autoTrack = false;
      config.autoArchiveDays = 7;

      await store.saveConfig(config);
      const loaded = await store.getConfig();

      expect(loaded.autoTrack).toBe(false);
      expect(loaded.autoArchiveDays).toBe(7);
    });
  });

  describe('path helpers', () => {
    it('generates correct task path', () => {
      expect(store.taskPath('t_abc123')).toBe(path.join(tmpDir, '.kanban', 'tasks', 't_abc123.json'));
    });

    it('generates correct archive path', () => {
      expect(store.archivePath('t_abc123')).toBe(path.join(tmpDir, '.kanban', 'archive', 't_abc123.json'));
    });

    it('generates correct board path', () => {
      expect(store.boardPath('b_xyz')).toBe(path.join(tmpDir, '.kanban', 'boards', 'b_xyz.json'));
    });

    it('generates correct agent path', () => {
      expect(store.agentPath('ag_test')).toBe(path.join(tmpDir, '.kanban', 'agents', 'ag_test.json'));
    });

    it('generates correct approval path', () => {
      expect(store.approvalPath('ap_test')).toBe(path.join(tmpDir, '.kanban', 'approvals', 'ap_test.json'));
    });

    it('generates correct team member path', () => {
      expect(store.teamMemberPath('tm_test')).toBe(path.join(tmpDir, '.kanban', 'team', 'tm_test.json'));
    });
  });
});
