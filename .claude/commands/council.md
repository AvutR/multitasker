---
description: Multi-lens spec/plan review — runs product, CISO, engineering leader, architect, and PR-reviewer critiques in parallel, then fuses the findings into a verdict + dissents + DoD + scenarios.
---

# /council — Multi-Lens Spec Review

Convene a council of expert reviewers on a spec or plan **before any code is written**. Each lens critiques in parallel. You get a consolidated verdict, surfaced dissents, a sharpened Definition of Done, and the scenarios your tests should cover.

Use `/council` when you have a spec/plan and you're about to `/build` — this is the gate.

---

## Input

The user invokes `/council` with one of:

- An inline spec/plan in the prompt
- A path to a markdown/text file (e.g. `PLAN.md`, `design-doc.md`)
- A Linear ticket URL or ID
- A GitHub issue/PR URL

If nothing is provided, ask: *"Paste the spec, or point me to a file/Linear ticket/GitHub issue."*

---

## Step 0: Normalize the spec

1. Read the spec from whichever source was provided.
2. If it's a Linear ticket, fetch the issue body + comments.
3. If it's a GitHub issue/PR, fetch the body + key comments.
4. Produce a `SPEC_SUMMARY` — a clean bullet-point restatement of:
   - **Problem** — what user pain is this removing
   - **Proposed solution** — one paragraph max
   - **Scope** — what's in, what's explicitly out
   - **DoD** — how we'd know it's done (if present)
   - **Open questions** — anything ambiguous

Hold on this if the spec is thin — it's an early smell. Flag it, but continue.

---

## Step 1: Run the council in parallel

Launch the following agents **simultaneously** via the Agent tool (one message with multiple tool calls). Each gets the full `SPEC_SUMMARY` plus the raw spec text.

### Lens 1 — Product Vision (CEO/founder mode)

Inline prompt (no dedicated agent — the /council itself runs this lens):

```
You are the product-vision lens on this spec. Think like a founder (Steve Jobs,
Brian Chesky, Tobi Lütke). Pressure-test the spec:

1. Is this the 10x version of the problem, or an incremental patch?
2. What would a world-class product builder do that this spec doesn't?
3. What assumption underneath this is fragile?
4. If we had 2x the time, what would we add? If we had half, what would we cut?
5. What's the unasked user question this spec is dodging?

Output:
- Verdict: BUILD / RETHINK / EXPAND / KILL
- Top 3 forcing questions the author must answer before coding
- One concrete scope expansion worth considering
- One concrete scope reduction worth considering
```

### Lens 2 — CISO / enterprise buyer

Launch `ciso-evaluator` agent with:

```
Evaluate this SPEC as a Fortune 500 CISO reviewing whether Unbound's next feature
clears procurement. Spec:

{SPEC_SUMMARY + raw spec}

Use your standard framework. Focus on:
- Compliance implications (SOC 2, ISO 27001, FedRAMP, NIST)
- Audit trail / incident response gaps
- Board-reportable impact
- Integration with existing security stack
- Dealbreakers for enterprise buyers
```

### Lens 3 — VP/SVP Engineering (daily user)

Launch `eng-leader-evaluator` agent with:

```
Evaluate this SPEC as a VP/SVP of Engineering whose team will live with the
feature daily. Spec:

{SPEC_SUMMARY + raw spec}

Use your standard framework. Focus on:
- DX friction this introduces or removes
- Adoption path and rollout strategy
- Revolt risk — what would make devs route around this
- Integration with real dev workflows (Claude Code, Cursor, Copilot, CI)
```

### Lens 4 — Principal Architect

Launch `principal-architect` agent with:

```
## Task: Evaluate this SPEC for technical feasibility and architectural fit

Spec:
{SPEC_SUMMARY + raw spec}

Do NOT write a plan. Instead, review the proposal and output:

1. Feasibility verdict: FEASIBLE / FEASIBLE-WITH-CAVEATS / RETHINK / INFEASIBLE
2. Top architectural risks (data model, concurrency, migrations, integration boundaries)
3. Edge cases the spec ignores
4. Dependencies the spec assumes but hasn't validated
5. Realistic effort estimate (S/M/L/XL) + why
6. Two alternative approaches worth considering, with trade-offs
```

