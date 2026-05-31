# RALPH: Reasoning-Anchored Loop for Planning and Hypothesizing

**Date**: 2026-04-17
**Origin**: Observed during FP WordPress FM-to-ACF migration — 6 agents, 2 planning sessions, and 1600 lines of plan missed a critical data flow because the default mode was forward-chaining exploration instead of backward reasoning from the end state.
**Status**: Design draft — ready for prototyping

---

## The Problem

Claude Code defaults to **progressive exploration**: read a file, think, read another, think, propose a change, test it. This works for small tasks but fails predictably at scale because:

1. **Forward-chaining anchors on step 1, not the goal.** The model picks the most obvious first action and builds from there. If step 1's framing is wrong, everything downstream inherits that error.

2. **Unknowns are discovered during execution, not before.** A shortcode was the only consumer of a data function. No agent, across two sessions, traced the call chain to discover this — because they started from the data layer and worked forward, never from the frontend and worked backward.

3. **Context decays as exploration progresses.** By tool call 15, the model's memory of tool call 3 is degraded. Progressive exploration maximizes the number of tool calls, maximizing decay.

4. **"Reasoning" is prediction on rails.** The chain-of-thought doesn't naturally resist the forward-chaining default. It needs an external scaffold to redirect attention toward the end state before the prediction chain crystallizes into an action plan.

## The Insight

**Don't classify the request — classify the gap.**

A request that sounds complex ("convert this entire post type") might have a tiny delta if prior work exists. A request that sounds simple ("fix the display") might have an enormous delta if the root cause is unknown. The operation's complexity lives in the gap between current state and desired end state, not in the words of the request.

**Don't plan forward from step 1 — plan backward from done.**

"What does done look like?" is the most powerful question. Everything else follows: what must be true for done to hold, what's currently true, what's the delta, what resolves the delta. Forward-chaining skips all of this and goes straight to "what file should I read first?"

## Architecture Overview

```
User prompt arrives
        │
   ┌────▼────┐
   │ LAYER 0 │  Cognitive Redirect (UserPromptSubmit hook)
   │  HALT   │  Stop forward-chaining. Force backward reasoning.
   │ ENVISION│  What does "done" look like?
   │ LOCATE  │  Where are we now?
   │  DELTA  │  What's the gap?
   └────┬────┘
        │
   ┌────▼────┐
   │ LAYER 1 │  Gap Classification
   │ CLASSIFY│  Based on delta, not request text
   │  ROUTE  │  Determine tier and chain downstream
   └────┬────┘
        │
   ┌────┼──────────────────────┐
   │    │                      │
   ▼    ▼                      ▼
TIER 1  TIER 2              TIER 3
trivial known+large         has unknowns
 │       │                     │
 │    ┌──▼──┐             ┌────▼────┐
 │    │RALPH│             │ LAYER 2 │  Agent-based research
 │    │ONCE │             │ RESOLVE │  Spawn scoped agents in REPL
 │    └──┬──┘             │ UNKNOWNS│  Return structured facts
 │       │                └────┬────┘
 │       │                     │
 │       │                ┌────▼────┐
 │       │                │ LAYER 3 │  RALPH with verified facts
 │       │                │  RALPH  │  Loop until L is empty
 │       │                └────┬────┘
 │       │                     │
 ▼       ▼                     ▼
   ┌─────────┐
   │ LAYER 4 │  Execution
   │PREFLIGHT│  From H (hypothesized failures)
   │  READ   │  All targets
   │TRANSFORM│  Apply changes
   │ VERIFY  │  Confirm success
   │ REPORT  │  Structured results
   └─────────┘
```

---

## Layer 0: Cognitive Redirect

**When**: UserPromptSubmit hook — fires before any tool use or reasoning about tools.

**Purpose**: Interrupt the default forward-chaining prediction and redirect attention to the end state. This is not classification — it's the pre-classification reasoning that PRODUCES correct classification.

**Forced outputs** (the model must articulate these before proceeding):

