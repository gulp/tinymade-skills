#!/usr/bin/env bun
/**
 * update_indexes.ts - Update index entries to reflect directory task structure
 *
 * Usage:
 *   bun update_indexes.ts --task <task-name>
 *   bun update_indexes.ts --task h-implement-system
 *
 * Options:
 *   --task        Task name to update in indexes
 *   --indexes-dir Index files directory (default: sessions/tasks/indexes)
 *   --json        Output JSON result
 *   --dry-run     Preview changes without writing files
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";

interface IndexUpdate {
  index_file: string;
  index_name: string;
  old_entry: string;
  new_entry: string;
}

interface UpdateResult {
  success: boolean;
  task_name: string;
  indexes_scanned: number;
  indexes_updated: IndexUpdate[];
  errors: string[];
}

function parseArgs(): {
  task: string;
  indexesDir: string;
  json: boolean;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  let task = "";
  let indexesDir = "sessions/tasks/indexes";
  let json = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--task":
        task = args[++i] || "";
        break;
      case "--indexes-dir":
        indexesDir = args[++i] || indexesDir;
        break;
      case "--json":
        json = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
    }
  }

  return { task, indexesDir, json, dryRun };
}

function extractIndexName(content: string): string {
  // Extract name from frontmatter
  if (content.startsWith("---")) {
    const endIndex = content.indexOf("---", 3);
    if (endIndex > 0) {
      const fmContent = content.substring(3, endIndex);
      const nameMatch = fmContent.match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        return nameMatch[1].trim();
      }
    }
  }
  return "Unknown";
}

async function updateIndexes(
  taskName: string,
  indexesDir: string,
  dryRun: boolean
): Promise<UpdateResult> {
  const result: UpdateResult = {
    success: false,
    task_name: taskName,
    indexes_scanned: 0,
    indexes_updated: [],
    errors: [],
  };

  // Normalize task name
  const normalizedTask = taskName.replace(/\.md$/, "").replace(/\/$/, "");

  // Patterns to find and replace
  // Match: `task-name.md` or `task-name` (without trailing slash)
  // Replace with: `task-name/`
  const filePattern = new RegExp(
    `(\`${normalizedTask})(\.md)?(\`\\s*-\\s*)`,
    "g"
  );
  const dirPattern = new RegExp(`\`${normalizedTask}/\``, "g");

  if (!existsSync(indexesDir)) {
    result.errors.push(`Indexes directory not found: ${indexesDir}`);
    return result;
  }

  const files = readdirSync(indexesDir).filter(
    (f) => f.endsWith(".md") && f !== "INDEX_TEMPLATE.md"
  );

  result.indexes_scanned = files.length;

  for (const file of files) {
    const filePath = join(indexesDir, file);
    const content = await Bun.file(filePath).text();
    const indexName = extractIndexName(content);

    // Check if already in directory format
    if (dirPattern.test(content)) {
      // Already updated, skip
      continue;
    }

    // Check if task exists in this index (file format)
    if (!filePattern.test(content)) {
      // Task not in this index
      continue;
    }

    // Reset regex lastIndex
    filePattern.lastIndex = 0;

    // Find the original entry for reporting
    const match = content.match(filePattern);
    const oldEntry = match ? match[0] : "";

    // Replace file format with directory format
    const newContent = content.replace(
      filePattern,
      `\`${normalizedTask}/\`$3`
    );

    const update: IndexUpdate = {
      index_file: file,
      index_name: indexName,
      old_entry: oldEntry.replace(/\s*$/, ""),
      new_entry: `\`${normalizedTask}/\``,
    };

    if (!dryRun) {
      await Bun.write(filePath, newContent);
    }

    result.indexes_updated.push(update);
  }

  result.success = result.errors.length === 0;
  return result;
}

// Main execution
const { task, indexesDir, json, dryRun } = parseArgs();

if (!task) {
  console.error("Error: --task is required");
  console.error("Usage: bun update_indexes.ts --task <task-name>");
  process.exit(1);
}

const result = await updateIndexes(task, indexesDir, dryRun);

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

  console.log(`Index Update: ${result.task_name}`);
  console.log(`─────────────────────────────────`);
  console.log(`Indexes scanned: ${result.indexes_scanned}`);

  if (result.indexes_updated.length === 0) {
    console.log(`No indexes needed updating (task not found or already in directory format)`);
  } else {
    console.log(`Indexes updated: ${result.indexes_updated.length}`);
    for (const update of result.indexes_updated) {
      console.log(`\n  • ${update.index_name} (${update.index_file})`);
      console.log(`    ${update.old_entry} → ${update.new_entry}`);
    }
  }
}
