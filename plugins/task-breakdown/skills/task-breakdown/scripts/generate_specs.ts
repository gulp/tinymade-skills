#!/usr/bin/env bun
/**
 * generate_specs.ts - Generate spec artifacts for phased breakdown
 *
 * Creates specs/ directory with data-model.md, contracts/, and quickstart.md
 *
 * Usage:
 *   bun generate_specs.ts <task-dir-path> [--json] [--dry-run]
 *
 * The task must be a directory task (have README.md as the parent task file).
 * Creates:
 *   - specs/data-model.md - Shared entity schemas
 *   - specs/contracts/ - Directory for API contracts
 *   - specs/quickstart.md - Runtime testing guidance
 */

import { existsSync, mkdirSync, readdirSync } from "fs";
import { basename, dirname, join } from "path";

interface SpecGenerationResult {
  task_dir: string;
  task_name: string;
  specs_created: string[];
  success: boolean;
  dry_run: boolean;
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

function extractTaskTitle(content: string): string {
  // Look for first H1 heading
  const h1Match = content.match(/^# (.+)$/m);
  return h1Match ? h1Match[1].trim() : "Unknown Task";
}

function extractProblemGoal(content: string): string {
  const problemMatch = content.match(/## Problem\/Goal[\s\S]*?(?=\n## |$)/i);
  if (!problemMatch) return "";

  // Extract just the content, not the heading
  const section = problemMatch[0].replace(/^## Problem\/Goal\s*/i, "").trim();
  return section.split("\n").slice(0, 3).join("\n"); // First 3 lines
}

async function loadTemplate(templatePath: string): Promise<string> {
  if (!existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  return await Bun.file(templatePath).text();
}

function substituteTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\[${key}\\]`, "g"), value);
  }
  return result;
}

async function generateSpecs(taskDir: string, dryRun: boolean): Promise<SpecGenerationResult> {
  const result: SpecGenerationResult = {
    task_dir: taskDir,
    task_name: "",
    specs_created: [],
    success: false,
    dry_run: dryRun,
  };

  // Validate task directory
  if (!existsSync(taskDir)) {
    result.error = `Task directory not found: ${taskDir}`;
    return result;
  }

  const readmePath = join(taskDir, "README.md");
  if (!existsSync(readmePath)) {
    result.error = `Not a directory task (no README.md): ${taskDir}`;
    return result;
  }

  // Read parent task
  const readmeContent = await Bun.file(readmePath).text();
  const frontmatter = parseFrontmatter(readmeContent);

  result.task_name = frontmatter.name || basename(taskDir);
  const taskTitle = extractTaskTitle(readmeContent);
  const problemGoal = extractProblemGoal(readmeContent);

  // Find templates
  const scriptDir = dirname(import.meta.path);
  const assetsDir = join(scriptDir, "..", "assets");

  // Create specs directory
  const specsDir = join(taskDir, "specs");
  const contractsDir = join(specsDir, "contracts");

  if (!dryRun) {
    if (!existsSync(specsDir)) {
      mkdirSync(specsDir, { recursive: true });
    }
    if (!existsSync(contractsDir)) {
      mkdirSync(contractsDir, { recursive: true });
    }
  }

  const templateVars = {
    "Task Name": result.task_name,
    "Original Task Title": taskTitle,
    "task-dir": basename(taskDir),
    "parent-task-name": result.task_name,
  };

  // Generate data-model.md
  try {
    const dataModelTemplate = await loadTemplate(join(assetsDir, "data-model-template.md"));
    const dataModelContent = substituteTemplate(dataModelTemplate, templateVars);
    const dataModelPath = join(specsDir, "data-model.md");

    if (!dryRun) {
      await Bun.write(dataModelPath, dataModelContent);
    }
    result.specs_created.push("specs/data-model.md");
  } catch (e) {
    result.error = `Failed to create data-model.md: ${e}`;
    return result;
  }

  // Generate quickstart.md
  try {
    const quickstartTemplate = await loadTemplate(join(assetsDir, "quickstart-template.md"));
    const quickstartContent = substituteTemplate(quickstartTemplate, templateVars);
    const quickstartPath = join(specsDir, "quickstart.md");

    if (!dryRun) {
      await Bun.write(quickstartPath, quickstartContent);
    }
    result.specs_created.push("specs/quickstart.md");
  } catch (e) {
    result.error = `Failed to create quickstart.md: ${e}`;
    return result;
  }

  // Generate placeholder contract
  try {
    const contractTemplate = await loadTemplate(join(assetsDir, "contract-template.md"));
    const contractContent = substituteTemplate(contractTemplate, {
      ...templateVars,
      "Service/Component Name": "Main API",
      resource: "resource",
    });
    const contractPath = join(contractsDir, "main-api.md");

    if (!dryRun) {
      await Bun.write(contractPath, contractContent);
    }
    result.specs_created.push("specs/contracts/main-api.md");
  } catch (e) {
    result.error = `Failed to create contract: ${e}`;
    return result;
  }

  result.success = true;
  return result;
}

// Main execution
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const dryRun = args.includes("--dry-run");
const taskDir = args.find((arg) => !arg.startsWith("--"));

if (!taskDir) {
  console.error("Usage: bun generate_specs.ts <task-dir-path> [--json] [--dry-run]");
  process.exit(1);
}

const result = await generateSpecs(taskDir, dryRun);

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (result.error) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  const modeLabel = result.dry_run ? "[DRY RUN] " : "";
  console.log(`${modeLabel}Spec Generation: ${result.task_name}`);
  console.log(`─────────────────────────────────`);
  console.log(`Task Directory: ${result.task_dir}`);
  console.log(`\n${modeLabel}Files created:`);
  for (const spec of result.specs_created) {
    console.log(`  ✓ ${spec}`);
  }
  console.log(`\nSuccess: ${result.success}`);
}
