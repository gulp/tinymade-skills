#!/usr/bin/env bun
/**
 * Check gemini-cli installation and authentication status.
 * Outputs JSON with installation path, version, auth method, and session list.
 *
 * Usage:
 *   bun run scripts/status.ts
 *
 * Output JSON:
 *   {
 *     "installed": true,
 *     "path": "/usr/local/bin/gemini",
 *     "version": "0.20.2",
 *     "authenticated": true,
 *     "auth_method": "google_login",
 *     "sessions": [],
 *     "error": null
 *   }
 */

import { $ } from "bun";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface StatusResult {
  installed: boolean;
  path: string | null;
  version: string | null;
  authenticated: boolean;
  auth_method: string | null;
  sessions: Array<{ index: number; description: string }>;
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

async function getVersion(geminiPath: string): Promise<string | null> {
  try {
    const result = await $`${geminiPath} --version`.text();
    return result.trim();
  } catch {
    return null;
  }
}

async function checkAuthentication(): Promise<{ authenticated: boolean; method: string | null }> {
  // Check environment variables
  if (process.env.GEMINI_API_KEY) {
    return { authenticated: true, method: "api_key" };
  }
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_GENAI_USE_VERTEXAI) {
    return { authenticated: true, method: "vertex_ai" };
  }

  // Check for OAuth credentials file
  const oauthCredsPath = join(homedir(), ".gemini", "oauth_creds.json");
  if (existsSync(oauthCredsPath)) {
    return { authenticated: true, method: "google_login" };
  }

  // Check settings file for OAuth
  const settingsPath = join(homedir(), ".gemini", "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = await Bun.file(settingsPath).json();
      if (
        settings.auth ||
        settings.oauth ||
        settings.selectedAuthMethod ||
        settings.security?.auth?.selectedType
      ) {
        return { authenticated: true, method: "google_login" };
      }
    } catch {
      // Ignore parse errors
    }
  }

  return { authenticated: false, method: null };
}

async function listSessions(geminiPath: string): Promise<Array<{ index: number; description: string }>> {
  try {
    const result = await $`${geminiPath} --list-sessions`.text();

    if (result.includes("No previous sessions")) {
      return [];
    }

    const sessions: Array<{ index: number; description: string }> = [];
    for (const line of result.split("\n")) {
      const match = line.match(/(\d+)[:\.\s]+(.+)/);
      if (match) {
        sessions.push({
          index: parseInt(match[1]),
          description: match[2].trim()
        });
      }
    }
    return sessions;
  } catch {
    return [];
  }
}

async function main() {
  const result: StatusResult = {
    installed: false,
    path: null,
    version: null,
    authenticated: false,
    auth_method: null,
    sessions: [],
    error: null
  };

  // Check installation
  const geminiPath = await findGemini();
  if (!geminiPath) {
    result.error = "gemini-cli not found. Install with: npm install -g @google/gemini-cli";
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  result.installed = true;
  result.path = geminiPath;

  // Get version
  result.version = await getVersion(geminiPath);

  // Check authentication
  const auth = await checkAuthentication();
  result.authenticated = auth.authenticated;
  result.auth_method = auth.method;

  if (!auth.authenticated) {
    result.error = "Authentication required. Run 'gemini' interactively to login, or set GEMINI_API_KEY";
  }

  // List sessions
  result.sessions = await listSessions(geminiPath);

  console.log(JSON.stringify(result, null, 2));
  process.exit(auth.authenticated ? 0 : 1);
}

main();
