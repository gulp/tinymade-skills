#!/usr/bin/env bun
/**
 * Execute a single gemini query with structured output.
 * Handles prompt formatting, output parsing, error handling, and caching.
 *
 * Enhanced with persistent state layer:
 * - Checks cache before calling gemini (returns summary if hit)
 * - Stores results to ~/.gemini_offloader/ on cache miss
 * - Indexes in mem0 for semantic search
 *
 * Usage:
 *   bun run scripts/query.ts --prompt "Your question here"
 *   bun run scripts/query.ts --prompt "Question" --model gemini-2.5-flash
 *   bun run scripts/query.ts --prompt "Question" --output result.md
 *   bun run scripts/query.ts --prompt "Question" --include-dirs ./src,./docs
 *   bun run scripts/query.ts --prompt "Question" --no-cache  # Skip cache
 *   echo "context" | bun run scripts/query.ts --prompt "Summarize this"
 *
 * Output JSON:
 *   {
 *     "success": true,
 *     "response": "The summary (not full response)",
 *     "model": "gemini-2.5-pro",
 *     "cached": true,
 *     "full_response_path": "~/.gemini_offloader/...",
 *     "error": null
 *   }
 */

import { $ } from "bun";
import { parseArgs } from "util";
import {
  getProjectHash,
  generateSourceHash,
  lookupCache,
  writeCache,
  loadConfig,
  updateProjectAccess,
  generateSimpleSummary,
  estimateTokens,
  getSourcePath
} from "./state";
import { indexOffload } from "./memory";

interface QueryResult {
  success: boolean;
  response: string | null;
  model: string | null;
  saved_to?: string;
  cached?: boolean;
  cache_stale?: boolean;
  full_response_path?: string;
  error: string | null;
}

async function findGemini(): Promise<string | null> {
  try {
    const result = await $`which gemini`.text();
    return result.trim() || null;
  } catch {
    return null;
  }
}

async function readStdin(): Promise<string | null> {
  if (Bun.stdin.isTTY) return null;

  const chunks: Buffer[] = [];
  const reader = Bun.stdin.stream().getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }

  const content = Buffer.concat(chunks).toString("utf-8").trim();
  return content || null;
}

