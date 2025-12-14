#!/usr/bin/env bun
/**
 * generate_phases.ts - Create phased directory structure for parallel breakdown
 *
 * Creates phase_N_parallel/ and phase_N_sequential/ directories with P[phase]_[task]_name.md files.
 *
 * Usage:
 *   bun generate_phases.ts --parent <task-name> --phases '<json-array>'
 *   bun generate_phases.ts --parent h-implement-system --phases '[{"phase":1,"type":"parallel","tasks":[...]}]'
 *
 * Options:
 *   --parent      Parent task name (without .md extension)
 *   --phases      JSON array of phase definitions
 *   --tasks-dir   Base tasks directory (default: sessions/tasks)
 *   --json        Output JSON result
 *   --dry-run     Preview changes without writing files
 *   --with-specs  Also generate specs/ directory
 */

import { existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import { basename, dirname, join } from "path";

interface TaskDefinition {
  name: string;
  title?: string;
  objective: string;
  requirements: string;
  criteria: string[];
  depends_on?: string[];
  blocks?: string[];
}

interface PhaseDefinition {
  phase: number;
  type: "parallel" | "sequential";
  description: string;
  tasks: TaskDefinition[];
}

interface PhaseGenerationResult {
  success: boolean;
  parent_task: string;
  parent_dir: string;
  parent_branch: string | null;
  converted_to_directory: boolean;
  phases_created: {
    phase: number;
    type: string;
    directory: string;
    tasks: string[];
  }[];
  breakdown_overview_created: boolean;
  specs_created: boolean;
  errors: string[];
}

function parseArgs(): {
  parent: string;
  phases: PhaseDefinition[];
  tasksDir: string;
  json: boolean;
  dryRun: boolean;
  withSpecs: boolean;
} {
  const args = process.argv.slice(2);
  let parent = "";
  let phasesJson = "";
  let tasksDir = "sessions/tasks";
  let json = false;
  let dryRun = false;
  let withSpecs = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--parent":
        parent = args[++i] || "";
        break;
      case "--phases":
        phasesJson = args[++i] || "";
        break;
      case "--tasks-dir":
        tasksDir = args[++i] || tasksDir;
        break;
      case "--json":
        json = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--with-specs":
        withSpecs = true;
        break;
    }
  }

  let phases: PhaseDefinition[] = [];
  if (phasesJson) {
    try {
      phases = JSON.parse(phasesJson);
    } catch (e) {
      console.error("Error parsing --phases JSON:", e);
      process.exit(1);
    }
  }

  return { parent, phases, tasksDir, json, dryRun, withSpecs };
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function generatePhasedTaskContent(
  task: TaskDefinition,
  phase: PhaseDefinition,
  parentName: string,
  parentBranch: string | null,
  taskIndex: number
): string {
  const taskId = `P${phase.phase}_${taskIndex + 1}`;
  const fullName = `${taskId}_${task.name}`;
  const title = task.title || task.name.replace(/-/g, " ");
  const capitalizedTitle = title.charAt(0).toUpperCase() + title.slice(1);

  const dependsOn = task.depends_on || [];
  const blocks = task.blocks || [];
  const isParallel = phase.type === "parallel";

  let content = `---
name: ${fullName}
parent: ${parentName}
phase: ${phase.phase}
parallel: ${isParallel}
depends_on: [${dependsOn.join(", ")}]
blocks: [${blocks.join(", ")}]
status: pending
created: ${getToday()}
---

# Task: ${capitalizedTitle}

## Context
This task is part of a larger project breakdown for: ${parentName}

### Task Position
- **Phase**: Phase ${phase.phase} - ${phase.description} (${phase.type === "parallel" ? "Parallel" : "Sequential"})
- **Task ID**: ${taskId}
- **Execution**: ${isParallel ? `Runs in parallel with other Phase ${phase.phase} tasks` : `Runs sequentially after Phase ${phase.phase - 1} completes`}

### Related Tasks
- **Dependencies**: ${dependsOn.length > 0 ? dependsOn.join(", ") : "None"}
- **Parallel Tasks**: ${isParallel ? `Other Phase ${phase.phase} tasks` : "N/A (sequential)"}
- **Dependent Tasks**: ${blocks.length > 0 ? blocks.join(", ") : "None identified"}
- **Shared Resources**: See specs/data-model.md and specs/contracts/

## Objective
${task.objective}

## Detailed Requirements
${task.requirements}

## Success Criteria
`;

  for (const criterion of task.criteria) {
    content += `- [ ] ${criterion}\n`;
  }

  content += `
## Context Manifest
<!-- Added by context-gathering agent if needed -->
<!-- Reference specs/data-model.md and specs/contracts/ for shared definitions -->

## Para Finish Command
When complete, run: \`para finish "${capitalizedTitle} implementation" --branch ${parentBranch || "feature/" + parentName}\`
`;

  return content;
}

