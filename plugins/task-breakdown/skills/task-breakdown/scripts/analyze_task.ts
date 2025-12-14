#!/usr/bin/env bun
/**
 * analyze_task.ts - Parse task file and extract metadata for breakdown planning
 *
 * Usage:
 *   bun analyze_task.ts <task-file-path> [--json]
 *
 * Output (JSON):
 *   {
 *     "name": "h-implement-system",
 *     "branch": "feature/system",
 *     "status": "pending",
 *     "is_directory": false,
 *     "has_subtasks": false,
 *     "success_criteria": ["criterion 1", "criterion 2"],
 *     "success_criteria_count": 2,
 *     "complexity": "low|medium|high",
 *     "task_file": "sessions/tasks/h-implement-system.md"
 *   }
 */

import { existsSync, readdirSync, statSync } from "fs";
import { basename, dirname, join } from "path";

interface TaskAnalysis {
  name: string;
  branch: string | null;
  status: string;
  created: string | null;
  is_directory: boolean;
  has_subtasks: boolean;
  subtask_files: string[];
  success_criteria: string[];
  success_criteria_count: number;
  complexity: "low" | "medium" | "high";
  task_file: string;
  parent_dir: string | null;
  error?: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const frontmatter: Record<string, string> = {};

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
      const value = line.substring(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }

  return frontmatter;
}

function extractSuccessCriteria(content: string): string[] {
  const criteria: string[] = [];

  // Find Success Criteria section - stop at next level-2 heading (## ) not level-3 (### )
  const successMatch = content.match(/## Success Criteria[\s\S]*?(?=\n## [^#]|$)/i);
  if (!successMatch) {
    return criteria;
  }

  const section = successMatch[0];

  // Extract checkbox items: - [ ] or - [x]
  const checkboxRegex = /- \[[ x]\] (.+)/gi;
  let match;
  while ((match = checkboxRegex.exec(section)) !== null) {
    criteria.push(match[1].trim());
  }

  return criteria;
}

function determineComplexity(criteriaCount: number): "low" | "medium" | "high" {
  if (criteriaCount <= 3) return "low";
  if (criteriaCount <= 6) return "medium";
  return "high";
}

function findSubtaskFiles(taskDir: string): string[] {
  const subtasks: string[] = [];

  if (!existsSync(taskDir) || !statSync(taskDir).isDirectory()) {
    return subtasks;
  }

  const files = readdirSync(taskDir);
  for (const file of files) {
    if (file.endsWith(".md") && file !== "README.md" && file !== "TEMPLATE.md") {
      subtasks.push(file);
    }
  }

  return subtasks.sort();
}

async function analyzeTask(taskPath: string): Promise<TaskAnalysis> {
  const result: TaskAnalysis = {
    name: "",
    branch: null,
    status: "unknown",
    created: null,
    is_directory: false,
    has_subtasks: false,
    subtask_files: [],
    success_criteria: [],
    success_criteria_count: 0,
    complexity: "low",
    task_file: taskPath,
    parent_dir: null,
  };

  // Normalize path - handle both file and directory inputs
  let filePath = taskPath;
  let isDirectory = false;

  if (existsSync(taskPath)) {
    const stat = statSync(taskPath);
    if (stat.isDirectory()) {
      isDirectory = true;
      filePath = join(taskPath, "README.md");
      result.parent_dir = taskPath;
    }
  }

  // Check if task file is inside a directory (directory task pattern)
  if (!isDirectory && basename(filePath) === "README.md") {
    isDirectory = true;
    result.parent_dir = dirname(filePath);
  }

  result.is_directory = isDirectory;
  result.task_file = filePath;

  // Read and parse task file
  if (!existsSync(filePath)) {
    result.error = `Task file not found: ${filePath}`;
    return result;
  }

  const content = await Bun.file(filePath).text();
  const frontmatter = parseFrontmatter(content);

  result.name = frontmatter.name || frontmatter.task || basename(taskPath, ".md");
  result.branch = frontmatter.branch || null;
  result.status = frontmatter.status || "unknown";
  result.created = frontmatter.created || null;

  // Extract success criteria
  result.success_criteria = extractSuccessCriteria(content);
  result.success_criteria_count = result.success_criteria.length;
  result.complexity = determineComplexity(result.success_criteria_count);

  // Check for subtasks if directory task
  if (isDirectory && result.parent_dir) {
    result.subtask_files = findSubtaskFiles(result.parent_dir);
    result.has_subtasks = result.subtask_files.length > 0;
  }

  return result;
}

// Main execution
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const taskPath = args.find(arg => !arg.startsWith("--"));

if (!taskPath) {
  console.error("Usage: bun analyze_task.ts <task-file-path> [--json]");
  process.exit(1);
}

const analysis = await analyzeTask(taskPath);

if (jsonOutput) {
  console.log(JSON.stringify(analysis, null, 2));
} else {
  if (analysis.error) {
    console.error(`Error: ${analysis.error}`);
    process.exit(1);
  }

  console.log(`Task Analysis: ${analysis.name}`);
  console.log(`─────────────────────────────────`);
  console.log(`Branch: ${analysis.branch || "(none)"}`);
  console.log(`Status: ${analysis.status}`);
  console.log(`Type: ${analysis.is_directory ? "Directory Task" : "File Task"}`);
  console.log(`Subtasks: ${analysis.has_subtasks ? analysis.subtask_files.length : 0}`);
  console.log(`Success Criteria: ${analysis.success_criteria_count}`);
  console.log(`Complexity: ${analysis.complexity}`);

  if (analysis.success_criteria.length > 0) {
    console.log(`\nSuccess Criteria:`);
    for (const criterion of analysis.success_criteria) {
      console.log(`  • ${criterion}`);
    }
  }

  if (analysis.subtask_files.length > 0) {
    console.log(`\nSubtask Files:`);
    for (const file of analysis.subtask_files) {
      console.log(`  • ${file}`);
    }
  }
}
