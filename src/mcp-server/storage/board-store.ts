import { Store } from "./store.js";
import { Board, createBoard } from "../models/board.js";
import { TaskStatus } from "../models/task.js";
import { generateBoardId } from "../utils/id.js";

export class BoardStore {
  constructor(private store: Store) {}

  async create(name: string): Promise<Board> {
    const id = generateBoardId();
    const board = createBoard(id, name);
    await this.store.writeJson(this.store.boardPath(id), board);
    return board;
  }

  async get(boardId: string): Promise<Board | null> {
    return this.store.readJson<Board>(this.store.boardPath(boardId));
  }

  async update(boardId: string, updates: Partial<Omit<Board, "id" | "createdAt">>): Promise<Board | null> {
    const board = await this.get(boardId);
    if (!board) return null;
    const updated: Board = {
      ...board,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await this.store.writeJson(this.store.boardPath(boardId), updated);
    return updated;
  }

  async list(): Promise<Board[]> {
    const files = await this.store.listFiles(this.store.boardsDir);
    const boards: Board[] = [];
    for (const file of files) {
      const board = await this.store.readJson<Board>(
        `${this.store.boardsDir}/${file}`
      );
      if (board) boards.push(board);
    }
    return boards;
  }

  async addTask(boardId: string, taskId: string, column: TaskStatus): Promise<Board | null> {
    const board = await this.get(boardId);
    if (!board) return null;
    // Remove from all columns first
    for (const col of ["todo", "doing", "done"] as const) {
      board.columns[col] = board.columns[col].filter((id) => id !== taskId);
    }
    board.columns[column].push(taskId);
    board.updatedAt = new Date().toISOString();
    await this.store.writeJson(this.store.boardPath(boardId), board);
    return board;
  }

  async moveTask(boardId: string, taskId: string, to: TaskStatus): Promise<Board | null> {
    return this.addTask(boardId, taskId, to);
  }

  async removeTask(boardId: string, taskId: string): Promise<Board | null> {
    const board = await this.get(boardId);
    if (!board) return null;
    for (const col of ["todo", "doing", "done"] as const) {
      board.columns[col] = board.columns[col].filter((id) => id !== taskId);
    }
    board.updatedAt = new Date().toISOString();
    await this.store.writeJson(this.store.boardPath(boardId), board);
    return board;
  }

  async findByName(name: string): Promise<Board | null> {
    const boards = await this.list();
    const lower = name.toLowerCase();
    return boards.find((b) => b.name.toLowerCase() === lower) ??
      boards.find((b) => b.name.toLowerCase().includes(lower)) ?? null;
  }
}
