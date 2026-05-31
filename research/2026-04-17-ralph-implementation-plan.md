# RALPH Implementation Plan

**Date**: 2026-04-17
**Target**: Claude Code hooks system (UserPromptSubmit + PreToolUse)
**Dependencies**: REPL tool with agent() support, Tungsten for persistent sessions

---

## Implementation Phases

### Phase 1: UserPromptSubmit Hook — Cognitive Redirect

The foundation. Fires on every user message, injects the HALT → END → HERE → DELTA scaffold.

#### 1A. Hook Registration

```json
// settings.json hooks section
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "type": "prompt",
        "prompt": "... (Layer 0 scaffold — see 1B)"
      }
    ]
  }
}
```

#### 1B. Layer 0 Prompt Injection

```
Before responding to this message, complete the following cognitive redirect:

HALT: Suppress the impulse to immediately plan actions or reach for tools.

END: What does "done" look like for this request? Describe a concrete, verifiable
     end state. Not the task — the RESULT of the task as experienced by the user
     or the system.

HERE: What is the current state? List:
      - KNOWN: Facts you can verify (branch, files, recent context)
      - ASSUMED: Things you believe but haven't verified
      - UNKNOWN: Things you'd need to investigate

DELTA: What must change between HERE and END? For each item, mark:
       [F] = fact (verified)
       [A] = assumption (unverified — potential failure point)
       [U] = unknown (must resolve before planning)

CLASSIFY:
  - If all DELTA items are [F] and scope is small → TIER 1: act directly
  - If all DELTA items are [F] and scope is large → TIER 2: RALPH once, then execute
  - If ANY DELTA item is [A] or [U] → TIER 3: resolve unknowns first

State your classification and proceed accordingly.
```

#### 1C. Adaptive Depth — Trivial Request Bypass

The hook adds overhead. For trivial requests ("what branch am I on?", "read this file"), Layer 0 should complete in ~2 sentences and classify as Tier 1 immediately.

The prompt should include:

```
If the request is a simple query, single read, or direct question with no mutation:
END/HERE/DELTA can each be one phrase. Classify as TIER 1 and proceed immediately.
Do not over-analyze trivial requests.
```

#### 1D. Acceptance Criteria

- [ ] Hook fires on every user message
- [ ] Model outputs END/HERE/DELTA before taking any tool action
- [ ] Trivial requests complete Layer 0 in ≤3 sentences
- [ ] Complex requests produce a structured DELTA with [F]/[A]/[U] markers
- [ ] Classification routes to correct tier

---

### Phase 2: PreToolUse Hook — RALPH Enforcement for REPL

Fires before REPL tool calls. For Tier 2/3 operations, enforces RALPH completion before the script executes.

#### 2A. Hook Registration

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "type": "prompt",
        "toolName": "REPL",
        "prompt": "... (RALPH checkpoint — see 2B)"
      }
    ]
  }
}
```

#### 2B. RALPH Checkpoint Prompt

```
Before executing this REPL script, verify RALPH completion:

If this operation was classified as TIER 2 or TIER 3:
  R: What is the reasoned intent? (1 sentence, from facts not assumptions)
  A: What is the backward chain from END to the first action? (ordered list)
  L: Are there remaining unknowns? (If yes: STOP. Resolve before executing.)
  P: What is the script structure? (preflight → read → transform → verify)
  H: What assumptions survive? (Each becomes a preflight check in the script)

If TIER 1: Skip RALPH. Proceed with execution.