function generateBreakdownOverview(
  parentName: string,
  parentBranch: string | null,
  phases: PhaseDefinition[],
  parentSummary: string
): string {
  const today = getToday();
  let content = `# Task Breakdown: ${parentName}

## Original Task
${parentSummary}

## Breakdown Strategy
Applied phased parallel decomposition to maximize concurrent execution while respecting dependencies.

## Spec Artifacts
- \`specs/data-model.md\` - Shared entity schemas and type definitions
- \`specs/contracts/\` - API interface definitions
- \`specs/quickstart.md\` - Runtime testing guidance

## Execution Plan

`;

  for (const phase of phases) {
    const phaseTypeLabel = phase.type === "parallel" ? "Parallel Execution" : "Sequential Execution";
    content += `### Phase ${phase.phase}: ${phase.description} (${phaseTypeLabel})\n`;

    if (phase.type === "parallel") {
      content += `**All tasks in this phase run simultaneously:**\n`;
    } else {
      content += `**Runs AFTER Phase ${phase.phase - 1} completes:**\n`;
    }

    for (let i = 0; i < phase.tasks.length; i++) {
      const task = phase.tasks[i];
      const taskId = `P${phase.phase}_${i + 1}`;
      content += `- \`${taskId}_${task.name}.md\`: ${task.title || task.name}\n`;
    }

    if (phase.type === "parallel") {
      content += `\nPara dispatch commands:\n\`\`\`bash\n`;
      content += `# Dispatch all Phase ${phase.phase} tasks in parallel\n`;
      for (let i = 0; i < phase.tasks.length; i++) {
        const task = phase.tasks[i];
        const taskId = `P${phase.phase}_${i + 1}`;
        const phaseDir = `phase_${phase.phase}_parallel`;
        content += `para dispatch agent-p${phase.phase}-${i + 1} --file [task-dir]/${phaseDir}/${taskId}_${task.name}.md --dangerously-skip-permissions\n`;
      }
      content += `\`\`\`\n`;
    }

    content += `\n`;
  }

  // Calculate totals
  const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);
  const parallelPhases = phases.filter((p) => p.type === "parallel");
  const maxParallel = parallelPhases.length > 0
    ? Math.max(...parallelPhases.map((p) => p.tasks.length))
    : 0;

  content += `## Dependency Visualization

### Matrix
<!-- Generated by visualize_dependencies.ts -->
| Task | Depends On | Blocks | Parallel |
|------|------------|--------|----------|
`;

  for (const phase of phases) {
    for (let i = 0; i < phase.tasks.length; i++) {
      const task = phase.tasks[i];
      const taskId = `P${phase.phase}_${i + 1}`;
      const dependsOn = task.depends_on?.join(", ") || "-";
      const blocks = task.blocks?.join(", ") || "-";
      content += `| ${taskId} | ${dependsOn} | ${blocks} | ${phase.type === "parallel" ? "Yes" : "No"} |\n`;
    }
  }

  content += `
### Graph
\`\`\`mermaid
graph TD
`;

  for (const phase of phases) {
    for (let i = 0; i < phase.tasks.length; i++) {
      const task = phase.tasks[i];
      const taskId = `P${phase.phase}_${i + 1}`;
      const label = task.title || task.name;
      content += `  ${taskId}[${label}]\n`;

      // Add dependency arrows
      if (task.depends_on) {
        for (const dep of task.depends_on) {
          content += `  ${dep} --> ${taskId}\n`;
        }
      }
    }
  }

  content += `\`\`\`

## Notes
- Total subtasks: ${totalTasks}
- Parallel execution opportunities: ${parallelPhases.length} phases
- Maximum parallel tasks: ${maxParallel}
- Sequential dependencies: Phase transitions

## Work Log
- [${today}] Breakdown created
`;

  return content;
}

