#!/usr/bin/env bun
/**
 * generate_subtasks.ts - Create subtask files from breakdown proposal
 *
 * Usage:
 *   bun generate_subtasks.ts --parent <task-name> --subtasks '<json-array>'
 *   bun generate_subtasks.ts --parent h-implement-system --subtasks '[{"name":"01-setup","problem":"...","criteria":["..."]}]'
 *
 * Options:
 *   --parent    Parent task name (without .md extension)
 *   --subtasks  JSON array of subtask definitions
 *   --tasks-dir Base tasks directory (default: sessions/tasks)
 *   --json      Output JSON result
 *   --dry-run   Preview changes without writing files
 */

import { existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import { basename, join } from "path";

interface SubtaskDefinition {
  name: string;
  title?: string;
  problem: string;
  criteria: string[];
}

interface GenerationResult {
  success: boolean;
  parent_task: string;
  parent_dir: string;
  converted_to_directory: boolean;
  subtasks_created: string[];
  parent_updated: boolean;
  errors: string[];
}

function parseArgs(): {
  parent: string;
  subtasks: SubtaskDefinition[];
  tasksDir: string;
  json: boolean;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  let parent = "";
  let subtasksJson = "";
  let tasksDir = "sessions/tasks";
  let json = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--parent":
        parent = args[++i] || "";
        break;
      case "--subtasks":
        subtasksJson = args[++i] || "";
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
    }
  }

  let subtasks: SubtaskDefinition[] = [];
  if (subtasksJson) {
    try {
      subtasks = JSON.parse(subtasksJson);
    } catch (e) {
      console.error("Error parsing --subtasks JSON:", e);
      process.exit(1);
    }
  }

  return { parent, subtasks, tasksDir, json, dryRun };
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function generateSubtaskContent(
  subtask: SubtaskDefinition,
  parentName: string
): string {
  const title = subtask.title || subtask.name.replace(/^\d+-/, "").replace(/-/g, " ");
  const capitalizedTitle = title.charAt(0).toUpperCase() + title.slice(1);

  let content = `---
name: ${subtask.name}
parent: ${parentName}
status: pending
created: ${getToday()}
---

# ${capitalizedTitle}

## Problem/Goal
${subtask.problem}

## Success Criteria
`;

  for (const criterion of subtask.criteria) {
    content += `- [ ] ${criterion}\n`;
  }

  content += `
## Context Manifest
<!-- Added by context-gathering agent if needed -->

## Work Log
- [${getToday()}] Subtask created from breakdown
`;

  return content;
}

function generateSubtasksSection(subtasks: SubtaskDefinition[]): string {
  let section = "\n## Subtasks\n\n";

  for (const subtask of subtasks) {
    const title = subtask.title || subtask.name.replace(/^\d+-/, "").replace(/-/g, " ");
    section += `### \`${subtask.name}.md\`\n\n`;
    section += `**Problem:** ${subtask.problem}\n\n`;
    section += `**Success Criteria:**\n`;
    for (const criterion of subtask.criteria) {
      section += `- ${criterion}\n`;
    }
    section += "\n";
  }

  return section;
}

