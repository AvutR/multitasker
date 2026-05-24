<!-- /autoplan target plan -->
# Multitasker v2 — reviewed plan (CEO · Design · Eng · DX)

> **Gate: APPROVED** (`/autoplan`, 4-lens review). All four taste/challenge calls accepted as recommended:
> (1) **Trust** promoted to co-equal P0 pillar; (2) connector breadth = **curated + discovery-as-suggestion** (default-deny preserved); (3) **board-first** home; (4) **dark-only v2.0** + semantic token layer (light → v2.1). Per-recipe model + defer multi-runtime auto-decided (unanimous).

Reviewed by four independent lenses (Codex unavailable → Claude-subagent mode). Scores and the full consensus are at the bottom. The headline: the four reviewers **agree** on the shape of v2, and they **challenge one premise of the original ask** — see "User Challenges."

## North Star (sharpened by review)

Original: "run many agents without losing your mind — know which one needs you, trust what they did."

The review's strongest signal (all four lenses, independently): the two clauses are **not** equal in the draft. The plan over-invested in *attention* (board, inbox, ⌘K, theming) and under-invested in *trust*. The 10x reframe:

> **The orchestrator you can walk away from.** Success isn't a well-triaged full inbox — it's an **almost-empty** one, because the agent ran under a policy you set once and only pulls you in for a real judgment call, *with the evidence to decide in 10 seconds.* Two co-equal pillars: **Attention** (which one needs me) and **Trust** (can I land its work without reading 20 diffs).

### Product principles (the taste bar)
1. Surface the one thing that needs attention; **shrink that set over time** (policy earns autonomy).
2. Calm by default, dense on demand. One accent. Real hierarchy.
3. It just works — but be honest when it can't (diagnose-and-link, never a fake "60s").
4. Keyboard-first. ⌘K does everything.
5. Trust through transparency: every outward action is policy-gated, audited, and **reversible**.
6. Reduce, then add.

---

## Pillar A — Attention (P0)

