#!/usr/bin/env bun
/**
 * Execute a single gemini query with structured output.
 * Handles prompt formatting, output parsing, and error handling.
 *
 * Usage:
 *   bun run scripts/query.ts --prompt "Your question here"
 *   bun run scripts/query.ts --prompt "Question" --model gemini-2.5-flash
 *   bun run scripts/query.ts --prompt "Question" --output result.md
 *   bun run scripts/query.ts --prompt "Question" --include-dirs ./src,./docs
 *   echo "context" | bun run scripts/query.ts --prompt "Summarize this"
 *
 * Output JSON:
 *   {
 *     "success": true,
 *     "response": "The actual response text",
 *     "model": "gemini-2.5-pro",
 *     "error": null
 *   }
 */

import { $ } from "bun";
import { parseArgs } from "util";

interface QueryResult {
  success: boolean;
  response: string | null;
  model: string | null;
  saved_to?: string;
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
}): Promise<QueryResult> {
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

  if (args.model) {
    cmdArgs.push("-m", args.model);
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

        const response = data.response || data.text || data.content;
        const result: QueryResult = {
          success: true,
          response,
          model: data.model || null,
          error: null
        };

        // Save to file if requested
        if (args.output && response) {
          await Bun.write(args.output, response);
          result.saved_to = args.output;
        }

        return result;
      } catch {
        // Not JSON, treat as plain text
        if (exitCode === 0) {
          const result: QueryResult = {
            success: true,
            response: stdout.trim(),
            model: null,
            error: null
          };

          if (args.output) {
            await Bun.write(args.output, stdout.trim());
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
      timeout: { type: "string", short: "t" }
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
    timeout: values.timeout ? parseInt(values.timeout) : 300
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main();
