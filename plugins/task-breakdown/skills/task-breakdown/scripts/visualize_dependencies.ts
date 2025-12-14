#!/usr/bin/env bun
/**
 * visualize_dependencies.ts - Generate dependency matrix and MermaidJS diagrams
 *
 * Analyzes phased task breakdown and generates:
 * - Markdown dependency matrix table
 * - MermaidJS graph syntax
 * - Critical path analysis
 *
 * Usage:
 *   bun visualize_dependencies.ts <task-dir-path> [--json] [--format matrix|mermaid|both]
 *
 * Output includes both matrix and Mermaid by default.
 */

import { existsSync, readdirSync, statSync } from "fs";
import { basename, join } from "path";

interface TaskDependencies {
  task_id: string;
  name: string;
  phase: number;
  parallel: boolean;
  depends_on: string[];
  blocks: string[];
  file: string;
}

interface VisualizationResult {
  task_dir: string;
  task_name: string;
  total_tasks: number;
  total_phases: number;
  tasks: TaskDependencies[];
  matrix: string;
  mermaid: string;
  critical_path: string[];
  parallel_opportunities: number;
  error?: string;
}

function parseFrontmatter(content: string): Record<string, string | boolean | string[]> {
  const frontmatter: Record<string, string | boolean | string[]> = {};

  if (!content.startsWith("---")) {
    return frontmatter;
  }

  const endIndex = content.indexOf("---", 3);
  if (endIndex === -1) {
    return frontmatter;
  }

  const fmContent = content.substring(3, endIndex).trim();
  const lines = fmContent.split("\n");

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();

      // Handle boolean values
      if (value === "true") {
        frontmatter[key] = true;
      } else if (value === "false") {
        frontmatter[key] = false;
      }
      // Handle array values [item1, item2]
      else if (value.startsWith("[") && value.endsWith("]")) {
        const arrayContent = value.slice(1, -1).trim();
        if (arrayContent === "") {
          frontmatter[key] = [];
        } else {
          frontmatter[key] = arrayContent.split(",").map((s) => s.trim());
        }
      } else {
        frontmatter[key] = value;
      }
    }
  }

  return frontmatter;
}

async function scanPhasedTasks(taskDir: string): Promise<TaskDependencies[]> {
  const tasks: TaskDependencies[] = [];

  if (!existsSync(taskDir)) {
    return tasks;
  }

  const entries = readdirSync(taskDir);

  for (const entry of entries) {
    const entryPath = join(taskDir, entry);
    const stat = statSync(entryPath);

    // Look for phase directories
    if (stat.isDirectory() && entry.startsWith("phase_")) {
      const phaseMatch = entry.match(/^phase_(\d+)_(parallel|sequential)$/);
      if (!phaseMatch) continue;

      const phaseNum = parseInt(phaseMatch[1], 10);
      const phaseType = phaseMatch[2];

      // Scan task files in phase directory
      const phaseFiles = readdirSync(entryPath);
      for (const file of phaseFiles) {
        if (!file.endsWith(".md")) continue;

        const filePath = join(entryPath, file);
        const content = await Bun.file(filePath).text();
        const fm = parseFrontmatter(content);

        // Extract task ID from filename or frontmatter
        const taskIdMatch = file.match(/^(P\d+_\d+)/);
        const taskId = taskIdMatch ? taskIdMatch[1] : fm.name?.toString() || file.replace(".md", "");

        tasks.push({
          task_id: taskId,
          name: fm.name?.toString() || file.replace(".md", ""),
          phase: fm.phase ? parseInt(fm.phase.toString(), 10) : phaseNum,
          parallel: fm.parallel === true || phaseType === "parallel",
          depends_on: Array.isArray(fm.depends_on) ? fm.depends_on : [],
          blocks: Array.isArray(fm.blocks) ? fm.blocks : [],
          file: `${entry}/${file}`,
        });
      }
    }
  }

  // Sort by phase and task number
  tasks.sort((a, b) => {
    if (a.phase !== b.phase) return a.phase - b.phase;
    return a.task_id.localeCompare(b.task_id);
  });

  return tasks;
}

function generateMatrix(tasks: TaskDependencies[]): string {
  if (tasks.length === 0) {
    return "| Task | Phase | Depends On | Blocks | Parallel |\n|------|-------|------------|--------|----------|\n| (no tasks found) | - | - | - | - |\n";
  }

  let matrix = "| Task | Phase | Depends On | Blocks | Parallel |\n";
  matrix += "|------|-------|------------|--------|----------|\n";

  for (const task of tasks) {
    const dependsOn = task.depends_on.length > 0 ? task.depends_on.join(", ") : "-";
    const blocks = task.blocks.length > 0 ? task.blocks.join(", ") : "-";
    const parallel = task.parallel ? "Yes" : "No";

    matrix += `| ${task.task_id} | ${task.phase} | ${dependsOn} | ${blocks} | ${parallel} |\n`;
  }

  return matrix;
}

