---
description: Full development pipeline — plan, build, test, review, and raise PR. Combines principal-architect planning with principal-engineer execution, elite-pr-review validation, and automated PR landing.
---

# /build — Full Development Pipeline

Execute a complete development workflow from planning through PR review.

---

## Mode Detection

Check `git diff`, `git status`, and existing branches/PRs.

- **If code changes already exist** for the task (dirty working tree, or commits ahead of base branch): enter **Iteration Mode** (skip to Step 2).
- **Otherwise**: enter **Build Mode** (start at Step 0).

Both modes rejoin at **Step 3**.

---

## Build Mode (no existing code)

`/build` runs Build Mode inside a **fresh, isolated git worktree** so the pipeline never disturbs your current working tree or branch.

### Step 0.0: Create the worktree

Before planning, create the worktree with the **`EnterWorktree` tool**. It switches the session into a new worktree on a new branch, branched clean from `origin/<default-branch>`. This `/build` skill is itself the project instruction that authorizes worktree use — the step is mandatory in Build Mode.

- Derive a short kebab-case `name` from the task (e.g. `build/add-rate-limit`, `build/fix-csv-export`). If the task isn't specific enough to name well, omit `name` and accept the generated one.
- Once `EnterWorktree` succeeds, every subsequent step (plan, code, tests, review, PR) runs inside this worktree.
- **Do NOT call `ExitWorktree` as part of the pipeline.** Step 6 pushes the PR branch to origin, so the work is durably saved on the remote. Leave the worktree on disk — the harness prompts the user to keep or remove it at session end, and they may want to keep iterating locally.

**Preconditions / failure handling:**
- Must be inside a git repository. If not, `EnterWorktree` errors — surface it and stop; `/build` needs a repo.
- If `EnterWorktree` errors because the session is *already* inside a worktree, skip this step and continue the pipeline in the current worktree — do not abort.

### Step 0: Plan

Before launching the architect:

1. Review the full conversation history above.
2. Write a bullet-point summary of every decision, constraint, technical direction, and requirement the user has established so far (call this `CONTEXT_SUMMARY`).
3. Launch `principal-architect` agent with a prompt structured exactly like this:

```
## Established Context (DO NOT override these decisions)
{CONTEXT_SUMMARY}

## Task
{the user's task/requirements}

## Constraints
- Follow the architecture and conventions documented in CLAUDE.md
- Propose the minimal set of changes needed
- Identify files that need to change and why
- Call out any risks or trade-offs
- Output a clear, numbered implementation plan
```

4. Present the plan to the user. Wait for approval before proceeding.

### Step 1: Code

Launch `principal-engineer` agent with the approved plan:

```
## Implementation Plan (approved)
{the plan from Step 0}

## Rules
- Follow the plan exactly — do not add scope
- Write integration tests at the outermost layer (API endpoint level or task level), not unit tests for helpers
- Ensure every new code path has test coverage
- Do not add unnecessary abstractions, comments, or type annotations beyond what's needed
```

### Step 2: Simplify

Launch `code-simplifier` agent on the changes:

```
Review all files changed in this session. Focus on:
- Removing unnecessary complexity or abstraction
- Ensuring consistency with surrounding code style
- Eliminating dead code or unused imports introduced
- Keeping the implementation minimal — no speculative features

Do NOT add docstrings, comments, or type annotations to code you didn't change.
Do NOT refactor surrounding code that wasn't part of the task.
```

---

## Iteration Mode (code already exists)

If changes already exist (e.g., the user has been coding and wants to finish the pipeline):

1. Run Step 2 (Simplify) on the existing changes.
2. Continue to Step 3.

Iteration Mode runs **in the current working tree** — it does not create a worktree, because the in-progress changes already live there and a fresh worktree (branched from origin) cannot carry uncommitted work.

---

## Step 3: Test & Verify (principal-engineer)

Launch `principal-engineer` agent focused on testing:

```
## Task: Verify and test the code changes

1. Review all changes made in this session (git diff against the base branch)
2. Ensure integration tests exist for every new/changed code path:
   - API endpoints → test at HTTP request/response level
   - Async tasks → test at task invocation level
   - If a helper is used by an API/task, it gets tested through that layer
   - Tests should be at the OUTERMOST layer, not unit tests for internals
3. If tests are missing, WRITE THEM
4. Run the full test suite and ensure all tests pass
5. If any test fails, fix the issue and re-run until green

Do NOT proceed until all tests pass. Paste the test output as evidence.
```