### Lens 5 — Elite PR Reviewer (dry-run on the plan)

Launch `elite-pr-reviewer` agent with:

```
## Task: Pre-mortem review — imagine the PR that will result from this spec

You are reviewing the hypothetical PR that will come from this spec, before a
line of code is written. Spec:

{SPEC_SUMMARY + raw spec}

Based on the spec alone, predict:
- The CRITICAL issues you'd raise at PR-review time (security, correctness, data integrity)
- The WARNING issues (performance, test gaps, style/consistency)
- Missing test scenarios — list concrete integration tests that must exist
- Code paths most likely to be buggy given the spec's ambiguities

Output structured findings with severity and the prevention action the author can take NOW.
```

---

## Step 2: Synthesize the council

After all five lenses return, produce a consolidated report with these sections, in this order:

### Verdict

One of: **BUILD** / **BUILD-WITH-CHANGES** / **RETHINK** / **KILL**

One-paragraph justification citing the lenses that drove the call.

### Consensus items (auto-escalated priority)

Issues flagged by **two or more** lenses. These are the highest-signal findings. List each with which lenses flagged it and what to do.

### Dissents

Where the lenses disagree (e.g., Product wants to expand scope, Architect wants to cut, CISO says neither matters if compliance blocker X isn't solved). Surface the disagreement honestly — don't paper over it. Suggest a resolution that serves the strongest argument.

### Sharpened Definition of Done

Based on the council's findings, produce a crisp DoD the team can test against. Each bullet should be verifiable — if you can't write an integration test for it, it doesn't belong.

### Scenarios to run before shipping

Concrete scenarios (not just unit tests) that must pass. Include non-deterministic scenarios where relevant — "a Canadian merchant with X behavior" vs "a Chinese merchant with Y behavior" — to force real-user variance.

### Open questions for the author

Top 3–5 questions that must be answered before `/build` is invoked.

### Full per-lens output

Below the synthesis, include each lens's raw output verbatim (collapsed/labeled by lens). This is the receipts section.

---

## Step 3: Gate decision

End with a clear next action:

- **BUILD** → "Ready for `/build`. Paste the Sharpened DoD into the build input."
- **BUILD-WITH-CHANGES** → "Address the Consensus items and the Open Questions, then re-run `/council` or proceed with the changes baked into the DoD."
- **RETHINK** → "Do not `/build` yet. Rework the spec addressing: {top 3 issues}. Consider running `/council` again on the revised spec."
- **KILL** → "The council recommends not building this. Summary: {why}."

---

## Output format

```
## /council — {spec title}

**Verdict:** {BUILD / BUILD-WITH-CHANGES / RETHINK / KILL}
**Confidence:** {Low / Medium / High}

### Consensus items
- [Lens 1 + Lens 4] {issue} → {action}
- ...

### Dissents
- {Lens A} says X. {Lens B} says Y. Resolution: {resolution}
- ...

### Sharpened DoD
- [ ] {verifiable item}
- ...

### Scenarios to run
- {scenario}
- ...

### Open questions
1. {question}
...

### Next action
{BUILD / RETHINK / ... with specific guidance}

---

### Receipts (per-lens output)

<details><summary>Product vision</summary>
{raw output}
</details>

<details><summary>CISO (ciso-evaluator)</summary>
{raw output}
</details>

<details><summary>Engineering leader (eng-leader-evaluator)</summary>
{raw output}
</details>

<details><summary>Architecture (principal-architect)</summary>
{raw output}
</details>

<details><summary>PR reviewer dry-run (elite-pr-reviewer)</summary>
{raw output}
</details>
```

---

## Rules

- **All five lenses run in parallel.** Never sequence them. One message, five Agent tool calls.
- **Do not soften dissents.** If the council disagrees, surface the disagreement — that's the highest-signal output.
- **Consensus auto-escalates.** If two or more lenses raise the same concern, treat it as a blocker, not a nice-to-have.
- **No coding.** `/council` reviews specs. It never writes code. If the user wants code, they should run `/build` after addressing council feedback.
- **Keep the SPEC_SUMMARY honest.** If the spec is thin, say so in the verdict. Don't synthesize a richer spec than the author actually wrote.