| Step | Question | Output |
|------|----------|--------|
| **HALT** | Am I about to start forward-chaining? | Acknowledge the impulse. Don't act on it. |
| **END** | What does "done" look like? Be concrete and verifiable. | A specific, testable description of the end state. Not "fix the bug" but "the shortcode renders graphics content with correct HTML on the frontend." |
| **HERE** | What's the current state? What do I know vs. assume? | Separate verified facts from assumptions. Every assumption is a potential failure point. |
| **DELTA** | What's the gap between HERE and END? | The list of things that must change or be established. This is the raw input for classification. |

**Key principle**: END is not the user's words — it's the *result of the user's intent*. "Convert graphics to ACF" → END is "graphics render correctly everywhere they're used, with no FM dependency." That framing would have caught the shortcode consumer.

### Why HALT matters

The model's prediction mechanism will, by default, start generating a plan the moment it reads the prompt. The first few tokens of the response often commit to a strategy before reasoning is complete. HALT is an explicit instruction to suppress that initial impulse and redirect to END first.

This is analogous to how `format_value=false` changes the behavior of a function call — HALT changes the behavior of the prediction chain by redirecting its anchor point.

---

## Layer 1: Gap Classification

**When**: After Layer 0 completes.

**Input**: The DELTA from Layer 0.

**Classification logic**:

```
IF delta items are all known AND total scope is small (≤3 files, ≤1 concept)
  → TIER 1: Direct execution. Skip RALPH. Go to Layer 4.

IF delta items are all known AND scope is large (>3 files OR multiple concepts)
  → TIER 2: RALPH once. Plan the pipeline. Go to Layer 3, single pass.

IF delta contains unknowns (assumptions, unverified claims, untraced call chains)
  → TIER 3: Resolve unknowns first. Go to Layer 2.
```

**Bail-out**: Tier 1 is the fast path. Most read-only queries, simple lookups, and single-file edits should bail out here. The overhead of RALPH is not justified for `grep` calls.

**Forced progression**: If ANY item in DELTA is an unknown, classification MUST be Tier 3. No optimistic "I'll figure it out during execution." Unknowns are resolved before planning, always.

---

## Layer 2: Unknown Resolution (Agent Dispatch)

**When**: Tier 3 classification — DELTA contains unknowns.

**Mechanism**: Spawn scoped research agents within REPL. Each agent gets a specific list of unknowns to resolve and returns structured findings.

```javascript
// Example: resolve unknowns about data consumers
const findings = await agent(
  \`You are a research agent. Your ONLY job is to answer these questions
  by reading source code. Return a JSON object with your findings.

  Questions:
  1. What files call build_graphic_output()? List every caller with file:line.
  2. What does get_field('graphic_settings', $id, false) return for group fields?
     Specifically: are array keys field names or field keys?
  3. Does the shortcode apply any formatting (wpautop, the_content) to the
     graphic_content value it receives?

  Search in: themes/foreign-policy-2017/
  Do not modify any files. Read only.\`,
  { description: 'Research graphics data consumers', mode: 'research' }
);
```

**Rules for research agents**:
- Scoped mandate: specific questions, not open exploration
- Read-only: never modify files
- Structured return: facts, not prose
- One agent per knowledge domain: don't ask one agent to research both data flow AND CSS rendering

**Output**: Each unknown from DELTA is either resolved (becomes a fact) or escalated (cannot be determined from code alone — requires user input).

---

## Layer 3: RALPH

**When**: Tier 2 (single pass) or after Layer 2 resolves unknowns (Tier 3).

**The loop**:

| Step | Action | Feeds |
|------|--------|-------|
| **R — Reason** | State the intent from verified facts. Not from the user's words — from the understood END state and resolved DELTA. | A, L |
| **A — Abduct** | Work backward from END. What must be true at each step for the end state to hold? This is reverse causal reasoning — if the shortcode must render HTML, then build_graphic_output must return HTML, then get_field must return name-keyed arrays, then the ACF field group must define those names... | L, P |
| **L — Learn** | List remaining unknowns. If any exist, loop back to Layer 2. If empty, proceed. | Loop gate |
| **P — Plan** | Design the concrete operation. Files to read, edits to make, order of operations. This is the script blueprint. | H |
| **H — Hypothesize** | For each assumption that survived into P: what breaks if it's wrong? Each hypothesis becomes a preflight check in Layer 4. | Layer 4 |

