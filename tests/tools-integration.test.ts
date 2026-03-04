import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/mcp-server/storage/store.js';
import { TaskStore } from '../src/mcp-server/storage/task-store.js';
import { BoardStore } from '../src/mcp-server/storage/board-store.js';
import { SessionStore } from '../src/mcp-server/storage/session-store.js';
import { AgentStore } from '../src/mcp-server/storage/agent-store.js';
import { ApprovalStore } from '../src/mcp-server/storage/approval-store.js';
import { TeamStore } from '../src/mcp-server/storage/team-store.js';

let tmpDir: string;
let store: Store;
let taskStore: TaskStore;
let boardStore: BoardStore;
let sessionStore: SessionStore;
let agentStore: AgentStore;
let approvalStore: ApprovalStore;
let teamStore: TeamStore;

const PROJECT_ID = 'integration-project';

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'soloboard-integration-'));
  store = new Store(tmpDir);
  await store.init();
  taskStore = new TaskStore(store);
  boardStore = new BoardStore(store);
  sessionStore = new SessionStore(store);
  agentStore = new AgentStore(store);
  approvalStore = new ApprovalStore(store);
  teamStore = new TeamStore(store);
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

describe('Integration: auto_init equivalent', () => {
  it('initializes store and creates all directories', async () => {
    // auto_init calls store.init() internally
    const kanbanDir = path.join(tmpDir, '.kanban');
    const stat = await fs.promises.stat(kanbanDir);
    expect(stat.isDirectory()).toBe(true);

    // Verify config was created
    const config = await store.getConfig();
    expect(config).toBeDefined();
    expect(config.autoTrack).toBe(true);
  });

  it('creates board and session on init', async () => {
    // Simulate what auto_init does: create a default board + session
    const board = await boardStore.create('Integration Test Board');
    expect(board).toBeDefined();
    expect(board.name).toBe('Integration Test Board');
    expect(board.columns).toEqual({ todo: [], doing: [], done: [] });

    const session = await sessionStore.create(PROJECT_ID);
    expect(session).toBeDefined();
    expect(session.projectId).toBe(PROJECT_ID);
  });
});

describe('Integration: task lifecycle', () => {
  it('create -> list -> move -> complete', async () => {
    // Create task
    const task = await taskStore.create('Build login page', PROJECT_ID, {
      description: 'Implement login with OAuth',
      priority: 'high',
      tags: ['frontend', 'auth'],
    });
    expect(task.status).toBe('todo');

    // List tasks
    const tasks = await taskStore.list(PROJECT_ID);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(task.id);

    // Move to doing
    const doing = await taskStore.update(task.id, { status: 'doing' });
    expect(doing!.status).toBe('doing');
    expect(doing!.timeLog).toHaveLength(1);

    // Move to done
    const done = await taskStore.update(task.id, { status: 'done' });
    expect(done!.status).toBe('done');
    expect(done!.completedAt).toBeDefined();
    expect(done!.timeLog[0].end).not.toBeNull();
  });

  it('create multiple tasks and list returns all', async () => {
    await taskStore.create('Task 1', PROJECT_ID);
    await taskStore.create('Task 2', PROJECT_ID);
    await taskStore.create('Task 3', PROJECT_ID, { status: 'doing' });

    const all = await taskStore.list(PROJECT_ID);
    expect(all).toHaveLength(3);

    const doingTasks = all.filter(t => t.status === 'doing');
    expect(doingTasks).toHaveLength(1);
  });
});

describe('Integration: board_view equivalent', () => {
  it('returns board with task columns', async () => {
    await taskStore.create('Todo task', PROJECT_ID);
    const doingTask = await taskStore.create('Doing task', PROJECT_ID);
    await taskStore.update(doingTask.id, { status: 'doing' });
    const doneTask = await taskStore.create('Done task', PROJECT_ID);
    await taskStore.update(doneTask.id, { status: 'doing' });
    await taskStore.update(doneTask.id, { status: 'done' });

    const tasks = await taskStore.list(PROJECT_ID);

    const todo = tasks.filter(t => t.status === 'todo');
    const doing = tasks.filter(t => t.status === 'doing');
    const done = tasks.filter(t => t.status === 'done');

    expect(todo).toHaveLength(1);
    expect(doing).toHaveLength(1);
    expect(done).toHaveLength(1);
  });
});