async function readParentContent(filePath: string): Promise<{
  branch: string | null;
  content: string;
  summary: string;
}> {
  if (!existsSync(filePath)) {
    return { branch: null, content: "", summary: "" };
  }

  const content = await Bun.file(filePath).text();
  let branch: string | null = null;

  // Extract branch from frontmatter
  if (content.startsWith("---")) {
    const endIndex = content.indexOf("---", 3);
    if (endIndex > 0) {
      const fmContent = content.substring(3, endIndex);
      const branchMatch = fmContent.match(/^branch:\s*(.+)$/m);
      if (branchMatch) {
        branch = branchMatch[1].trim();
      }
    }
  }

  // Extract problem/goal as summary
  let summary = "";
  const problemMatch = content.match(/## Problem\/Goal[\s\S]*?(?=\n## |$)/i);
  if (problemMatch) {
    summary = problemMatch[0].replace(/^## Problem\/Goal\s*/i, "").trim();
    // Take first paragraph only
    summary = summary.split("\n\n")[0];
  }

  return { branch, content, summary };
}

async function generatePhases(
  parent: string,
  phases: PhaseDefinition[],
  tasksDir: string,
  dryRun: boolean,
  withSpecs: boolean
): Promise<PhaseGenerationResult> {
  const result: PhaseGenerationResult = {
    success: false,
    parent_task: parent,
    parent_dir: "",
    parent_branch: null,
    converted_to_directory: false,
    phases_created: [],
    breakdown_overview_created: false,
    specs_created: false,
    errors: [],
  };

  // Normalize parent name
  const parentName = parent.replace(/\.md$/, "").replace(/\/$/, "");

  // Determine paths
  const parentFilePath = join(tasksDir, `${parentName}.md`);
  const parentDirPath = join(tasksDir, parentName);
  const parentReadmePath = join(parentDirPath, "README.md");

  result.parent_dir = parentDirPath;

  // Check if parent exists
  const isFile = existsSync(parentFilePath);
  const isDir = existsSync(parentDirPath);

  if (!isFile && !isDir) {
    result.errors.push(`Parent task not found: ${parentFilePath} or ${parentDirPath}`);
    return result;
  }

  // Get parent info
  const parentPath = isDir ? parentReadmePath : parentFilePath;
  const { branch: parentBranch, content: parentContent, summary: parentSummary } =
    await readParentContent(parentPath);

  result.parent_branch = parentBranch;

  if (!parentBranch && !isDir) {
    result.errors.push("Parent task has no branch field - cannot create phased breakdown");
    return result;
  }

  // Convert file to directory if needed
  if (isFile && !isDir) {
    if (!dryRun) {
      mkdirSync(parentDirPath, { recursive: true });
      renameSync(parentFilePath, parentReadmePath);
    }
    result.converted_to_directory = true;
  }

  // Create phase directories and task files
  for (const phase of phases) {
    const phaseDir = `phase_${phase.phase}_${phase.type}`;
    const phasePath = join(parentDirPath, phaseDir);

    if (!dryRun) {
      mkdirSync(phasePath, { recursive: true });
    }

    const phaseResult = {
      phase: phase.phase,
      type: phase.type,
      directory: phaseDir,
      tasks: [] as string[],
    };

    for (let i = 0; i < phase.tasks.length; i++) {
      const task = phase.tasks[i];
      const taskId = `P${phase.phase}_${i + 1}`;
      const fileName = `${taskId}_${task.name}.md`;
      const taskPath = join(phasePath, fileName);

      const content = generatePhasedTaskContent(
        task,
        phase,
        parentName,
        parentBranch,
        i
      );

      if (!dryRun) {
        await Bun.write(taskPath, content);
      }

      phaseResult.tasks.push(fileName);
    }

    result.phases_created.push(phaseResult);
  }

  // Generate BREAKDOWN_OVERVIEW.md
  const overviewPath = join(parentDirPath, "BREAKDOWN_OVERVIEW.md");
  const overviewContent = generateBreakdownOverview(
    parentName,
    parentBranch,
    phases,
    parentSummary
  );

  if (!dryRun) {
    await Bun.write(overviewPath, overviewContent);
  }
  result.breakdown_overview_created = true;

  // Generate specs if requested
  if (withSpecs) {
    const specsDir = join(parentDirPath, "specs");
    const contractsDir = join(specsDir, "contracts");

    if (!dryRun) {
      mkdirSync(contractsDir, { recursive: true });

      // Create placeholder files
      await Bun.write(
        join(specsDir, "data-model.md"),
        `# Data Model: ${parentName}\n\n## Overview\nShared entity schemas for this breakdown.\n\n## Entities\n<!-- Define shared types here -->\n`
      );

      await Bun.write(
        join(specsDir, "quickstart.md"),
        `# Quickstart: ${parentName}\n\n## Overview\nRuntime testing guidance.\n\n## Prerequisites\n<!-- List requirements -->\n\n## Setup\n<!-- Setup instructions -->\n`
      );

      await Bun.write(
        join(contractsDir, ".gitkeep"),
        "# Place API contracts here\n"
      );
    }
    result.specs_created = true;
  }

  result.success = result.errors.length === 0;
  return result;
}

// Main execution
const { parent, phases, tasksDir, json, dryRun, withSpecs } = parseArgs();

if (!parent) {
  console.error("Error: --parent is required");
  console.error(
    "Usage: bun generate_phases.ts --parent <task-name> --phases '<json>' [--with-specs]"
  );
  process.exit(1);
}

if (phases.length === 0) {
  console.error("Error: --phases is required and must be a non-empty JSON array");
  process.exit(1);
}

const result = await generatePhases(parent, phases, tasksDir, dryRun, withSpecs);

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (dryRun) {
    console.log("[DRY RUN] No files written\n");
  }

  if (result.errors.length > 0) {
    console.error("Errors:");
    for (const error of result.errors) {
      console.error(`  • ${error}`);
    }
    process.exit(1);
  }

  console.log(`Phased Breakdown: ${result.parent_task}`);
  console.log(`═════════════════════════════════════════════`);
  console.log(`Branch: ${result.parent_branch || "(none)"}`);

  if (result.converted_to_directory) {
    console.log(`✓ Converted to directory task`);
  }

  console.log(`\nPhases created:`);
  for (const phase of result.phases_created) {
    const icon = phase.type === "parallel" ? "║" : "│";
    console.log(`  ${icon} ${phase.directory}/`);
    for (const task of phase.tasks) {
      console.log(`      • ${task}`);
    }
  }

  if (result.breakdown_overview_created) {
    console.log(`\n✓ Created BREAKDOWN_OVERVIEW.md`);
  }

  if (result.specs_created) {
    console.log(`✓ Created specs/ directory with templates`);
  }

  console.log(`\nDirectory: ${result.parent_dir}/`);
}
