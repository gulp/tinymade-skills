# Mode 1: Single Worktree Creation

## Overview

This mode creates a single git worktree for parallel development. Use this when the user wants to work on one additional branch alongside their current work.

## When to Use

- User mentions creating "a worktree" (singular)
- User specifies one branch name
- User says "I need to work on [branch]"
- Default mode when unclear

## Workflow

### Phase 0: Prerequisites & Validation

#### Step 0.1: Verify Git Repository

```bash
git rev-parse --is-inside-work-tree
```

**Expected Output:**
```
true
```

**If fails:**
- Stop immediately
- Error: "Not in a git repository. Please navigate to your project root and try again."

#### Step 0.2: Get Repository Information

```bash
# Get repository name
basename $(git rev-parse --show-toplevel)

# Get current branch
git branch --show-current
```

**Store:**
- `REPO_NAME`: Repository name
- `CURRENT_BRANCH`: Current branch

#### Step 0.3: Check Working Directory Status

```bash
git status --porcelain
```

**If output exists:**
- **Warning:** "You have uncommitted changes in your current worktree:"
- Show: `git status --short`
- Ask: "Continue creating worktree anyway? This won't affect your changes."
- If user declines → Stop

**If clean:**
- Proceed silently

#### Step 0.4: Check Existing Worktrees

```bash
git worktree list
```

**Purpose:**
- Show user current worktree state
- Detect conflicts before creation
- Store for later reference

---

### Phase 1: Gather Information

#### Step 1.1: Extract Branch Name

**From user request:**
- "create worktree for **feature-auth**"
- "set up worktree for **bugfix-123**"
- "I need a worktree for **experiment-new-ui**"

**Extract:**
- `BRANCH_NAME`: The branch to work on

**If unclear:**
- Ask: "What branch name should I use for the worktree?"

#### Step 1.2: Determine Base Branch

**For new branches only** - ask which branch to base the new worktree on:

**Prompt:**
```
Base branch for feature-auth? (default: feature/test-worktree-trigger)
Press Enter for current branch, or type branch name:
```

**Default**: Current branch (`$CURRENT_BRANCH` from Step 0.2)
**Alternatives**: main, master, develop, or any branch name

**Store:**
- `BASE_BRANCH`: The branch to create new worktree from

**If user presses Enter or leaves blank:**
- `BASE_BRANCH=$CURRENT_BRANCH`

**If user specifies branch:**
- Validate it exists: `git show-ref --verify refs/heads/$BASE_BRANCH 2>/dev/null`
- If doesn't exist: "Branch '$BASE_BRANCH' not found. Use current branch instead? (yes/no)"

#### Step 1.3: Determine Branch Type

**Check if target branch already exists:**
```bash
git show-ref --verify refs/heads/$BRANCH_NAME 2>/dev/null
```

**If exits (exit code 0):**
- `BRANCH_TYPE`: "existing"
- Message: "Found existing branch: $BRANCH_NAME"
- **Note**: Will checkout existing branch (BASE_BRANCH not used)

**If doesn't exist:**
- `BRANCH_TYPE`: "new"
- Message: "Will create new branch: $BRANCH_NAME from $BASE_BRANCH"

**Also check remote:**
```bash
git show-ref --verify refs/remotes/origin/$BRANCH_NAME 2>/dev/null
```

**If exists on remote but not local:**
- Offer: "Branch exists on remote. Track remote branch or create new local from $BASE_BRANCH?"
- Default: Track remote

#### Step 1.3: Determine Worktree Location

**Normalize branch name:**
```bash
FOLDER_NAME="${BRANCH_NAME//\//-}"  # Replace / with -
FOLDER_NAME="${FOLDER_NAME//_/-}"   # Replace _ with -
```

**Default location:**
```
.trees/$FOLDER_NAME
```

**Examples:**
- Branch: `feature-auth` → `.trees/feature-auth`
- Branch: `feature/ui-login` → `.trees/feature-ui-login`
- Branch: `bugfix/auth_error` → `.trees/bugfix-auth-error`

**Ask user:**
"I'll create the worktree at: `$DEFAULT_LOCATION`"
"Use this location? (yes/no/specify custom)"

**Options:**
- Yes → Use default
- No → Ask for custom path
- Custom → Use provided path

**Store:**
- `WORKTREE_PATH`: Final worktree location

#### Step 1.4: Check Directory Availability

```bash
if [ -d "$WORKTREE_PATH" ]; then
  echo "exists"
else
  echo "available"
fi
```

**If exists:**
- **Error:** "Directory already exists: $WORKTREE_PATH"
- Ask: "Remove it and continue? (yes/no)"
- If yes → `rm -rf $WORKTREE_PATH` (with confirmation)
- If no → Ask for different location