describe('Integration: approval workflow', () => {
  it('creates and resolves approval', async () => {
    // Create a task
    const task = await taskStore.create('Deploy feature', PROJECT_ID);

    // Create approval
    const approval = await approvalStore.create(
      'deploy',
      'Deploy login feature to production',
      'agent-dev',
      task.id
    );
    expect(approval.status).toBe('pending');

    // List pending
    const pending = await approvalStore.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(approval.id);

    // Resolve
    const resolved = await approvalStore.resolve(
      approval.id,
      'approved',
      'Reviewed and approved',
      'user'
    );
    expect(resolved!.status).toBe('approved');

    // No more pending
    const pendingAfter = await approvalStore.listPending();
    expect(pendingAfter).toHaveLength(0);
  });
});

describe('Integration: team management', () => {
  it('creates member and assigns tasks', async () => {
    // Add team member
    const member = await teamStore.add('Alice', 'developer', ['typescript', 'react']);
    expect(member.name).toBe('Alice');

    // Create tasks
    const task1 = await taskStore.create('Build component', PROJECT_ID);
    const task2 = await taskStore.create('Write tests', PROJECT_ID);

    // Assign tasks
    await teamStore.assignTask(member.id, task1.id);
    await teamStore.assignTask(member.id, task2.id);

    const loaded = await teamStore.get(member.id);
    expect(loaded!.activeTaskIds).toHaveLength(2);
    expect(loaded!.stats.tasksAssigned).toBe(2);

    // Complete one task
    await teamStore.completeTask(member.id, task1.id, 45);
    const afterComplete = await teamStore.get(member.id);
    expect(afterComplete!.activeTaskIds).toHaveLength(1);
    expect(afterComplete!.stats.tasksCompleted).toBe(1);
  });

  it('finds members by role and skill', async () => {
    await teamStore.add('Alice', 'developer', ['typescript']);
    await teamStore.add('Bob', 'developer', ['python']);
    await teamStore.add('Carol', 'qa_agent', ['testing']);

    const devs = await teamStore.findByRole('developer');
    expect(devs).toHaveLength(2);

    const tsDevs = await teamStore.findBySkill('typescript');
    expect(tsDevs).toHaveLength(1);
    expect(tsDevs[0].name).toBe('Alice');
  });
});

describe('Integration: multi-agent coordination', () => {
  it('registers agents and tracks heartbeats', async () => {
    const agent1 = await agentStore.register('session-1', 'Developer Agent');
    const agent2 = await agentStore.register('session-2', 'Reviewer Agent');

    const agents = await agentStore.list();
    expect(agents).toHaveLength(2);

    // Heartbeat
    await agentStore.heartbeat(agent1.id);

    // Claim task
    const task = await taskStore.create('Review PR', PROJECT_ID);
    await agentStore.update(agent2.id, { activeTaskId: task.id });

    const updatedAgent = await agentStore.get(agent2.id);
    expect(updatedAgent!.activeTaskId).toBe(task.id);
  });
});

describe('Integration: task archive and delete', () => {
  it('archives task removes from active list', async () => {
    const task = await taskStore.create('Archive test', PROJECT_ID);
    await taskStore.archive(task.id);

    const active = await taskStore.list(PROJECT_ID);
    expect(active).toHaveLength(0);

    // Archived task still readable from archive path
    const archived = await store.readJson(store.archivePath(task.id));
    expect(archived).not.toBeNull();
  });

  it('deletes task permanently', async () => {
    const task = await taskStore.create('Delete test', PROJECT_ID);
    await taskStore.delete(task.id);

    const active = await taskStore.list(PROJECT_ID);
    expect(active).toHaveLength(0);

    const fromDisk = await store.readJson(store.taskPath(task.id));
    expect(fromDisk).toBeNull();
  });
});

describe('Integration: cross-store interactions', () => {
  it('full workflow: init -> create task -> assign member -> approve -> complete', async () => {
    // 1. Create team member
    const member = await teamStore.add('Alice', 'developer', ['fullstack']);

    // 2. Create task
    const task = await taskStore.create('Implement feature X', PROJECT_ID, {
      priority: 'high',
    });

    // 3. Assign to member
    await teamStore.assignTask(member.id, task.id);

    // 4. Move task to doing
    await taskStore.update(task.id, { status: 'doing' });

    // 5. Request approval
    const approval = await approvalStore.create(
      'merge',
      'Merge feature X PR',
      member.name,
      task.id
    );

    // 6. Approve
    await approvalStore.resolve(approval.id, 'approved', 'LGTM', 'lead');

    // 7. Move task to done
    const doneTask = await taskStore.update(task.id, { status: 'done' });
    expect(doneTask!.status).toBe('done');
    expect(doneTask!.completedAt).toBeDefined();

    // 8. Complete task for member
    await teamStore.completeTask(member.id, task.id, 60);
    const finalMember = await teamStore.get(member.id);
    expect(finalMember!.stats.tasksCompleted).toBe(1);
    expect(finalMember!.activeTaskIds).toHaveLength(0);
  });
});