If the script does not include preflight checks for items from H: add them.
If the script does not include post-edit verification: add it.
```

#### 2C. Acceptance Criteria

- [ ] RALPH outputs appear before Tier 2/3 REPL executions
- [ ] Tier 1 REPL calls are not delayed by RALPH overhead
- [ ] H items are traceable to preflight `check()` calls in the script
- [ ] L being non-empty blocks execution (model dispatches research agents instead)

---

### Phase 3: Agent Dispatch Patterns for Unknown Resolution

Establish reusable patterns for spawning scoped research agents within REPL.

#### 3A. Research Agent Template

```javascript
async function resolveUnknowns(unknowns, searchScope) {
  const results = {};

  for (const [key, question] of Object.entries(unknowns)) {
    const finding = await agent(
      \`You are a research agent. Answer this specific question by reading source code.
      Return ONLY the factual answer — no commentary, no suggestions.

      Question: ${question}
      Search scope: ${searchScope}
      
      Do not modify any files. Read only.\`,
      { 
        description: \`Research: ${key}\`,
        mode: 'research'
      }
    );
    results[key] = finding;
  }

  return results;
}

// Usage:
const facts = await resolveUnknowns({
  consumers: 'What files call build_graphic_output()? List file:line for each.',
  dataFormat: 'What does get_field() with format_value=false return for group fields?',
  shortcodeFormatting: 'Does graphics_post_embed.php apply wpautop or the_content filters?'
}, 'themes/foreign-policy-2017/');
```

#### 3B. Agent Scoping Rules

| Rule | Why |
|------|-----|
| One question per agent (preferred) or tightly related set | Prevents scope creep and context decay |
| Read-only mandate | Research agents must not mutate state |
| Structured return format | Facts feed RALPH, not prose |
| Explicit search scope | Prevents unbounded exploration |
| Timeout awareness | Agent operations have latency; batch wisely |

#### 3C. Acceptance Criteria

- [ ] Research agents return structured facts
- [ ] Facts convert DELTA [U] items to [F] items
- [ ] Agent failures are caught and surfaced (not silent)
- [ ] Agents do not modify files

---

### Phase 4: Execution Pattern Library

Codify the proven preflight → read → transform → verify pattern as a reusable framework within REPL.

#### 4A. Execution Scaffold

```javascript
function createExecutionContext(name) {
  const ctx = {
    name,
    checks: [],
    edits: [],
    verifications: [],
    check(label, condition, detail) {
      ctx.checks.push({ label, pass: condition, detail });
      if (!condition) throw new Error(\`PREFLIGHT: ${label} — ${detail}\`);
    },
    report(category, msg) {
      ctx[category].push(msg);
    }
  };
  return ctx;
}

// Usage:
const ctx = createExecutionContext('graphics-format-value-fix');

// Preflight
ctx.check('branch', branch === expected, \`got ${branch}\`);
ctx.check('target exists', fs.existsSync(file), file);

// Read
const content = fs.readFileSync(file, 'utf-8');

// Transform  
const updated = content.replace(old, new_);
fs.writeFileSync(file, updated);
ctx.report('edits', \`${file}: replaced pattern\`);

// Verify
const verify = fs.readFileSync(file, 'utf-8');
ctx.check('edit applied', verify.includes(expected), 'pattern not found after edit');

return ctx;
```

#### 4B. Acceptance Criteria

- [ ] Execution scripts are atomic (one REPL call)
- [ ] Every edit has a corresponding verification read-back
- [ ] Preflight failures abort before any mutation
- [ ] Structured report returned for every execution

---

### Phase 5: Integration Testing

Test the full pipeline end-to-end with real tasks of varying complexity.

#### 5A. Test Cases

| Test | Expected Tier | Key Validation |
|------|--------------|----------------|
| "What branch am I on?" | Tier 1 | Layer 0 completes in ≤2 sentences, no RALPH |
| "Read settings/graphics-content.php" | Tier 1 | Direct tool call, no overhead |
| "Add a new ACF field to this group" | Tier 2 | RALPH once, single REPL execution |
| "Convert this post type from FM to ACF" | Tier 3 | Research agents dispatched, multiple RALPH iterations |
| "Fix the display" (ambiguous) | Tier 3 | END forces clarification of what "display" means |

#### 5B. Metrics

| Metric | Target |
|--------|--------|
| Tier 1 overhead | <5 seconds additional latency |
| Unknown detection rate | >90% of assumptions surfaced before execution |
| Execution success rate (no post-hoc fixes) | >85% |
| Context efficiency (tool calls per task) | ≤50% of baseline |

---

## Open Questions

### Q1: Hook injection size vs. context cost
The Layer 0 prompt adds ~200 tokens per user message. Over a long session, this accumulates. Should the hook be shorter for follow-up messages in an ongoing task?

### Q2: RALPH output format
Should RALPH outputs be structured (JSON-like) or prose? Structured is parseable by downstream hooks but may feel mechanical. Prose is natural but harder to validate.

### Q3: Agent dispatch latency
Research agents add wall-clock time. For time-sensitive tasks, is there a "fast RALPH" mode that skips agents and accepts [A] items as provisional facts with explicit risk acknowledgment?

### Q4: Interaction with existing hooks
The FP project has Clawback hooks (format, lint, typecheck). RALPH should compose with these, not conflict. Layer 4 execution should expect Clawback's PostToolUse formatting.

### Q5: Training effect
Does repeated RALPH injection train the model to internalize the pattern over a session? If so, could the hook be reduced to a reminder after N messages? (Observation needed.)

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Over-classification (everything becomes Tier 3) | Clear bail-out criteria for Tier 1. Trivial bypass in prompt. |
| RALPH as cargo cult (model fills template without thinking) | H items must appear as actual `check()` calls in scripts. Verifiable connection. |
| Agent dispatch explosion (too many agents for too many unknowns) | Cap at 3 agents per unknown-resolution cycle. Batch related questions. |
| Context bloat from hook injections | Compact prompt text. Consider session-stage adaptation. |
| User frustration with perceived slowness | Tier 1 fast path must be genuinely fast. Visible classification lets user understand why complex tasks take longer. |