#### Step 1.5: Development Environment Setup

**Check for package.json:**
```bash
if [ -f "package.json" ]; then
  echo "found"
fi
```

**If found:**
- Default: "Setup development environment? (yes/no)" → yes
- Ask: "Install dependencies in new worktree?"

**Store:**
- `SETUP_DEV`: true/false

**If no package.json:**
- Skip dev setup questions
- `SETUP_DEV`: false

---

### Phase 2: Create Worktree

#### Step 2.0: Prepare .trees Directory

**Ensure .trees directory exists:**
```bash
mkdir -p .trees
```

**Add to .gitignore if not present:**
```bash
if ! grep -q "^\.trees/$" .gitignore 2>/dev/null; then
  echo ".trees/" >> .gitignore
  echo "✓ Added .trees/ to .gitignore"
fi
```

#### Step 2.1: Execute Worktree Creation

**For new branch:**
```bash
git worktree add $WORKTREE_PATH -b $BRANCH_NAME $BASE_BRANCH
```

**For existing branch:**
```bash
git worktree add $WORKTREE_PATH $BRANCH_NAME
```
*Note: BASE_BRANCH not used when checking out existing branch*

**For tracking remote branch:**
```bash
git worktree add $WORKTREE_PATH -b $BRANCH_NAME --track origin/$BRANCH_NAME
```
*Note: BASE_BRANCH not used when tracking remote*

**Expected Output:**
```
Preparing worktree (new branch 'feature-auth')
HEAD is now at abc123 Initial commit
```

**Monitor for errors:**
- "fatal: invalid reference" → Branch doesn't exist
- "fatal: 'path' already exists" → Directory conflict
- "fatal: 'branch' is already checked out" → Branch in another worktree

**If error:**
- Stop and report error
- Provide fix suggestion
- Don't continue to next phase

#### Step 2.2: Verify Worktree Creation

```bash
git worktree list
```

**Check output includes:**
```
/path/to/worktree  abc123 [branch-name]
```

**Verify directory:**
```bash
ls -la $WORKTREE_PATH
```

**Must see:**
- `.git` file (not directory - points to parent)
- Project files

**If verification fails:**
- **Error:** "Worktree creation failed verification"
- Show: `git worktree list`
- Offer: "Try again with different settings?"
- Stop

#### Step 2.3: Confirm Success

**Output:**
```
✓ Worktree created successfully
  Location: $WORKTREE_PATH
  Branch: $BRANCH_NAME ($BRANCH_TYPE)
  Status: Ready
```

---

### Phase 3: Setup Development Environment

**Only if `SETUP_DEV` is true**

#### Step 3.1: Navigate to Worktree

```bash
cd $WORKTREE_PATH
```

#### Step 3.2: Detect Package Manager

**Check for lockfiles in priority order:**

```bash
# Check pnpm
if [ -f "pnpm-lock.yaml" ]; then
  PKG_MANAGER="pnpm"
  INSTALL_CMD="pnpm install"
fi

# Check yarn
if [ -f "yarn.lock" ]; then
  PKG_MANAGER="yarn"
  INSTALL_CMD="yarn install"
fi

# Check bun
if [ -f "bun.lockb" ]; then
  PKG_MANAGER="bun"
  INSTALL_CMD="bun install"
fi

# Check npm
if [ -f "package-lock.json" ]; then
  PKG_MANAGER="npm"
  INSTALL_CMD="npm install"
fi

# Default to npm if no lockfile
if [ -z "$PKG_MANAGER" ]; then
  PKG_MANAGER="npm"
  INSTALL_CMD="npm install"
fi
```

**Output:**
```
Detected package manager: $PKG_MANAGER
```

#### Step 3.3: Run Installation

```bash
$INSTALL_CMD
```

**Show progress:**
```
Installing dependencies with $PKG_MANAGER...
```

**Expected output (varies by manager):**
- npm: "added X packages in Ys"
- pnpm: "Packages: +X"
- yarn: "Done in Xs"
- bun: "X packages installed"

**Monitor for errors:**
- Network failures
- Lockfile conflicts
- Disk space issues

