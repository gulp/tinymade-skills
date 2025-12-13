# Gemini CLI tool calls

**there is no single, officially frozen “available_tools” list** for Gemini CLI the way there is for (say) OpenAI’s function calling. The tool surface is **client-defined**, not model-defined.

That said, in practice, **Gemini CLI implementations converge on a fairly standard tool set**, and Google’s own examples strongly imply the following categories.

Below is the **de-facto comprehensive map**, with clear boundaries between **what’s guaranteed**, **what’s common**, and **what’s client-specific**.

---

## 0. Mental model (important)

* **Gemini models do not “own” tools**
* **The CLI (or wrapper) exposes tools**
* The model only sees:

  ```json
  {
    "tools": [...],
    "tool_config": {...}
  }
  ```

So two Gemini CLIs may expose *different* tools, even with the same model.

---

## 1. Core / Guaranteed tool patterns

These appear in **almost all Gemini CLI or SDK-backed CLIs**.

### 📁 File system tools

Used for repo reasoning, docs, transcripts.

#### `list_files`

* List directory contents
* Usually supports recursion
* Often capped depth / file count

Typical args:

```json
{
  "path": ".",
  "recursive": false
}
```

#### `read_file`

* Read a single file
* Often size-limited (important for 124 errors)

```json
{
  "path": "src/index.ts"
}
```

#### `write_file`

* Create or overwrite a file

```json
{
  "path": "notes.md",
  "content": "..."
}
```

#### `append_file` (sometimes)

* Append instead of overwrite

---

### 🧠 Memory / scratchpad (optional but common)

Some CLIs expose:

#### `store_memory`

#### `load_memory`

Used for:

* intermediate summaries
* agent loops
* compression stages

This is **not a Gemini-native concept**, purely CLI-side.

---

## 2. Execution tools (CLI-dependent)

These are **common but not guaranteed**.

### 🖥️ `run_shell` / `exec`

Used heavily in dev-oriented CLIs.

Capabilities:

* Run shell commands
* Capture stdout/stderr
* Often sandboxed

```json
{
  "command": "ls -la"
}
```

⚠️ Often disabled or restricted in hosted / free setups.

---

### 🔎 `search` / `grep`

Sometimes split, sometimes unified.

* `search_files`
* `grep`
* `find`

Used to avoid reading entire files.

---

## 3. Web / network tools (rare in CLI)

Unlike ChatGPT:

* **Most Gemini CLIs do NOT expose browsing**
* Google assumes *you already have the data*

If present, you might see:

### `fetch_url`

```json
{
  "url": "https://example.com"
}
```

But this is **the exception**, not the norm.

---

## 4. Structured output helpers

Very common in agentic CLIs.

### `emit_json`

* Enforces schema
* Prevents markdown drift

### `emit_markdown`

* Used for reports

Sometimes hidden behind response config rather than explicit tools.

---

## 5. Multimodal tools (model-level, but CLI-gated)

Available **only if the CLI wires them up**.

### 🖼️ Image input

* `read_image`
* or implicit image attachment

### 🔊 Audio

* Rare in CLI
* More common in SDK demos

---

## 6. Tooling you might *expect* but Gemini usually lacks

This matters for your workflows.

❌ No native:

* background tasks
* async tool execution
* streaming tool calls with retries
* tool chaining guarantees
* tool memory across sessions

This is why Gemini collapses under:

> “ultrathink over big folder with tools”

---

## 7. Typical “full” Gemini CLI tool table

Here’s what a **maximal but realistic** setup looks like:

| Category | Tool                |
| -------- | ------------------- |
| FS       | list_files          |
| FS       | read_file           |
| FS       | write_file          |
| FS       | append_file         |
| FS       | delete_file         |
| Search   | grep / search_files |
| Exec     | run_shell           |
| Net      | fetch_url (rare)    |
| Memory   | store_memory        |
| Memory   | load_memory         |
| Output   | emit_json           |
| Output   | emit_markdown       |

