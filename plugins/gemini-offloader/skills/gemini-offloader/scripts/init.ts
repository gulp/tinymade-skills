#!/usr/bin/env bun
/**
 * Initialize/scaffold the gemini-offloader state directory.
 *
 * Usage:
 *   bun run scripts/init.ts              # Initialize with defaults
 *   bun run scripts/init.ts --status     # Show current state
 *   bun run scripts/init.ts --repair     # Repair/validate installation
 *   bun run scripts/init.ts --reset      # Reset config to defaults (keeps data)
 *
 * Output JSON:
 *   {
 *     "success": true,
 *     "action": "initialized",
 *     "paths": { ... },
 *     "config": { ... }
 *   }
 */

import { parseArgs } from "util";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  ensureBaseDir,
  ensureProjectDir,
  loadConfig,
  saveConfig,
  getBasePaths,
  getProjectHash,
  loadLocalIndex
} from "./state";
import type { GlobalConfig } from "./state";

interface InitResult {
  success: boolean;
  action: "initialized" | "repaired" | "reset" | "status";
  paths: {
    base_dir: string;
    config_file: string;
    index_file: string;
    projects_dir: string;
  };
  created: string[];
  config: GlobalConfig;
  stats?: {
    project_count: number;
    total_cache_entries: number;
    total_sessions: number;
    index_entries: number;
  };
  error: string | null;
}

async function getStats(): Promise<{
  project_count: number;
  total_cache_entries: number;
  total_sessions: number;
  index_entries: number;
}> {
  const { PROJECTS_DIR } = getBasePaths();
  let project_count = 0;
  let total_cache_entries = 0;
  let total_sessions = 0;

  if (existsSync(PROJECTS_DIR)) {
    const projects = readdirSync(PROJECTS_DIR, { withFileTypes: true });
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      project_count++;

      const cacheDir = join(PROJECTS_DIR, project.name, "cache");
      if (existsSync(cacheDir)) {
        const caches = readdirSync(cacheDir, { withFileTypes: true });
        total_cache_entries += caches.filter(c => c.isDirectory()).length;
      }

      const sessionsDir = join(PROJECTS_DIR, project.name, "sessions");
      if (existsSync(sessionsDir)) {
        const sessions = readdirSync(sessionsDir, { withFileTypes: true });
        total_sessions += sessions.filter(s => s.isDirectory()).length;
      }
    }
  }

  const index = await loadLocalIndex();
  const index_entries = index.entries.length;

  return { project_count, total_cache_entries, total_sessions, index_entries };
}

async function initialize(repair: boolean = false): Promise<InitResult> {
  const paths = getBasePaths();
  const created: string[] = [];

  try {
    // Create base directories
    if (!existsSync(paths.BASE_DIR) || repair) {
      ensureBaseDir();
      if (!created.includes(paths.BASE_DIR)) {
        created.push(paths.BASE_DIR);
      }
    }

    if (!existsSync(paths.PROJECTS_DIR) || repair) {
      ensureBaseDir();
      if (!created.includes(paths.PROJECTS_DIR)) {
        created.push(paths.PROJECTS_DIR);
      }
    }

    // Initialize config
    const config = await loadConfig();

    // Create project dir for current project
    const projectHash = await getProjectHash();
    const projectDir = ensureProjectDir(projectHash);
    if (!created.includes(projectDir)) {
      created.push(projectDir);
    }

    // Ensure index file exists
    await loadLocalIndex();
    if (!existsSync(paths.INDEX_FILE)) {
      created.push(paths.INDEX_FILE);
    }

    const stats = await getStats();

    return {
      success: true,
      action: repair ? "repaired" : "initialized",
      paths: {
        base_dir: paths.BASE_DIR,
        config_file: paths.CONFIG_FILE,
        index_file: paths.INDEX_FILE,
        projects_dir: paths.PROJECTS_DIR
      },
      created,
      config,
      stats,
      error: null
    };
  } catch (e) {
    return {
      success: false,
      action: repair ? "repaired" : "initialized",
      paths: {
        base_dir: paths.BASE_DIR,
        config_file: paths.CONFIG_FILE,
        index_file: paths.INDEX_FILE,
        projects_dir: paths.PROJECTS_DIR
      },
      created,
      config: await loadConfig(),
      error: String(e)
    };
  }
}