**If error:**
- Show error message
- Suggest: "Installation failed. You can manually run `$INSTALL_CMD` in the worktree later."
- Mark: Dev environment setup failed
- Continue (don't stop entire process)

**If success:**
```
✓ Dependencies installed successfully
```

#### Step 3.4: Copy Environment Files (Optional)

**Check for .env in parent:**
```bash
if [ -f "../.env" ]; then
  echo "found"
fi
```

**If found:**
- Ask: "Copy .env file to worktree? (yes/no)"
- Default: Ask (don't assume - may contain secrets)

**If yes:**
```bash
cp ../.env .env
```

**Output:**
```
✓ Environment file copied
```

**Other common files to check:**
- `.env.local`
- `.env.development`
- `.env.test`

#### Step 3.5: Verify Development Setup

```bash
# Check node_modules exists
if [ -d "node_modules" ]; then
  echo "✓ Dependencies installed"
fi

# Try running a basic script (optional)
npm run build --dry-run 2>/dev/null && echo "✓ Build configuration valid"
```

**Final status:**
```
✓ Development environment ready
  Package manager: $PKG_MANAGER
  Dependencies: Installed
  Environment: Ready
```

---

### Phase 4: Provide User Guidance

#### Step 4.1: Generate Summary

**Create summary output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Worktree Created Successfully
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Location:   $WORKTREE_PATH (e.g., .trees/feature-auth)
Branch:     $BRANCH_NAME (new/existing)
Base:       $BASE_BRANCH
Dev Setup:  ✓ Complete / ⊘ Skipped
Gitignore:  ✓ .trees/ added

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Next Steps
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Navigate to worktree:
   cd $WORKTREE_PATH

2. Start Claude Code:
   claude

3. Begin development on $BRANCH_NAME

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Step 4.2: Show All Worktrees

```bash
git worktree list
```

**Format output:**
```
All Worktrees:
  /path/to/repo            (main)          ← current
  /path/to/repo/.trees/... ($BRANCH_NAME)  ← new
```

**Highlight:**
- Current worktree with `← current`
- New worktree with `← new`

#### Step 4.3: Provide Quick Reference Commands

```
Quick Reference:
  List worktrees:    git worktree list
  Remove worktree:   git worktree remove $WORKTREE_PATH
  Navigate:          cd $WORKTREE_PATH
  Return to main:    cd ..  (from within .trees/)
```

#### Step 4.4: Offer Additional Actions

**Ask user:**
"Would you like me to:
- [ ] Open the worktree in a new terminal (with Claude auto-start)
- [ ] Generate a setup script for future worktrees
- [ ] Show git commands for advanced management"

**If user wants terminal:**
```bash
# Spawn terminal with Claude auto-started
python scripts/spawn_terminal.py --worktree "$WORKTREE_PATH" --task "$TASK_NAME"

# Or just a shell
python scripts/spawn_terminal.py --worktree "$WORKTREE_PATH"
```

**Based on response, provide appropriate outputs**

---

### Phase 5: Post-Creation Verification

#### Step 5.1: Final Checks

```bash
# Verify worktree is in list
git worktree list | grep -q "$WORKTREE_PATH"

# Verify directory exists and has files
[ -d "$WORKTREE_PATH" ] && [ "$(ls -A $WORKTREE_PATH)" ]

# Verify .git file exists
[ -f "$WORKTREE_PATH/.git" ]
```

**All must pass**

#### Step 5.2: Success Confirmation

**Create success checklist:**
```
✓ Worktree created at correct location
✓ Branch checked out properly
✓ Files visible in worktree directory
✓ Development environment ready (if requested)
✓ Worktree appears in git worktree list
✓ Ready for Claude Code session
```

**If any fail:**
- Report which check failed
- Provide troubleshooting steps
- Offer to retry or cleanup

---

## Error Handling

### Error: Not a Git Repository

```
Error: Not in a git repository

Solution:
1. Navigate to your project root
2. Verify with: git status
3. Try again
```

### Error: Branch Already Checked Out

```
Error: Branch 'feature-x' is already checked out at '/path'

Solution:
1. List worktrees: git worktree list
2. Navigate to existing worktree, or
3. Remove existing worktree first:
   git worktree remove /path
```

### Error: Directory Already Exists

```
Error: Directory already exists: /path/to/worktree

Solutions:
1. Use different location
2. Remove directory: rm -rf /path/to/worktree
3. Specify custom path when creating
```

### Error: Installation Failed

```
Error: Dependency installation failed

Solutions:
1. Check network connection
2. Manually run in worktree:
   cd /path/to/worktree
   [package-manager] install
3. Check lockfile compatibility
```

---

## Stop Conditions

**Stop immediately if:**
- [ ] Not in a git repository
- [ ] Worktree creation command fails
- [ ] Directory already exists and user declines removal
- [ ] User cancels during any confirmation

**Continue with warnings if:**
- [ ] Uncommitted changes in current worktree
- [ ] Dependency installation fails
- [ ] Environment file copy fails

---

## Success Criteria

- [ ] Worktree created successfully
- [ ] Branch checked out
- [ ] Directory accessible
- [ ] Dev environment ready (if requested)
- [ ] User provided with clear next steps
- [ ] All verification checks passed

---

## Example: Complete Flow

```
User: Create a worktree for feature-authentication