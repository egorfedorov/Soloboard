export interface Board {
  id: string;
  name: string;
  columns: {
    todo: string[];
    doing: string[];
    done: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export function createBoard(id: string, name: string): Board {
  const now = new Date().toISOString();
  return {
    id,
    name,
    columns: { todo: [], doing: [], done: [] },
    createdAt: now,
    updatedAt: now,
  };
}