If your CLI exposes **more than this**, it’s custom.

---

## 8. Why this matters for your Gemini errors (124 / 144)

Every tool call:

* pauses generation
* waits for IO
* restarts context

So:

* many `read_file` calls → timeout (124)
* retries → throttle (144)

This is why **Gemini wants fewer, fatter steps**, not agent loops.

---

## 9. Recommended pattern for *your* workflows

Given your cc-prism / transcript / repo scale:

**Best use of Gemini CLI**

* compression
* summarization
* extraction
* indexing

**Avoid**

* deep reasoning
* long tool chains
* iterative refinement

---

**Gemini CLI does have Web Search grounding**, and in the *official Gemini CLI docs* it’s exposed as the built-in tool **`google_web_search`**. ([Gemini CLI][1])

As of the current 2025 docs, **Gemini CLI’s built-in `available_tools` set** is basically:

## Built-in Gemini CLI tools (core set)

### Web grounding

* **`google_web_search(query: string)`**
  Performs a Google Search via the Gemini API and returns a **summary with sources/citations**. ([Gemini CLI][1])

* **`web_fetch(prompt: string)`**
  Fetches and processes one or more URLs (up to 20) embedded in the prompt; uses Gemini API **URL Context** when possible, with fallback fetching if needed. ([Gemini CLI][2])

### Local file system

Gemini CLI’s file tools are documented as these six (tool name → CLI “display name”): ([Gemini CLI][3])

* **`list_directory` → ReadFolder** (list files/dirs)
* **`read_file` → ReadFile** (reads text + supports line ranges; also reads images/audio/PDFs per docs)
* **`write_file` → WriteFile** (writes/overwrites files)
* **`glob` → FindFiles** (find by glob patterns)
* **`search_file_content` → SearchText** (search in files)
* **`replace` → Edit** (edit/replace in files)

### Shell execution

* **`run_shell_command(command: string, description?: string, directory?: string)`**
  Runs shell commands (optionally interactive if enabled in settings). ([Gemini CLI][4])

### Agent helpers

* **`save_memory(fact: string)`**
  Appends a fact to `~/.gemini/GEMINI.md` to persist across sessions. ([Gemini CLI][5])

* **`write_todos(todos: Array<{description, status}>)`**
  Manages the visible task list the agent uses for multi-step work. ([Gemini CLI][6])

## “Available tools” in *your* install (how to verify)

* In the CLI, run **`/tools`** to see the exact tool list that your current version/config exposes. ([Google Codelabs][7])

## Extending tools (MCP)

Beyond the built-ins above, Gemini CLI can load **MCP server tools** (custom tools from external servers). Those become additional available tools, and may be prefixed with a server alias to avoid name collisions. ([Gemini CLI][8])

If you paste your `/tools` output here, I can map it 1:1 to the docs (and point out anything coming from MCP vs core).

[1]: https://geminicli.com/docs/tools/web-search/ "Web search tool (`google_web_search`) | Gemini CLI"
[2]: https://geminicli.com/docs/tools/web-fetch/ "Web fetch tool (`web_fetch`) | Gemini CLI"
[3]: https://geminicli.com/docs/tools/file-system/ "Gemini CLI file system tools | Gemini CLI"
[4]: https://geminicli.com/docs/tools/shell/ "Shell tool (`run_shell_command`) | Gemini CLI"
[5]: https://geminicli.com/docs/tools/memory/ "Memory tool (`save_memory`) | Gemini CLI"
[6]: https://geminicli.com/docs/tools/todos/ "Todo tool (`write_todos`) | Gemini CLI"
[7]: https://codelabs.developers.google.com/gemini-cli-hands-on "Hands-on with Gemini CLI  |  Google Codelabs"
[8]: https://geminicli.com/docs/tools/mcp-server/?utm_source=chatgpt.com "MCP servers with the Gemini CLI"