async function showStatus(): Promise<InitResult> {
  const paths = getBasePaths();

  try {
    const config = await loadConfig();
    const stats = await getStats();

    return {
      success: true,
      action: "status",
      paths: {
        base_dir: paths.BASE_DIR,
        config_file: paths.CONFIG_FILE,
        index_file: paths.INDEX_FILE,
        projects_dir: paths.PROJECTS_DIR
      },
      created: [],
      config,
      stats,
      error: null
    };
  } catch (e) {
    return {
      success: false,
      action: "status",
      paths: {
        base_dir: paths.BASE_DIR,
        config_file: paths.CONFIG_FILE,
        index_file: paths.INDEX_FILE,
        projects_dir: paths.PROJECTS_DIR
      },
      created: [],
      config: {} as GlobalConfig,
      error: String(e)
    };
  }
}

async function setMem0Mode(mode: "hosted" | "local"): Promise<InitResult> {
  const paths = getBasePaths();

  try {
    const config = await loadConfig();
    config.mem0_mode = mode;
    await saveConfig(config);
    const stats = await getStats();

    return {
      success: true,
      action: "status",
      paths: {
        base_dir: paths.BASE_DIR,
        config_file: paths.CONFIG_FILE,
        index_file: paths.INDEX_FILE,
        projects_dir: paths.PROJECTS_DIR
      },
      created: [],
      config,
      stats,
      error: null
    };
  } catch (e) {
    return {
      success: false,
      action: "status",
      paths: {
        base_dir: paths.BASE_DIR,
        config_file: paths.CONFIG_FILE,
        index_file: paths.INDEX_FILE,
        projects_dir: paths.PROJECTS_DIR
      },
      created: [],
      config: {} as GlobalConfig,
      error: String(e)
    };
  }
}

async function resetConfig(): Promise<InitResult> {
  const paths = getBasePaths();

  try {
    const defaultConfig: GlobalConfig = {
      version: "1.0.0",
      default_model: "gemini-2.5-pro",
      cache_enabled: true,
      cache_ttl_days: 30,
      mem0_enabled: true,
      mem0_mode: "hosted",
      mem0_local_config: {
        llm_provider: "groq",
        llm_model: "llama-3.1-8b-instant",
        embedder_provider: "ollama",
        embedder_model: "nomic-embed-text"
      },
      summary_max_tokens: 500,
      projects: {}
    };

    await saveConfig(defaultConfig);
    const stats = await getStats();

    return {
      success: true,
      action: "reset",
      paths: {
        base_dir: paths.BASE_DIR,
        config_file: paths.CONFIG_FILE,
        index_file: paths.INDEX_FILE,
        projects_dir: paths.PROJECTS_DIR
      },
      created: [],
      config: defaultConfig,
      stats,
      error: null
    };
  } catch (e) {
    return {
      success: false,
      action: "reset",
      paths: {
        base_dir: paths.BASE_DIR,
        config_file: paths.CONFIG_FILE,
        index_file: paths.INDEX_FILE,
        projects_dir: paths.PROJECTS_DIR
      },
      created: [],
      config: {} as GlobalConfig,
      error: String(e)
    };
  }
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      status: { type: "boolean", short: "s" },
      repair: { type: "boolean", short: "r" },
      reset: { type: "boolean" },
      "mem0-mode": { type: "string", short: "m" }
    },
    allowPositionals: false
  });

  let result: InitResult;

  if (values["mem0-mode"]) {
    const mode = values["mem0-mode"] as string;
    if (mode !== "hosted" && mode !== "local") {
      console.log(JSON.stringify({ success: false, error: "mem0-mode must be 'hosted' or 'local'" }));
      process.exit(1);
    }
    result = await setMem0Mode(mode);
  } else if (values.status) {
    result = await showStatus();
  } else if (values.reset) {
    result = await resetConfig();
  } else {
    result = await initialize(values.repair);
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main();