**Loop condition**: L is empty (all unknowns resolved). If L surfaces new unknowns during A or P, return to Layer 2. The loop prevents planning on assumptions.

**RALPH is not a checklist** — it's a feedback loop. The abduction step (A) frequently surfaces unknowns that weren't apparent in Layer 0's DELTA. That's the point. Better to discover them here than during execution.

---

## Layer 4: Execution

**When**: RALPH completes (L is empty, P is concrete, H has hypotheses).

**The pattern** (proven in practice):

```javascript
// PREFLIGHT — Every H hypothesis becomes a check
function check(name, condition, detail) {
  results.checks.push({ name, pass: condition, detail });
  if (!condition) throw new Error(\`PREFLIGHT FAILED: ${name} — ${detail}\`);
}

check('correct branch', branch === expected, \`got ${branch}\`);
check('file exists', fs.existsSync(target), target);
check('pattern present', content.includes(searchStr), 'edit target not found');

// READ — All targets in one pass
const files = targets.map(f => ({ path: f, content: fs.readFileSync(f, 'utf-8') }));

// TRANSFORM — Apply edits with pattern matching
for (const file of files) {
  file.content = file.content.replace(oldPattern, newPattern);
  fs.writeFileSync(file.path, file.content);
}

// VERIFY — Confirm every edit landed
for (const file of files) {
  const verify = fs.readFileSync(file.path, 'utf-8');
  check(\`${file.path} edit applied\`, verify.includes(expected), 'edit not found after write');
}

// REPORT — Structured results
return { checks, edits, verifications };
```

**Key properties**:
- Atomic: one REPL call does the entire operation
- Self-verifying: reads back every edit
- Fail-fast: preflight throws on first failure
- Transparent: structured report shows exactly what happened

---

## Design Principles

### 1. Classify the gap, not the request
The request "fix the display" could be Tier 1 (CSS tweak) or Tier 3 (data layer bug affecting a hidden consumer). The gap determines complexity, not the words.

### 2. Backward reasoning before forward planning
Every strategy starts from END and works backward. Forward-chaining is only permitted inside Layer 4 (execution), where the plan is already concrete.

### 3. Unknowns are resolved, not assumed
If you don't know, dispatch an agent to find out. Don't guess and proceed. The cost of a research agent is negligible compared to the cost of a wrong assumption propagating through 5 files.

### 4. Agents are scoped probes, not mini-mes
Research agents answer specific questions. They don't "explore the codebase" or "understand the system." They trace a call chain, verify a data format, or check for consumers. Tight scope, structured return.

### 5. Hypotheses become preflight checks
Every surviving assumption in the plan is a potential failure. H converts assumptions into executable checks that run before any edit is attempted.

### 6. One REPL call, not twenty tool calls
The entire execution phase is one atomic script. Progressive tool calls burn context, multiply latency, and lose coherence. A single well-planned script is cheaper, faster, and self-verifying.

---

## What RALPH Would Have Caught

### The `format_value=false` bug

**Layer 0 — END**: "Graphics render correctly via the shortcode on the frontend."

**Layer 0 — DELTA**: The plan says change `get_post_meta` to `get_field` with `false`. Unknown: what does `false` actually do to group field returns?

**Layer 1 — Classification**: DELTA has unknowns → Tier 3.

**Layer 2 — Research agent**: "What does `get_field('graphic_settings', $id, false)` return? Are keys field names or field keys?"

Agent discovers: keys are `field_6c01_graphic_type` not `graphic_type`. **Unknown resolved before any code is written.**

**Layer 3 — RALPH — H**: "If we use `false`, all downstream array access (`$settings['graphic_type']`) breaks." → This becomes a preflight check.

**Result**: The bug never exists. The plan is corrected before implementation begins.

### The shortcode consumer

**Layer 0 — END**: "Graphics render correctly **everywhere they're used**."

That word "everywhere" forces the question: where ARE they used? The forward-chaining approach started from the data layer (FM fields) and worked forward to templates. It never asked "who calls `build_graphic_output()`?"

**Layer 2 — Research agent**: "Find all callers of `build_graphic_output()`." Returns: `graphics_post_embed.php:29`.

**Result**: The shortcode is identified as a consumer before any template edits are planned. Testing includes shortcode rendering from the start.