async function runQuery(args: {
  prompt: string;
  model?: string;
  includeDirs?: string;
  yolo?: boolean;
  output?: string;
  timeout?: number;
  noCache?: boolean;
}): Promise<QueryResult> {
  const config = await loadConfig();
  const projectHash = await getProjectHash();

  // Update project access timestamp
  await updateProjectAccess(projectHash);

  // Generate source hash for cache lookup
  const { hash: sourceHash, files: sourceFiles, sourceType } = await generateSourceHash({
    prompt: args.prompt,
    includeDirs: args.includeDirs,
    model: args.model
  });

  // Check cache if enabled
  if (config.cache_enabled && !args.noCache) {
    const cacheResult = await lookupCache(projectHash, sourceHash);

    if (cacheResult.hit && !cacheResult.stale && cacheResult.summary) {
      return {
        success: true,
        response: cacheResult.summary,
        model: cacheResult.metadata?.model || null,
        cached: true,
        full_response_path: cacheResult.full_response_path || undefined,
        error: null
      };
    }

    if (cacheResult.stale) {
      // Log that cache is stale, will re-query
    }
  }

  // Cache miss or disabled - call gemini
  const geminiPath = await findGemini();
  if (!geminiPath) {
    return {
      success: false,
      response: null,
      model: null,
      error: "gemini-cli not found. Install with: npm install -g @google/gemini-cli"
    };
  }

  // Read stdin if available
  const stdinContent = await readStdin();
  let prompt = args.prompt;
  if (stdinContent) {
    prompt = `Context:\n${stdinContent}\n\nTask: ${prompt}`;
  }

  // Build command args
  const cmdArgs: string[] = [geminiPath];
  const modelToUse = args.model || config.default_model;

  if (modelToUse) {
    cmdArgs.push("-m", modelToUse);
  }

  if (args.includeDirs) {
    for (const dir of args.includeDirs.split(",")) {
      cmdArgs.push("--include-directories", dir.trim());
    }
  }

  if (args.yolo) {
    cmdArgs.push("--yolo");
  }

  cmdArgs.push("-o", "json");
  cmdArgs.push(prompt);

  try {
    const proc = Bun.spawn(cmdArgs, {
      stdout: "pipe",
      stderr: "pipe"
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    // Try to parse JSON response
    if (stdout.trim()) {
      try {
        const data = JSON.parse(stdout);

        if (data.error) {
          return {
            success: false,
            response: null,
            model: null,
            error: data.error.message || JSON.stringify(data.error)
          };
        }

        const fullResponse = data.response || data.text || data.content;
        const responseModel = data.model || modelToUse || null;

        if (!fullResponse) {
          return {
            success: false,
            response: null,
            model: responseModel,
            error: "Empty response from gemini"
          };
        }

        // Generate summary
        const summary = generateSimpleSummary(fullResponse, config.summary_max_tokens * 4);
        const tokenCount = estimateTokens(fullResponse);
        const sourcePath = getSourcePath(args.includeDirs);

        // Store to cache
        const { cacheDir, metadata } = await writeCache({
          projectHash,
          sourceHash,
          prompt: args.prompt,
          model: responseModel || "unknown",
          fullResponse,
          summary,
          sourceFiles,
          sourceType,
          sourcePath,
          tokenCount
        });

        // Index in mem0 (async, don't wait)
        indexOffload(summary, metadata.offload_metadata).catch(() => {
          // Ignore indexing errors
        });

        const result: QueryResult = {
          success: true,
          response: summary,
          model: responseModel,
          cached: false,
          full_response_path: `${cacheDir}/full_response.md`,
          error: null
        };

        // Save to file if requested (save full response, not summary)
        if (args.output && fullResponse) {
          await Bun.write(args.output, fullResponse);
          result.saved_to = args.output;
        }

        return result;
      } catch {
        // Not JSON, treat as plain text
        if (exitCode === 0) {
          const fullResponse = stdout.trim();
          const summary = generateSimpleSummary(fullResponse, config.summary_max_tokens * 4);
          const tokenCount = estimateTokens(fullResponse);
          const sourcePath = getSourcePath(args.includeDirs);

          // Store to cache
          const { cacheDir, metadata } = await writeCache({
            projectHash,
            sourceHash,
            prompt: args.prompt,
            model: args.model || "unknown",
            fullResponse,
            summary,
            sourceFiles,
            sourceType,
            sourcePath,
            tokenCount
          });

          // Index in mem0
          indexOffload(summary, metadata.offload_metadata).catch(() => {});

          const result: QueryResult = {
            success: true,
            response: summary,
            model: null,
            cached: false,
            full_response_path: `${cacheDir}/full_response.md`,
            error: null
          };

          if (args.output) {
            await Bun.write(args.output, fullResponse);
            result.saved_to = args.output;
          }

          return result;
        }
      }
    }

    return {
      success: false,
      response: null,
      model: null,
      error: stderr.trim() || `Command failed with exit code ${exitCode}`
    };
  } catch (e) {
    return {
      success: false,
      response: null,
      model: null,
      error: String(e)
    };
  }
}

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      prompt: { type: "string", short: "p" },
      model: { type: "string", short: "m" },
      "include-dirs": { type: "string", short: "d" },
      yolo: { type: "boolean" },
      output: { type: "string", short: "o" },
      timeout: { type: "string", short: "t" },
      "no-cache": { type: "boolean" }
    },
    allowPositionals: true
  });

  if (!values.prompt) {
    console.log(JSON.stringify({
      success: false,
      response: null,
      model: null,
      error: "Missing required --prompt argument"
    }, null, 2));
    process.exit(1);
  }

  const result = await runQuery({
    prompt: values.prompt,
    model: values.model,
    includeDirs: values["include-dirs"],
    yolo: values.yolo,
    output: values.output,
    timeout: values.timeout ? parseInt(values.timeout) : 300,
    noCache: values["no-cache"]
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main();
