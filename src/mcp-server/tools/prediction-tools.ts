import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Store } from "../storage/store.js";
import { TaskStore } from "../storage/task-store.js";
import { HistoryStore } from "../storage/history-store.js";
import { SprintStore } from "../storage/sprint-store.js";

export function registerPredictionTools(
  server: McpServer,
  store: Store,
  taskStore: TaskStore,
  historyStore: HistoryStore,
  sprintStore: SprintStore
) {
  // 1. predict_duration
  server.tool(
    "predict_duration",
    "Predict task duration from historical similar tasks",
    {
      taskId: z.string().describe("Task ID to predict duration for"),
    },
    async ({ taskId }) => {
      const task = await taskStore.get(taskId);
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Task not found" }) }] };
      }

      const similar = await historyStore.findSimilar(task.tags, task.complexity);
      if (similar.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, predictedMinutes: null, message: "No historical data yet", sampleSize: 0 }) }] };
      }

      const durations = similar.map((s) => s.actualMinutes).sort((a, b) => a - b);
      const median = durations[Math.floor(durations.length / 2)];
      const average = Math.round(durations.reduce((s, d) => s + d, 0) / durations.length);
      const p90 = durations[Math.floor(durations.length * 0.9)] ?? durations[durations.length - 1];

      // Update task with prediction
      await taskStore.update(taskId, { predictedMinutes: median });

      return { content: [{ type: "text", text: JSON.stringify({
        ok: true,
        predictedMinutes: median,
        averageMinutes: average,
        p90Minutes: p90,
        sampleSize: similar.length,
        basedOn: similar.slice(0, 5).map((s) => ({ title: s.title, minutes: s.actualMinutes })),
      }) }] };
    }
  );

  // 2. velocity_report
  server.tool(
    "velocity_report",
    "Show tasks/day trends and sprint projection",
    {},
    async () => {
      const config = await store.getConfig();
      const velocities = await historyStore.listVelocity(config.activeProjectId ?? undefined);
      const completions = await historyStore.listCompletions();

      // Calculate daily rates for last 7 days
      const now = new Date();
      const dailyRates: Array<{ date: string; count: number }> = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const count = completions.filter((c) => c.completedAt.startsWith(dateStr)).length;
        dailyRates.push({ date: dateStr, count });
      }

      const totalWeek = dailyRates.reduce((s, d) => s + d.count, 0);
      const avgPerDay = totalWeek / 7;

      // Sprint projection
      let sprintProjection = null;
      if (config.activeProjectId) {
        const sprint = await sprintStore.getActive(config.activeProjectId);
        if (sprint) {
          const tasks = await taskStore.list(config.activeProjectId);
          const sprintTasks = tasks.filter((t) => t.sprintId === sprint.id);
          const remaining = sprintTasks.filter((t) => t.status !== "done").length;
          const daysLeft = Math.max(0, Math.ceil((new Date(sprint.endDate).getTime() - now.getTime()) / 86400000));
          sprintProjection = {
            sprintName: sprint.name,
            remaining,
            daysLeft,
            projectedCompletion: avgPerDay > 0 ? Math.ceil(remaining / avgPerDay) : null,
            onTrack: avgPerDay > 0 ? remaining <= daysLeft * avgPerDay : false,
          };
        }
      }

      return { content: [{ type: "text", text: JSON.stringify({
        ok: true,
        totalCompletedAllTime: completions.length,
        last7Days: dailyRates,
        avgTasksPerDay: Math.round(avgPerDay * 10) / 10,
        sprintProjection,
      }) }] };
    }
  );

  // 3. burndown_data
  server.tool(
    "burndown_data",
    "Generate ASCII burndown chart data for a sprint",
    {
      sprintId: z.string().optional().describe("Sprint ID (default: active sprint)"),
    },
    async ({ sprintId }) => {
      const config = await store.getConfig();
      let sprint;
      if (sprintId) {
        sprint = await sprintStore.get(sprintId);
      } else if (config.activeProjectId) {
        sprint = await sprintStore.getActive(config.activeProjectId);
      }
      if (!sprint) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No sprint found" }) }] };
      }

      const tasks = await taskStore.list(config.activeProjectId ?? undefined);
      const sprintTasks = tasks.filter((t) => t.sprintId === sprint!.id);
      const total = sprintTasks.length;

      const start = new Date(sprint.startDate);
      const end = new Date(sprint.endDate);
      const totalDays = Math.ceil((end.getTime() - start.getTime()) / 86400000);

      // Build burndown points
      const completions = await historyStore.listCompletions();
      const sprintCompletions = completions.filter((c) => sprintTasks.some((t) => t.id === c.taskId));

      const points: Array<{ day: number; ideal: number; actual: number }> = [];
      for (let d = 0; d <= totalDays; d++) {
        const dayDate = new Date(start);
        dayDate.setDate(dayDate.getDate() + d);
        const dateStr = dayDate.toISOString().slice(0, 10);
        const completedByDay = sprintCompletions.filter((c) => c.completedAt.slice(0, 10) <= dateStr).length;
        points.push({
          day: d,
          ideal: Math.round(total - (total / totalDays) * d),
          actual: total - completedByDay,
        });
      }

      // ASCII chart
      const maxWidth = 40;
      const lines = [`Sprint: ${sprint.name} (${total} tasks)`];
      lines.push(`${"Day".padEnd(5)}${"Ideal".padEnd(8)}${"Actual".padEnd(8)}Chart`);
      for (const p of points) {
        const idealBar = "─".repeat(Math.round((p.ideal / total) * maxWidth));
        const actualBar = "█".repeat(Math.round((p.actual / total) * maxWidth));
        lines.push(`${String(p.day).padEnd(5)}${String(p.ideal).padEnd(8)}${String(p.actual).padEnd(8)}${actualBar || "✓"}`);
      }

      return { content: [{ type: "text", text: JSON.stringify({ ok: true, chart: lines.join("\n"), points }) }] };
    }
  );

  // 4. record_velocity
  server.tool(
    "record_velocity",
    "Snapshot daily velocity (auto-called on task completion)",
    {},
    async () => {
      const config = await store.getConfig();
      const snapshot = await historyStore.recordVelocity(config.activeProjectId ?? "default");
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, snapshot }) }] };
    }
  );
}