**Hard gate:** Do not proceed to Step 4 until test output shows all green.

---

## Step 4: Parallel Review Fan-Out (first pass)

Three reviewers run concurrently on the code changes: `elite-pr-reviewer`, `/security-review`, and `/ux-laws-review` (when applicable). All enabled reviewer Task calls **MUST be issued in a single assistant turn** with multiple tool calls — never sequence them. This matches the parallel-fan-out pattern used by `/council`.

### Step 4.0 — Pre-flight checks

1. **Detect base branch** (canonical detection — Step 6 Option B references this block). Sets `$BASE_BRANCH`:

```bash
BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@') \
  || BASE_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null) \
  || BASE_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}') \
  || BASE_BRANCH="main"
```

2. **Capture the changed-file list:**

```bash
git diff --name-only "origin/$BASE_BRANCH"...HEAD
```

3. **Empty-diff guard:** If the changed-file list is empty, abort Step 4 with a clear message — there is nothing to review. Either the working tree was clean when `/build` was invoked, or BASE_BRANCH detection is wrong.

4. **Compute `UX_REVIEW_ENABLED`:**
   - Set `UX_REVIEW_ENABLED=false` **iff every** changed file matches one of:
     - Path starts with one of: `server/`, `api/`, `backend/`, `infra/`, `terraform/`, `migrations/`, `.github/`, `scripts/`, `docs/`
     - File extension is one of: `.sql`, `.tf`, `.yaml`, `.yml`, `.toml`, `.md`
   - Otherwise set `UX_REVIEW_ENABLED=true` — any frontend/UI file forces the audit on.
   - **When in doubt, set to `true`.** The conservative call is to let `/ux-laws-review` itself decide via its own auto-skip semantics.

5. **Verify reviewer availability:**
   - `elite-pr-reviewer` agent **must be available**. If missing, **hard error and stop** — this is the historical baseline reviewer and its absence indicates a broken environment.
   - `/security-review` skill **must be available**. If it is missing, **hard error and stop** — security review cannot be infra-flaky.
   - `/ux-laws-review` skill availability is checked only if `UX_REVIEW_ENABLED=true`. If missing or it errors during invocation, treat per the failure-mode rule in 4.1.c (WARN, do not block).

   Hard error means: surface the missing-skill name to the user, halt the pipeline at Step 4, and do not advance to Step 5 or Step 6. Resume only after the user confirms the skill is available.

6. **Unconditional reviewers:** `elite-pr-reviewer` and `/security-review` run on every PR regardless of diff shape.

### Step 4.1 — Fan out reviewers in parallel

#### 4.1.a — `elite-pr-reviewer`

Launch `elite-pr-reviewer` agent on the code changes:

```
Review all changes on this branch vs the base branch (git diff origin/<base>...HEAD).

Focus on:
- Correctness and edge cases
- Security vulnerabilities (OWASP top 10, injection, auth bypasses)
- Performance issues (N+1 queries, missing indexes, unbounded loops)
- Error handling at system boundaries
- Test coverage gaps
- Code style consistency with the existing codebase

Output a structured list of findings with severity (CRITICAL / WARNING / INFO).
For each finding: file:line, problem, and recommended fix.
```

**Output contract:** findings with severity `CRITICAL / WARNING / INFO`, each with file:line, problem, and recommended fix.

#### 4.1.b — `/security-review`

Invoke Anthropic's built-in `/security-review` skill, diff-scoped to `git diff origin/$BASE_BRANCH...HEAD`. Complementary to `elite-pr-reviewer`, not redundant.

**Invocation mechanism — MUST use the Agent tool, NOT the Skill tool directly.** The `/security-review` skill terminates with the system-level instruction "Your final reply must contain the markdown report and nothing else." When invoked via the `Skill` tool, that instruction loads into the orchestrator's own context and ends the orchestrator's turn — stopping the pipeline. When invoked via the `Agent` tool with a general-purpose sub-agent, the terminator binds only to the sub-agent's turn; the orchestrator receives the report as tool output and continues uninterrupted.

