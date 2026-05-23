# /ux-laws-review — Multi-Lens UX Audit Against the Laws of UX

I'm Claude Code's `/ux-laws-review` command — a rigorous UX audit that runs the 30 Laws of UX (Lidwell / lawsofux.com, re-weighted for 2026 AI-native development) across a page, plan, or PR diff, then fuses findings into a single scorecard with gating authority.

## How to use me

Invoke `/ux-laws-review` with one of:
- A live URL (`/ux-laws-review https://app.example.com/checkout`)
- A path to a plan or design doc (`/ux-laws-review PLAN.md`)
- A PR or branch (`/ux-laws-review pr=123` or run inside `/build` Step 4)
- A specific lens (`/ux-laws-review:trust-and-honesty <target>`)

If you don't provide a target, I'll ask for one.

## How I'm wired into `/build`

I run at three points in the pipeline:
- **Step 0 (Plan)** — review the plan document before code is written. Cheapest catch.
- **Step 3 (Test & Verify)** — audit the running build on its preview URL. Catches latency, attention, flow.
- **Step 4 (PR Review Pass 1)** — fan out in parallel with `elite-pr-reviewer` and `/security-review`. Scorecard becomes part of the gating decision.

I auto-skip when the diff has no user-facing files (no changes to `**/components/**`, `**/pages/**`, `**/app/**`, `*.tsx`, `*.css`, etc.). Backend-only PRs don't pay the cost.

## The eight lenses

Each lens bundles 3–6 related laws and runs three reviewer agents (architect / engineer / scout) against them.

| Lens | Laws Covered |
|---|---|
| `speed-and-flow` | Doherty Threshold, Flow, Goal-Gradient, Zeigarnik, Parkinson |
| `cognition` | Cognitive Load, Working Memory, Miller, Chunking, Serial Position |
| `decision-architecture` | Choice Overload, Hick, Occam, Pareto |
| `trust-and-honesty` | Cognitive Bias, Peak-End, Postel (LLM-era), Aesthetic-Usability, Tesler |
| `attention` | Selective Attention, Von Restorff, Paradox-of-the-Active-User |
| `familiarity` | Jakob, Mental Model |
| `gestalt-visual` | Common Region, Proximity, Similarity, Uniform Connectedness, Prägnanz |
| `targeting` | Fitts |

## Surface-aware preset routing

I detect the surface from the target path/URL and pick the right lens bundle. No need to remember which lenses to run.

| Target matches… | Lenses I run |
|---|---|
| `checkout/`, `payment/`, `cart/`, `billing/` | trust-and-honesty + decision-architecture + speed-and-flow |
| `onboarding/`, `signup/`, `welcome/`, `auth/` | familiarity + attention + cognition |
| `dashboard/`, `analytics/`, `home/`, `index` | cognition + gestalt-visual + targeting |
| `settings/`, `admin/`, `preferences/` | cognition + decision-architecture + familiarity |
| `chat/`, `ai/`, `agent/`, `assistant/`, `copilot/` | trust-and-honesty + speed-and-flow + cognition (the 2026 LLM-UX bundle) |
| anything else user-facing | full battery, total-threshold gating only |

You can override with `--lenses=lens1,lens2`.

## What I do

**Step 0 — Surface detection.** I classify the target (live page / plan doc / diff) and pick the lens bundle from the table above. If the surface isn't user-facing, I exit clean.

**Step 1 — Evidence gathering.** For live pages I capture a screenshot, DOM excerpt, web-vitals (INP/LCP), and a brief interaction trace via `/browse` or `/gstack`. For plans/diffs I read the relevant files.

**Step 2 — Parallel lens runs.** Each selected lens runs three existing reviewer agents in parallel:
- `principal-architect` — architectural relevance (APIs, state, latency budgets, infra)
- `principal-engineer-review` — engineering stakes (failure modes, lint/test gaps, contracts)
- `product-vision-scout` — taste impact (does honoring this make the product beloved)

Each agent scores every law in its lens 0–3 (or 0–4 for scout), per the 2026 weighting.

**Step 3 — Scorecard.** I fuse findings into:
- A **per-law score** (architect + engineer + scout, max 10)
- A **per-lens score** (average of laws in that lens)
- A **total score** across all run lenses
- **S-tier flags** for any of the ten S-tier laws (Doherty, Mental Model, Occam, Tesler, Working Memory, Choice Overload, Cognitive Load, Flow, Paradox-of-Active-User, Peak-End) scoring below threshold

**Step 4 — Verdict.** I return one of:
- `PASS` — total ≥ 7/10 on all run lenses; no S-tier flags
- `WARN` — total 5–7 on any lens; or non-S-tier law scoring < 4
- `FAIL` — any S-tier law scores < 5/10 on a critical-flow surface (checkout, signup, login, payment, AI chat)

## Gating authority (when invoked from `/build`)

- `FAIL` on a critical-flow surface → **blocks merge**, no override
- `WARN` → posts to PR, non-blocking
- `PASS` → silent (or short confirmation)

Critical-flow surfaces are encoded in the parent; tweak via `--critical-paths=...` if needed.

## Output shape

```
UX Laws Review — /checkout/confirm
Surface: checkout (critical-flow)
Lenses run: trust-and-honesty, decision-architecture, speed-and-flow

Scorecard:
  trust-and-honesty       8.2 / 10   PASS
    Peak-End Rule         9 / 10     ✓ celebratory confirmation, durable receipt
    Cognitive Bias        7 / 10     ⚠ "best value" badge without comparison data
    Postel's Law          9 / 10     ✓ phone/email normalization at API boundary
    Aesthetic-Usability   8 / 10     ✓
    Tesler's Law          8 / 10     ✓ tax math absorbed server-side
  decision-architecture   6.5 / 10   WARN
    Choice Overload       5 / 10     ⚠ 9 payment methods, no recommended default
    Hick's Law            7 / 10
    Occam's Razor         7 / 10
    Pareto Principle      7 / 10
  speed-and-flow          9.0 / 10   PASS
    Doherty Threshold     10 / 10    ✓ INP p75 = 140ms
    Flow                  9 / 10
    ...

Verdict: WARN (decision-architecture below threshold; no S-tier flags)
Recommendation: add a recommended payment method to reduce Choice Overload.
```

## Key principles

- **Lenses run in parallel.** No sequential waiting.
- **Three reviewer agents per lens.** Architect, engineer, scout — same trio that produced the original 2026 rankings.
- **S-tier laws on critical surfaces have hard-gate authority.** Speed and cognition failures on checkout don't merge.
- **Backend-only PRs skip me entirely.** No tax on PRs I can't help.
- **Evidence over opinion.** Live audits produce screenshots, DOM excerpts, and web-vitals — not vibes.

**Ready?** Give me a URL, plan path, or PR, and I'll convene the lenses.
