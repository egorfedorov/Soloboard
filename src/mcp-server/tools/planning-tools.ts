import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { TaskStore } from "../storage/task-store.js";
import { BoardStore } from "../storage/board-store.js";
import { SprintStore } from "../storage/sprint-store.js";

const TEMPLATES: Record<string, Array<{ title: string; tags: string[]; priority: string; deps: number[] }>> = {
  saas: [
    { title: "Set up project scaffolding", tags: ["setup"], priority: "high", deps: [] },
    { title: "Design database schema", tags: ["database", "design"], priority: "high", deps: [0] },
    { title: "Implement authentication", tags: ["auth", "backend"], priority: "high", deps: [0] },
    { title: "Create user management API", tags: ["api", "backend"], priority: "high", deps: [1, 2] },
    { title: "Build dashboard UI", tags: ["frontend", "ui"], priority: "medium", deps: [3] },
    { title: "Add billing/payments", tags: ["billing", "backend"], priority: "medium", deps: [3] },
    { title: "Set up CI/CD pipeline", tags: ["devops"], priority: "medium", deps: [0] },
    { title: "Write tests", tags: ["testing"], priority: "medium", deps: [3, 4] },
    { title: "Deploy to staging", tags: ["devops"], priority: "low", deps: [6, 7] },
    { title: "Launch checklist", tags: ["release"], priority: "low", deps: [8] },
  ],
  api: [
    { title: "Design API endpoints", tags: ["design", "api"], priority: "high", deps: [] },
    { title: "Set up project + framework", tags: ["setup"], priority: "high", deps: [] },
    { title: "Implement data models", tags: ["backend", "database"], priority: "high", deps: [0, 1] },
    { title: "Build CRUD endpoints", tags: ["backend", "api"], priority: "high", deps: [2] },
    { title: "Add authentication middleware", tags: ["auth", "backend"], priority: "high", deps: [1] },
    { title: "Add validation + error handling", tags: ["backend"], priority: "medium", deps: [3] },
    { title: "Write API tests", tags: ["testing"], priority: "medium", deps: [3] },
    { title: "Add API documentation", tags: ["docs"], priority: "low", deps: [3] },
  ],
  cli: [
    { title: "Set up CLI framework", tags: ["setup"], priority: "high", deps: [] },
    { title: "Define command structure", tags: ["design"], priority: "high", deps: [0] },
    { title: "Implement core commands", tags: ["feature"], priority: "high", deps: [1] },
    { title: "Add configuration support", tags: ["feature"], priority: "medium", deps: [0] },
    { title: "Add output formatting", tags: ["ui"], priority: "medium", deps: [2] },
    { title: "Write tests", tags: ["testing"], priority: "medium", deps: [2] },
    { title: "Add help text + man page", tags: ["docs"], priority: "low", deps: [2] },
  ],
  library: [
    { title: "Design public API surface", tags: ["design", "api"], priority: "high", deps: [] },
    { title: "Set up project + build system", tags: ["setup"], priority: "high", deps: [] },
    { title: "Implement core functionality", tags: ["feature"], priority: "high", deps: [0, 1] },
    { title: "Add TypeScript types", tags: ["types"], priority: "medium", deps: [2] },
    { title: "Write unit tests", tags: ["testing"], priority: "medium", deps: [2] },
    { title: "Add documentation + examples", tags: ["docs"], priority: "medium", deps: [2] },
    { title: "Set up CI + publish pipeline", tags: ["devops"], priority: "low", deps: [4] },
  ],
};