- **Mission Control board.** Cards grouped Needs-you · Running · Idle/Queued · Done. **Cards read the last *persisted* line (not live token deltas)** — only the focused session streams live (avoids a 10-agent render storm). Always-on in the title bar: a **dry-run / pending-approvals safety indicator** (never hidden) + a **Needs-you badge**.
- **"Needs you" inbox — with a specified ranking function.** Live-only in v2.0 (plan requests are in-memory; a reload shows "session stopped — resume to re-plan"). Ranking: **error-needs-decision > blocking-and-waiting (plan approval) > conflict > reversible outward approval**, tiebroken by wait-time, boosted by cost-burn. Each row: agent · what it wants · how long it's waited · one-click action. The **empty state ("All caught up — 6 agents running clean")** is a designed, first-class screen.
- **Throughput affordances (so the human isn't the serial bottleneck):** batch approval ("approve all 3 Linear status updates"), **per-recipe trust escalation** ("you've approved 5 standup posts — auto-approve this action type for this recipe?"), and snooze.
- **Native notifications, rules-first.** Only *blocking* events notify by default; completions batch ("3 agents finished"); suppressed when the window is focused on that agent; reuse the existing fire-once dedupe. Under-notify by default.
- **Command palette (⌘K)** with an object→verb grammar ("steer auth-fix: also handle the empty case"). Fast-follow if v2.0 is tight.

## Pillar B — Trust (P0, promoted from a single P1 bullet)

- **Per-agent trust card.** At 20x parallelism nobody reads 20 diffs. Each agent surfaces: tests ✓/✗, `/security-review` verdict, policy decisions clean, diffstat, regression signal. Trust-and-land *without* reading the diff when the gates are green.
- **Steering as a first-class interaction** (the core verb — today a 34px textarea). Specify: interrupt-vs-queue a live token stream (with a visible state for each), select-text-in-transcript → "steer about this," and a visible acknowledgement that a steer landed.
- **Legible, reversible Land.** The full diff being committed shows in the same modal as the Land button; the diff must have been opened once; **one-click "undo last land"** (it's a local commit — cheap). Proactive **file-overlap warning at spawn** when a second agent targets paths another agent is touching.

## Pillar C — Review & land (P1)

- **Cross-agent review queue** (not just one diff). The unit is "a reviewable" = agent + branch + diff + conflict state; three terminal actions: **Land · Request-changes-as-steer · Discard-worktree.** Hunk-anchored comments flow back to the agent as steers.
- **Branch/worktree lifecycle:** conflict status (new `git merge-tree` capability), Land (local) / Open PR (when remote), auto-prune merged worktrees.
- **Workflow recipes** (persisted): system prompt + **default model** + policy profile + target repo. (Per-recipe model = the cheap version of "model routing"; see Decision D.)

## Models & tools

- **Multi-provider, honestly.** Provider settings UI; the registry holds a **list** of gateway models (not one all-or-nothing entry), labeled "via gateway — best-effort tool-use." Anthropic native is first-class; GPT/Gemini via an Anthropic-compatible gateway is the pragmatic escape hatch (the SDK is Claude-native — say so). Cost shows **provenance** ("est. from SDK" vs "from gateway") or "—" when untrustworthy.
- **Connectors: curated + discovery-as-suggestion** (see User Challenge 2). Auto-discovery *surfaces* "you have connector X but no policy rows — review these suggested actions"; a human confirms each write before it's gateable. **Unknown writes default to APPROVE, never AUTO. The default-deny path-#2 guard and the pure/total policy truth-table stay intact.** Add a handful of curated connectors (Jira, Sentry, PagerDuty) with hand-authored read/write classification.
- **Auto-router transparency:** show the routed preset before spawn ("Routing to /build — change?").

## UI/UX (dark-only v2.0; see Decision B)

- **Semantic token layer now** (`--bg-surface`, `--text-primary`, `--accent`, `--state-needs-you`, …) replacing the 17 inline hex literals + 105 ink/accent usages. **Light + system theme deferred to v2.1** (the token layer makes it cheap then).
- **Fix the accent collision:** `#6ea8fe` is currently both "Running" status and every primary button. Give "Needs-you" the only warm/loud color; move Running to a calmer treatment.
- **Accessibility = acceptance criteria, not aspirations:** `prefers-reduced-motion` on every animation; visible `:focus-visible` rings (focus is the cursor in a keyboard-first app); contrast floor (AA 4.5:1 body); status never by color alone.
- **One signature motion:** board↔session shared-element zoom (≈200ms ease-out). Cut "shimmer," cut the density toggle (auto-tighten as card count grows).

## Phasing
- **v2.0:** Board + specified inbox + notifications + the **trust card** + legible/undoable Land + first-class steering, on **dark-only** with a token layer. (⌘K fast-follow if tight.)
- **v2.1:** cross-agent review queue + branch lifecycle + recipes + provider settings UI + gateway model list + **light/system theme.**
- **v2.2:** connector discovery-as-suggestion + curated connectors + projects/multi-repo + throughput metrics + policy-that-earns-autonomy (suggest AUTO-promotion from observed approvals).

## Not in scope (named bets, not permanent)
- **Multiple non-Claude agent runtimes** — deferred; do **not** build the session-backend abstraction now (it'd be Claude-shaped and wrong). Revisit post-v2.2 with a concrete second runtime.
- **macOS-only / single-operator / local** — a *speed* bet with an expiry date, not a principle. Named v3 cliff: **shared boards + policy-as-code across a team** (the audit log already exists; make it legible across humans).

---

## Review consensus

| Lens | Scores (0–10) | Verdict |
|---|---|---|
| **CEO/Product** | right-problem 6 · scope 4 · moat 3 · trajectory 5 | Reframe is 2x not 10x; the moat is the policy/audit/verification spine + policy that *earns autonomy*, not the Linear button. Promote trust to co-P0. |
| **Design** | hierarchy 8 · magic 6 · specificity 4 · craft 6 · focus 5 | Right diagnosis, under-specified design. Steering + cross-agent review + inbox ranking are the brain/hero and are hand-waved. Cut to one exceptional dark theme. |
| **Eng** | arch-fit 7 · edges 6 · effort 6 · tests 5 · deploy 7 | Inbox is a cheap derived selector (green light). Connector auto-generalization is the biggest, riskiest refactor (threatens the *sacred* default-deny invariant), mislabeled P2. Drop merge-conflicts from P0. |
| **DX** | TTV 6 · payoff 5 · model/connector cred 4 · trust 7 · team 3 | "Wow" demo, but session #2 bites: idle-slot leak + cap=4 cap parallelism; the inbox makes the human the serial bottleneck; multi-provider is oversold; one bad Land sends users back to terminals. |

**Cross-phase themes (flagged by 3+ lenses independently — high confidence):**
1. **Trust is under-built** → promoted to co-equal P0 pillar (trust card + legible/undoable Land).
2. **Connector auto-generalization is unsafe as written** → curated + discovery-as-suggestion; preserve default-deny + the policy truth-table tests.
3. **Cut light/dark from v2.0** → dark-only + token layer; light in v2.1.
4. **Inbox ranking + steering are the product's brain/hero and were unspecified** → now specified above.

## Decision audit trail (auto-decided via the 6 principles)

| # | Phase | Decision | Class | Principle | Rationale |
|---|---|---|---|---|---|
| 1 | Eng | Inbox = client-side derived selector over existing store slices; no new IPC | Mechanical | P3 pragmatic | Three slices already flow over the EventBus. |
| 2 | Eng | Drop "merge conflicts" from the P0 inbox → P1 branch lifecycle | Mechanical | P3 | Conflict detection is new git work; don't smuggle an M into a free P0. |
| 3 | Eng/Design | Cards read last *persisted* line; live shimmer only for focused session | Mechanical | P5 explicit | Avoids a 10-agent render storm. |
| 4 | Design | Specify inbox ranking (error>plan>conflict>outward, age tiebreak) | Mechanical | P1 completeness | Ranking is the value; unranked = a list. |
| 5 | Design/Eng | Dark-only v2.0 + semantic token layer; light → v2.1 | Taste→auto | P5+P3 | Unanimous; token layer makes light cheap later. |
| 6 | Design | Accessibility (reduced-motion/focus-visible/contrast/non-color status) = acceptance criteria | Mechanical | P1 | Keyboard-first product must have visible focus. |
| 7 | Design | Fix accent semantic collision (Running vs primary button) | Mechanical | P5 | "Surface one thing" needs a reserved alert color. |
| 8 | DX/Eng | Fix idle-slot leak; make concurrency cap a visible control | Mechanical | P1 | "Many agents" promise fails at cap=4 + leaking slots. |
| 9 | DX | Notifications: coalesce, only blocking notifies, suppress when focused | Mechanical | P5 | Bad rules get the app muted day one. |
| 10 | DX | Multi-provider: registry holds a list of gateway models; honest labels; cost provenance | Mechanical | P1 | One all-or-nothing gateway model is oversold. |
| 11 | DX | Auto-router shows routed preset before spawn | Mechanical | P5 | Silent misroute on the default path erodes trust. |
| 12 | Eng | Any connector/policy work must extend the truth-table + adversarial classifier tests (default-deny on unseen connectors) | Mechanical | P1 | CLAUDE.md mandates it; gates the riskiest feature. |
| 13 | CEO/Design | Promote Trust (trust card + legible/undoable Land + first-class steering) to P0 | **User Challenge** | — | See gate — changes the stated "expand UI features" priority. |
| 14 | All | Connector breadth: curated + discovery-as-suggestion, not auto-generalize | **User Challenge** | — | See gate — narrows the stated "wider suite of tools." |
| 15 | All | Per-recipe default model now; defer per-step routing | Taste | P3 | Unanimous; per-step is an L that fights one-query-per-session. |
| 16 | All | Defer multiple agent runtimes; don't build the abstraction | Taste | P5 | Unanimous; abstraction now would be Claude-shaped and wrong. |