function generateMermaid(tasks: TaskDependencies[]): string {
  if (tasks.length === 0) {
    return "graph TD\n  empty[No tasks found]\n";
  }

  let mermaid = "graph TD\n";

  // Group tasks by phase for subgraphs
  const phases = new Map<number, TaskDependencies[]>();
  for (const task of tasks) {
    if (!phases.has(task.phase)) {
      phases.set(task.phase, []);
    }
    phases.get(task.phase)!.push(task);
  }

  // Generate subgraphs for each phase
  for (const [phaseNum, phaseTasks] of phases) {
    const phaseType = phaseTasks[0]?.parallel ? "parallel" : "sequential";
    mermaid += `  subgraph Phase${phaseNum}[Phase ${phaseNum} - ${phaseType}]\n`;

    for (const task of phaseTasks) {
      // Use short name for label
      const label = task.name.replace(/^P\d+_\d+_/, "").replace(/-/g, " ");
      mermaid += `    ${task.task_id}[${label}]\n`;
    }

    mermaid += `  end\n`;
  }

  // Add dependency arrows
  mermaid += "\n  %% Dependencies\n";
  for (const task of tasks) {
    for (const dep of task.depends_on) {
      mermaid += `  ${dep} --> ${task.task_id}\n`;
    }
  }

  // Add phase transition arrows (implicit dependencies)
  const sortedPhases = Array.from(phases.keys()).sort((a, b) => a - b);
  for (let i = 0; i < sortedPhases.length - 1; i++) {
    const currentPhase = sortedPhases[i];
    const nextPhase = sortedPhases[i + 1];
    const nextPhaseTasks = phases.get(nextPhase) || [];

    if (nextPhaseTasks.length > 0 && !nextPhaseTasks[0].parallel) {
      // Sequential phase depends on all previous parallel tasks
      const prevTasks = phases.get(currentPhase) || [];
      if (prevTasks.length > 0 && prevTasks[0].parallel) {
        // Just show one arrow from last parallel to first sequential
        mermaid += `  ${prevTasks[prevTasks.length - 1].task_id} -.-> ${nextPhaseTasks[0].task_id}\n`;
      }
    }
  }

  // Add styling
  mermaid += "\n  %% Styling\n";
  for (const task of tasks) {
    if (task.parallel) {
      mermaid += `  style ${task.task_id} fill:#e1f5fe\n`;
    } else {
      mermaid += `  style ${task.task_id} fill:#fff3e0\n`;
    }
  }

  return mermaid;
}

function findCriticalPath(tasks: TaskDependencies[]): string[] {
  // Simple critical path: longest chain of sequential dependencies
  const criticalPath: string[] = [];

  if (tasks.length === 0) return criticalPath;

  // Build dependency graph
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const task of tasks) {
    graph.set(task.task_id, []);
    inDegree.set(task.task_id, 0);
  }

  for (const task of tasks) {
    for (const dep of task.depends_on) {
      if (graph.has(dep)) {
        graph.get(dep)!.push(task.task_id);
        inDegree.set(task.task_id, (inDegree.get(task.task_id) || 0) + 1);
      }
    }
  }

  // Find entry points (no dependencies)
  const entryPoints = tasks.filter((t) => t.depends_on.length === 0);

  // Find longest path from each entry point
  function findLongestPath(taskId: string, visited: Set<string>): string[] {
    if (visited.has(taskId)) return [];
    visited.add(taskId);

    const successors = graph.get(taskId) || [];
    if (successors.length === 0) {
      return [taskId];
    }

    let longest: string[] = [];
    for (const succ of successors) {
      const path = findLongestPath(succ, new Set(visited));
      if (path.length > longest.length) {
        longest = path;
      }
    }

    return [taskId, ...longest];
  }

  let longestPath: string[] = [];
  for (const entry of entryPoints) {
    const path = findLongestPath(entry.task_id, new Set());
    if (path.length > longestPath.length) {
      longestPath = path;
    }
  }

  return longestPath;
}

async function visualizeDependencies(
  taskDir: string,
  format: "matrix" | "mermaid" | "both"
): Promise<VisualizationResult> {
  const result: VisualizationResult = {
    task_dir: taskDir,
    task_name: basename(taskDir),
    total_tasks: 0,
    total_phases: 0,
    tasks: [],
    matrix: "",
    mermaid: "",
    critical_path: [],
    parallel_opportunities: 0,
  };

  if (!existsSync(taskDir)) {
    result.error = `Task directory not found: ${taskDir}`;
    return result;
  }

  // Scan for phased tasks
  result.tasks = await scanPhasedTasks(taskDir);
  result.total_tasks = result.tasks.length;

  // Count unique phases
  const phases = new Set(result.tasks.map((t) => t.phase));
  result.total_phases = phases.size;

  // Count parallel opportunities
  result.parallel_opportunities = result.tasks.filter((t) => t.parallel).length;

  // Generate visualizations
  if (format === "matrix" || format === "both") {
    result.matrix = generateMatrix(result.tasks);
  }

  if (format === "mermaid" || format === "both") {
    result.mermaid = generateMermaid(result.tasks);
  }

  // Find critical path
  result.critical_path = findCriticalPath(result.tasks);

  return result;
}

// Main execution
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
let format: "matrix" | "mermaid" | "both" = "both";

const formatIndex = args.indexOf("--format");
if (formatIndex >= 0 && args[formatIndex + 1]) {
  const f = args[formatIndex + 1];
  if (f === "matrix" || f === "mermaid" || f === "both") {
    format = f;
  }
}

const taskDir = args.find((arg) => !arg.startsWith("--"));

if (!taskDir) {
  console.error("Usage: bun visualize_dependencies.ts <task-dir-path> [--json] [--format matrix|mermaid|both]");
  process.exit(1);
}

const result = await visualizeDependencies(taskDir, format);

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (result.error) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log(`Dependency Visualization: ${result.task_name}`);
  console.log(`═════════════════════════════════════════════`);
  console.log(`Total Tasks: ${result.total_tasks}`);
  console.log(`Total Phases: ${result.total_phases}`);
  console.log(`Parallel Opportunities: ${result.parallel_opportunities}`);

  if (result.critical_path.length > 0) {
    console.log(`Critical Path: ${result.critical_path.join(" → ")}`);
  }

  if (result.matrix) {
    console.log(`\n## Dependency Matrix\n`);
    console.log(result.matrix);
  }

  if (result.mermaid) {
    console.log(`\n## MermaidJS Diagram\n`);
    console.log("```mermaid");
    console.log(result.mermaid);
    console.log("```");
  }
}