This is the **same pattern used for `elite-pr-reviewer` in 4.1.a** — sub-agent in isolation, report comes back as a tool result, orchestrator stays in control. Do not invoke `/security-review` directly via Skill from inside `/build`. (Direct Skill invocation is fine when the USER types `/security-review` — that's a stand-alone invocation, not a pipeline step.)

Concretely, the orchestrator's call looks like:

```
Agent(
  description="Security review of PR diff",
  subagent_type="general-purpose",
  prompt=<<<
    Invoke the /security-review skill via the Skill tool on the current branch's diff
    (git diff origin/<base>...HEAD). Return the resulting markdown report verbatim
    as your final reply — that's exactly what /security-review will demand of you.

    The orchestrator (the /build pipeline) will receive your report as the Agent tool's
    result and continue the pipeline; the "final reply must contain the markdown report
    and nothing else" instruction is meant to bind YOUR turn, not the orchestrator's.
  >>>
)
```

**Output contract:** findings with severity `CRITICAL / HIGH / MEDIUM / LOW`, each with file:line, threat description, and recommended remediation.

**Continuation contract:** the orchestrator MUST proceed to Step 4.2 (consolidate findings) and Step 5 (address findings) in the SAME assistant response after receiving the security-review Agent's result. Parse the verdict from the report (look for the explicit verdict line; default to "APPROVE" if no CRITICAL/HIGH findings are listed). Do NOT stop and wait for the user to nudge you. The user typing "what next?" or "why did you stop?" after the report is a symptom of this rule being violated — and if it happens, it indicates the Agent-tool routing in this section was bypassed.

#### 4.1.c — `/ux-laws-review` (conditional)

**Only invoke if `UX_REVIEW_ENABLED=true` from Step 4.0.** Pass the PR diff context and the preview URL when available. `/ux-laws-review`'s own auto-skip semantics remain in force as a defensive second layer.

```
Run a UX Laws audit on the changes in this PR.

Inputs:
- Diff: git diff origin/<base>...HEAD
- Preview URL (if available): <url>

Output a lens-aware scorecard, the detected surface classification, and a verdict (PASS / WARN / FAIL).
```

**Output contract:** lens-aware scorecard, surface classification, verdict `PASS / WARN / FAIL`.

**Error handling:** if `/ux-laws-review` errors or fails to produce a verdict, capture as a WARN with the stable greppable marker `[ux-laws-review:UNAVAILABLE]: <reason>`. **Do not block merge.**

### Step 4.2 — Consolidate findings

Produce three sibling sections feeding Step 5. Preserve each reviewer's native severity vocabulary — do not merge or remap severities. Severity vocabularies intentionally differ across reviewers — do not remap (`CRITICAL/WARNING/INFO` for elite-pr-reviewer, `CRITICAL/HIGH/MEDIUM/LOW` for `/security-review`, `PASS/WARN/FAIL` for `/ux-laws-review`). This is by design — each reviewer's gating rules are tuned to its own vocabulary.

**Output shape:**

```
### Elite PR Review findings
- CRITICAL / WARNING / INFO findings, each with file:line + recommended fix

### Security Review findings
- CRITICAL / HIGH / MEDIUM / LOW findings, each with file:line + remediation

### UX Laws Review findings
- (when UX_REVIEW_ENABLED=false) "skipped — backend-only diff"
- (on reviewer failure) "[ux-laws-review:UNAVAILABLE]: <reason>"
- (otherwise) lens scorecard + WARN/FAIL items with surface classification + verdict
```

Step 5 iterates over these three sibling sections.

---

## Step 5: Address Review Findings

Walk each of the three sibling sections from Step 4.2 in turn. Each reviewer has its own gating semantics.

### Elite PR Review findings

1. **CRITICAL**: Must be fixed. Launch `principal-engineer` agent to fix each one.
2. **WARNING**: Fix unless there's a clear reason not to. Use judgment.
3. **INFO**: Fix if trivial, skip if not.

### Security Review findings

1. **CRITICAL**: **Blocks merge — no override.** Launch `principal-engineer` agent to fix before proceeding.
2. **HIGH**: **Blocks merge** unless overridden by an authorized approver per the SOC 2 production-merge approver list. Do not hardcode approver identities here — defer to the policy list.
3. **MEDIUM**: Fix unless there's a clear reason not to.
4. **LOW**: Fix if trivial, skip if not.

### UX Laws Review findings

1. **FAIL on a critical-flow surface** (as defined by `/ux-laws-review`'s surface classification — see `commands/ux-laws-review.md`): **Blocks merge.** Launch `principal-engineer` agent to fix.
2. **WARN**: Post to the PR, **non-blocking**. Address if cheap, defer otherwise.
3. **PASS**: Silent.
4. **`[ux-laws-review:UNAVAILABLE]` marker**: Log a WARN and continue. Do not block.

### Blocker-council escalation

If reviewer and engineer reach an impasse on a finding's disposition: invoke `/eng-blocker-council` for security/correctness/test findings, or `/ux-blocker-council` for UX Laws FAIL disputes. (These council skills are forthcoming follow-up PRs.) Until those councils ship, escalate to the user with the disputed finding, the reviewer's position, and the engineer's counter-position; wait for adjudication.

### Architectural validation of fixes

After all fixes across the three sections are applied:

- Launch `principal-architect` agent to validate the consolidated fix set is architecturally sound:

```
## Task: Validate review fixes

Review the following fixes applied to address PR review findings across all three reviewers
(elite-pr-reviewer, /security-review, /ux-laws-review):

{list of findings and what was changed, grouped by reviewer}

Verify:
- Fixes don't introduce new issues or break the architecture
- The approach is correct, not just a band-aid
- No unnecessary scope creep from the fixes
```

- Re-run the test suite to ensure fixes didn't break anything.

**Hard gate:** Do not proceed until tests are green again.

---

## Step 6: Raise PR

### Option A: gstack /ship (if available)

Check if the `/ship` skill is available. If so, invoke it. It handles:
- Merging the base branch
- Running tests (again — verification gate)
- Pre-landing code review
- Version bump + CHANGELOG
- Bisectable commits
- Creating the PR with full summary

**Note:** gstack /ship may find additional issues in its own pre-landing review. Address those before the PR is created.

### Option B: Built-in PR workflow (fallback)

If `/ship` is not available, use this built-in workflow:

1. **Detect base branch:** If `$BASE_BRANCH` is not already set from Step 4.0 (e.g., entering Step 6 directly in iteration mode), detect it using the logic in Step 4.0 step 1.

2. **Merge base branch:**
```bash
git fetch origin "$BASE_BRANCH"
git merge "origin/$BASE_BRANCH" --no-edit
```

2. **Run tests again** to verify merge didn't break anything.

3. **Push the branch:**
```bash
git push -u origin HEAD
```

4. **Create the PR:**
```bash
# Generate PR body from commits
COMMITS=$(git log "origin/$BASE_BRANCH"..HEAD --pretty=format:"- %s" --reverse)

gh pr create \
  --title "<concise title describing the change>" \
  --body "$(cat <<EOF
## Summary
<1-3 bullet points summarizing what changed and why>

## Changes
$COMMITS

## Test plan
- [ ] All existing tests pass
- [ ] New integration tests added for changed code paths
- [ ] Manual verification of <specific behavior>

EOF
)"
```

5. **Capture the PR URL** from the output of `gh pr create` for use in subsequent steps.

---

## Step 7: Elite PR Review (second pass — on the PR)

After the PR is created, run a second elite-pr-reviewer pass:

```
Review the pull request at {PR_URL}.

This is a second-pass review after the PR has been created.
Focus on:
- The PR as a whole (summary accuracy, test plan completeness)
- Any issues that may have been introduced during the PR workflow (version bump, changelog, doc sync)
- Final sanity check on the full diff
```

Capture the review output.

---

## Step 8: Final Validation

**You poll CI yourself — never hand off to the user to "ping you when it's green."** The pipeline is responsible for driving itself to a terminal state (ready-to-merge, blocked, or hard-failed).

### Step 8.0 — Poll CI to a terminal state

Loop until every required check has reached a non-pending state (`pass`, `fail`, `skipping`, `cancelled`), or until the wall-clock cap below is reached.

**Polling cadence (cache-aware):**
- Wait **60–270 seconds** between checks (stays inside the Anthropic prompt-cache TTL of 5 minutes — keeps the conversation context cheap to resume).
- Default to **90 seconds** per poll for typical CI suites (lint/test/security in 3–10 min).
- Maximum **15 minutes** total wall clock before escalating to the user.

**Polling mechanism:**
- In `/loop` dynamic mode → use `ScheduleWakeup` with `delaySeconds=90` and the loop's own re-entry sentinel.
- Otherwise (normal interactive mode, which is the common /build path) → use a foreground Bash poll loop with `Monitor`'s until-pattern or a single `Bash` call wrapping a short until-loop. Example:

```bash
PR=1234; OWNER_REPO=owner/repo; DEADLINE=$(($(date +%s) + 900))
until [ "$(gh pr checks $PR --repo $OWNER_REPO 2>/dev/null | awk '$2=="pending"{c++} END{print c+0}')" = "0" ] || [ "$(date +%s)" -ge "$DEADLINE" ]; do
  sleep 60
done
gh pr checks $PR --repo $OWNER_REPO
```

Do NOT chain short `sleep` commands and re-enter the pipeline by asking the user. Do NOT post a status update saying "ping me when CI is green" — that violates the self-driving contract.

**Outcomes:**
- **All checks green** → proceed to Step 8.1.
- **Any check failed** → fetch the failing job's logs (`gh run view <run-id> --log-failed`), launch `principal-engineer` to diagnose+fix, commit, push, return to Step 8.0.
- **Deadline reached with stragglers still pending** → THIS is the only case where you stop and surface to the user. Output the still-pending checks + their URLs and explicitly ask whether to keep waiting or merge anyway.

### Step 8.1 — Fetch bot reviews and PR comments

After all checks are terminal:

```bash
gh pr checks {PR_NUMBER} --repo {OWNER}/{REPO}
gh api repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/comments 2>/dev/null | head -100
gh api repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/reviews 2>/dev/null | head -100
```

### Step 8.2 — Validate bot reviews and elite second-pass

Launch `principal-engineer` agent to validate all review comments (both elite-pr-reviewer and bot reviews):

```
## Task: Final review validation

Review these comments on PR #{PR_NUMBER}:

### Elite PR Review (second pass):
{review output from Step 7}

### Bot/CI Reviews:
{bot comments from PR}

For each comment:
- If it's a valid issue: fix it, commit, and push
- If it's a false positive: explain why (leave as a reply on the PR)
- If it's informational: acknowledge

After addressing all comments, re-run tests to verify.
```

3. Launch `principal-architect` agent to do a final architectural sign-off:

```
## Task: Final sign-off

Review the PR at {PR_URL} in its final state.
- All review comments have been addressed
- All CI checks should be passing
- The implementation matches the original plan from Step 0

Confirm the PR is ready to merge, or flag any remaining concerns.
```

---

## Output

At the end, output:

```
## /build complete

**PR:** {PR_URL}
**Status:** Ready for merge / Needs attention
**Pipeline:**
  - [x] Step 0: Plan (principal-architect)
  - [x] Step 1: Code (principal-engineer)
  - [x] Step 2: Simplify (code-simplifier)
  - [x] Step 3: Test & verify (principal-engineer)
  - [x] Step 4: Parallel review fan-out (first pass)
  - [x] Step 5: Fix findings + validate (principal-engineer + principal-architect)
  - [x] Step 6: Raise PR
  - [x] Step 7: Elite PR review (second pass)
  - [x] Step 8: Final validation (bot reviews + sign-off)
```

---

## Important Rules

- **Drive the pipeline yourself — never hand off to the user mid-flight.** The orchestrator is responsible for moving from one step to the next without the user prompting "what next?" The two known places this rule gets violated are (a) after a sub-agent or skill ends its turn with a "your final reply must contain X and nothing else" instruction (e.g. `/security-review`) — that instruction terminates the sub-agent's turn only, NOT the `/build` pipeline; and (b) at Step 8 waiting for CI — poll yourself per Step 8.0, do NOT post "ping me when CI is green." The only legitimate user hand-offs are (i) Step 0 plan approval, (ii) blocked findings requiring policy override, and (iii) Step 8.0 deadline reached with checks still pending.
- **Build Mode runs in an isolated worktree.** Step 0.0 creates a fresh git worktree via `EnterWorktree` before any planning or code changes; the whole pipeline then runs inside it. Iteration Mode is exempt — it runs in place because its changes already exist in the working tree. Never call `ExitWorktree` from the pipeline; leave the worktree for the harness to clean up at session end.
- **Never skip tests.** Every step that changes code must re-run tests.
- **Never skip reviews.** Step 4's parallel review fan-out (`elite-pr-reviewer` + `/security-review` + `/ux-laws-review` when applicable) and the Step 7 second-pass review are mandatory.
- **Security-review CRITICAL is never overridable.** Security-review HIGH is overridable only by an authorized approver per the SOC 2 production-merge list.
- **Reviewer infrastructure failures** (e.g., `/ux-laws-review` unavailable) log a WARN; they never block merge.
- **Tests must be at the outermost layer** — API/job level, not helper unit tests.
- **Wait for user approval** on the plan (Step 0) before coding.
- **Step 8 polls CI itself** (Step 8.0) up to a 15-minute wall-clock cap. The 5-minute figure used in earlier versions of this skill was a passive "sleep" that violated the self-driving rule; do not reintroduce it.
- **If any step fails**, stop and report. Don't try to push through.