export function registerPlanningTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  boardStore: BoardStore,
  sprintStore: SprintStore
) {
  // 1. plan_from_prompt
  server.tool(
    "plan_from_prompt",
    "Convert a natural language description into a structured task breakdown with dependencies and estimates",
    {
      prompt: z.string().describe("Natural language description of what needs to be built"),
      maxTasks: z.number().optional().describe("Maximum number of tasks to generate (default: 10)"),
    },
    async ({ prompt, maxTasks }) => {
      const max = maxTasks ?? 10;
      const words = prompt.toLowerCase().split(/\s+/);

      // Simple keyword-based task generation
      const tasks: Array<{ title: string; description: string; tags: string[]; priority: string; estimatedMinutes: number; dependsOn: number[] }> = [];

      // Always start with setup
      tasks.push({ title: `Set up project for: ${prompt.slice(0, 50)}`, description: "Initial project setup and scaffolding", tags: ["setup"], priority: "high", estimatedMinutes: 30, dependsOn: [] });

      // Detect patterns
      if (words.some((w) => ["api", "endpoint", "rest", "graphql"].includes(w))) {
        tasks.push({ title: "Design and implement API layer", description: "Create API endpoints", tags: ["api", "backend"], priority: "high", estimatedMinutes: 120, dependsOn: [0] });
      }
      if (words.some((w) => ["database", "db", "schema", "model", "data"].includes(w))) {
        tasks.push({ title: "Design database schema and models", description: "Create data models", tags: ["database"], priority: "high", estimatedMinutes: 60, dependsOn: [0] });
      }
      if (words.some((w) => ["ui", "frontend", "page", "component", "view", "dashboard"].includes(w))) {
        tasks.push({ title: "Build frontend UI components", description: "Create user interface", tags: ["frontend", "ui"], priority: "medium", estimatedMinutes: 180, dependsOn: [0] });
      }
      if (words.some((w) => ["auth", "login", "user", "permission"].includes(w))) {
        tasks.push({ title: "Implement authentication system", description: "User auth flow", tags: ["auth"], priority: "high", estimatedMinutes: 120, dependsOn: [0] });
      }
      if (words.some((w) => ["test", "testing", "spec"].includes(w))) {
        tasks.push({ title: "Write tests", description: "Unit and integration tests", tags: ["testing"], priority: "medium", estimatedMinutes: 90, dependsOn: tasks.length > 1 ? [tasks.length - 1] : [0] });
      }

      // Fill remaining with generic implementation tasks
      if (tasks.length < 3) {
        tasks.push({ title: `Implement core logic: ${prompt.slice(0, 40)}`, description: "Main implementation work", tags: ["feature"], priority: "high", estimatedMinutes: 120, dependsOn: [0] });
      }

      // Always end with testing and review
      const lastIdx = tasks.length - 1;
      if (!tasks.some((t) => t.tags.includes("testing"))) {
        tasks.push({ title: "Write tests and verify", description: "Test all functionality", tags: ["testing"], priority: "medium", estimatedMinutes: 60, dependsOn: [lastIdx] });
      }

      const plan = tasks.slice(0, max);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, plan, totalEstimatedMinutes: plan.reduce((s, t) => s + t.estimatedMinutes, 0) }) }] };
    }
  );

  // 2. plan_apply
  server.tool(
    "plan_apply",
    "Bulk-create tasks from a plan, set dependencies, optionally create a sprint",
    {
      plan: z.array(z.object({
        title: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        estimatedMinutes: z.number().optional(),
        dependsOn: z.array(z.number()).optional().describe("Indices of tasks this depends on"),
      })).describe("Array of tasks to create"),
      sprintName: z.string().optional().describe("If provided, create a sprint and add all tasks"),
    },
    async ({ plan, sprintName }) => {
      const config = await store.getConfig();
      if (!config.activeProjectId) {
        return { content: [{ type: "text", text: "No active project" }] };
      }

      const createdIds: string[] = [];
      for (const item of plan) {
        const task = await taskStore.create(item.title, config.activeProjectId, {
          description: item.description,
          priority: item.priority as "low" | "medium" | "high" | undefined,
          tags: item.tags,
        });
        if (item.estimatedMinutes) {
          await taskStore.update(task.id, { estimatedMinutes: item.estimatedMinutes });
        }
        await boardStore.addTask(config.activeProjectId, task.id, "todo");
        createdIds.push(task.id);
      }

      // Set dependencies
      for (let i = 0; i < plan.length; i++) {
        const deps = plan[i].dependsOn;
        if (deps && deps.length > 0) {
          const blockedBy = deps.filter((d) => d >= 0 && d < createdIds.length).map((d) => createdIds[d]);
          if (blockedBy.length > 0) {
            await taskStore.update(createdIds[i], { blockedBy });
            for (const depId of blockedBy) {
              const depTask = await taskStore.get(depId);
              if (depTask) {
                const blocks = [...depTask.blocks, createdIds[i]];
                await taskStore.update(depId, { blocks });
              }
            }
          }
        }
      }

      // Optionally create sprint
      let sprintId: string | null = null;
      if (sprintName) {
        const sprint = await sprintStore.create(sprintName, config.activeProjectId);
        for (const id of createdIds) {
          await sprintStore.addTask(sprint.id, id);
          await taskStore.update(id, { sprintId: sprint.id });
        }
        sprintId = sprint.id;
      }

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, createdTasks: createdIds.length, taskIds: createdIds, sprintId }) }] };
    }
  );

  // 3. plan_templates
  server.tool(
    "plan_templates",
    "Get pre-built project templates (SaaS, API, CLI, library)",
    {
      template: z.enum(["saas", "api", "cli", "library"]).describe("Template type"),
    },
    async ({ template }) => {
      const t = TEMPLATES[template];
      if (!t) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Unknown template" }) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, template, tasks: t }) }] };
    }
  );
}