async function readParentFrontmatter(filePath: string): Promise<{ branch: string | null; content: string }> {
  if (!existsSync(filePath)) {
    return { branch: null, content: "" };
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

  return { branch, content };
}

async function generateSubtasks(
  parent: string,
  subtasks: SubtaskDefinition[],
  tasksDir: string,
  dryRun: boolean
): Promise<GenerationResult> {
  const result: GenerationResult = {
    success: false,
    parent_task: parent,
    parent_dir: "",
    converted_to_directory: false,
    subtasks_created: [],
    parent_updated: false,
    errors: [],
  };

  // Normalize parent name (remove .md if present)
  const parentName = parent.replace(/\.md$/, "").replace(/\/$/, "");

  // Determine paths
  const parentFilePath = join(tasksDir, `${parentName}.md`);
  const parentDirPath = join(tasksDir, parentName);
  const parentReadmePath = join(parentDirPath, "README.md");

  result.parent_dir = parentDirPath;

  // Check if parent exists as file or directory
  const isFile = existsSync(parentFilePath);
  const isDir = existsSync(parentDirPath);

  if (!isFile && !isDir) {
    result.errors.push(`Parent task not found: ${parentFilePath} or ${parentDirPath}`);
    return result;
  }

  // Get parent branch for validation
  const parentPath = isDir ? parentReadmePath : parentFilePath;
  const { branch: parentBranch, content: parentContent } = await readParentFrontmatter(parentPath);

  if (!parentBranch && !isDir) {
    result.errors.push("Parent task has no branch field - cannot create subtasks");
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

  // Create subtask files
  for (const subtask of subtasks) {
    // Ensure name has proper format (numeric prefix)
    let subtaskName = subtask.name;
    if (!/^\d{2}-/.test(subtaskName)) {
      // If no numeric prefix, don't add one - let user control naming
    }

    const subtaskPath = join(parentDirPath, `${subtaskName}.md`);
    const content = generateSubtaskContent(subtask, parentName);

    if (!dryRun) {
      await Bun.write(subtaskPath, content);
    }
    result.subtasks_created.push(`${subtaskName}.md`);
  }

  // Update parent README.md with subtasks section
  // In dry-run mode with conversion, read from original file; otherwise read from readme
  const readmePath = isDir ? parentReadmePath : join(parentDirPath, "README.md");
  const sourcePathForRead = (dryRun && result.converted_to_directory) ? parentFilePath : readmePath;
  const shouldUpdateParent = existsSync(sourcePathForRead) || (!dryRun && result.converted_to_directory);

  if (shouldUpdateParent) {
    const currentContent = await Bun.file(sourcePathForRead).text();

    // Check if subtasks section already exists (at start of line, not in code examples)
    const hasSubtasksSection = /^## Subtasks\s*$/m.test(currentContent);
    if (!hasSubtasksSection) {
      const subtasksSection = generateSubtasksSection(subtasks);

      // Insert before ## User Notes or ## Work Log, or at end
      let insertPoint = currentContent.length;
      const userNotesMatch = currentContent.indexOf("## User Notes");
      const workLogMatch = currentContent.indexOf("## Work Log");

      if (userNotesMatch > 0) {
        insertPoint = userNotesMatch;
      } else if (workLogMatch > 0) {
        insertPoint = workLogMatch;
      }

      const newContent =
        currentContent.slice(0, insertPoint) +
        subtasksSection +
        currentContent.slice(insertPoint);

      if (!dryRun) {
        await Bun.write(readmePath, newContent);
      }
      result.parent_updated = true;
    }
  }

  result.success = result.errors.length === 0;
  return result;
}

// Main execution
const { parent, subtasks, tasksDir, json, dryRun } = parseArgs();

if (!parent) {
  console.error("Error: --parent is required");
  console.error("Usage: bun generate_subtasks.ts --parent <task-name> --subtasks '<json>'");
  process.exit(1);
}

if (subtasks.length === 0) {
  console.error("Error: --subtasks is required and must be a non-empty JSON array");
  process.exit(1);
}

const result = await generateSubtasks(parent, subtasks, tasksDir, dryRun);

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

  console.log(`Subtask Generation: ${result.parent_task}`);
  console.log(`─────────────────────────────────`);

  if (result.converted_to_directory) {
    console.log(`✓ Converted to directory task`);
  }

  console.log(`✓ Created ${result.subtasks_created.length} subtask(s):`);
  for (const file of result.subtasks_created) {
    console.log(`  • ${file}`);
  }

  if (result.parent_updated) {
    console.log(`✓ Updated parent README.md with subtasks section`);
  }

  console.log(`\nDirectory: ${result.parent_dir}/`);
}
