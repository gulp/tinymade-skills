
● My mistakes:
  1. Passed full file path instead of task name to --task flag
  2. Didn't follow the documented workflow of parsing task first, then extracting fields
   with jq
  3. Ran orchestrator on a feature branch instead of main/master
  4. Didn't verify sessions-state.json was created after spawning

  The core issue: The skill provides bundled scripts and documents a multi-step
  workflow, but I kept taking shortcuts and passing wrong parameters. The scripts are
  flexible (accept various inputs) but the correct workflow requires multiple steps.

  What would make this more deterministic?

  Option 1: A single unified command that handles everything
  Instead of:
  TASK_INFO=$(python parse_task.py task.md)
  BRANCH=$(echo "$TASK_INFO" | jq -r '.branch')
  FOLDER=$(echo "$TASK_INFO" | jq -r '.folder')
  TASK_NAME=$(echo "$TASK_INFO" | jq -r '.name')
  git worktree add ".trees/$FOLDER" "$BRANCH" 2>/dev/null || true
  python spawn_terminal.py --worktree ".trees/$FOLDER" --task "$TASK_NAME"
  --project-root "$(pwd)"

  Have:
  python spawn_task.py sessions/tasks/m-implement-feature.md

  This single command would:
  1. Parse the task file
  2. Create worktree if needed
  3. Configure sessions-state.json
  4. Spawn terminal with correct parameters

  Option 2: Make spawn_terminal.py accept the task FILE path and do the parsing
  internally

  Option 3: Add validation to spawn_terminal.py that rejects full paths for --task and
  suggests the correct usage

  Option 4: Create a wrapper script that's the "golden path" for the most common use
  case

  The most impactful recommendation would be a single unified command that accepts the
  task file path and handles everything. This eliminates:
  - The need to manually parse and extract fields
  - The chance of passing wrong parameter formats
  - The multi-step workflow that's easy to shortcut incorrectly

  Let me formulate this recommendation clearly.


  Recommendation: Add a spawn_task.py script that accepts the task file path directly.

  # Current workflow (error-prone, 5 steps)
  TASK_INFO=$(python scripts/parse_task.py sessions/tasks/m-implement-feature.md)
  BRANCH=$(echo "$TASK_INFO" | jq -r '.branch')
  FOLDER=$(echo "$TASK_INFO" | jq -r '.folder')
  TASK_NAME=$(echo "$TASK_INFO" | jq -r '.name')
  git worktree add ".trees/$FOLDER" "$BRANCH" 2>/dev/null || true
  python scripts/spawn_terminal.py --worktree ".trees/$FOLDER" --task "$TASK_NAME"
  --project-root "$(pwd)"

  # Proposed (deterministic, 1 step)
  python scripts/spawn_task.py sessions/tasks/m-implement-feature.md

  What spawn_task.py would do internally:
  1. Parse task frontmatter → extract name, branch, folder
  2. Create worktree at .trees/{folder} if needed
  3. Create/configure sessions-state.json in worktree
  4. Spawn terminal with correct --task {name} (not file path)
  5. Return structured output confirming what was created

  Why this prevents my mistakes:
  - I passed full file path to --task because that's what I had in hand
  - I skipped the jq extraction steps because they felt like boilerplate
  - A single entry point that accepts the file path eliminates the "wrong parameter
  format" failure mode entirely

  The current design optimizes for composability (separate scripts for each step). The
  failure pattern suggests optimizing for the common case (spawn agent for task file)
  with a single deterministic command.
