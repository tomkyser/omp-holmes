# HOLMES Extension — Interactive Testing Guide

Run all tests from the project root: `/Users/tom.kyser/dev/reasoner/`

---

## Pre-flight: Unit Tests

```bash
bun test src/main.test.ts
```

Expected: 35 pass, 0 fail, 136 expect() calls.

---

## Pre-flight: Extension Loads

```bash
omp --no-lsp --no-session -p "What is 2+2?"
```

Expected: You should see a notification toast or banner: **"HOLMES cognitive redirect active"** at session start. The model should answer normally (no gate fires for a non-tool response).

---

## Test 1: `/extensions` Dashboard

Start interactive mode:
```bash
omp --no-lsp --no-session
```

Type `/extensions` and look for:
- **Extension Modules** section lists `main` (from `src/main.ts`)
- The HOLMES label should be visible

Exit with Ctrl+C.

---

## Test 2: `/holmes-status` Command

Start interactive mode:
```bash
omp --no-lsp --no-session
```

Type `/holmes-status`. Expected output:
```
HOLMES extension is active.

Registered surfaces:
  Commands:       /holmes, /holmes-goal, /holmes-status
  Events:         session_start, turn_start, before_agent_start,
                  message_update, message_end, tool_call, tool_result
  System prompt:  HOLMES cognitive redirect (visible marker protocol)

Runtime counters (this session):
  Turns started:             1
  Tool calls intercepted:    0
  ...
```

All counters should be 0 or 1 (only the turn for your /holmes-status message).

---

## Test 3: Visible Marker Gate — Block Without Evidence

```bash
omp --no-lsp --no-session
```

Type:
```
Create a file called /tmp/holmes-test.txt with the text "hello world"
```

**Expected behavior:**
1. The model attempts to call `write` or `bash`
2. The reasoning gate blocks with:
   ```
   [HOLMES reasoning gate] No visible HOLMES classification marker observed
   in your assistant text this turn before mutating tool (`write`).
   Emit a visible marker before retrying...
   ```
3. The model should then emit a visible marker like `[CLASSIFY: Tier 1]` or `## HOLMES: Tier 1` in its text
4. On retry, the tool call should succeed

**What to check after:** Type `/holmes-status` — `Reasoning reminders sent` should be >= 1, and `Visible markers observed` should be >= 1.

---

## Test 4: Visible Marker Gate — Tier 1 Fast Path

```bash
omp --no-lsp --no-session
```

Type:
```
Read the file package.json and tell me the package name
```

**Expected:** No gate fires. `read` is not a mutating tool, so no marker is needed. The model reads the file and responds normally.

---

## Test 5: Primitive Burst Gate

```bash
omp --no-lsp --no-session
```

Type:
```
Read these files one by one: package.json, src/main.ts, src/types.ts, src/observation.ts, src/guards.ts
```

**Expected:** After 3 consecutive reads, the 4th should be blocked with:
```
[HOLMES primitive-burst gate] Primitive exploration chain detected (4 consecutive).
Rewrite the remaining investigation as one eval() cell...
```

The model should then switch to `eval` for batched reading.

---

## Test 6: TTSR Forward-Chain Guard

```bash
omp --no-lsp --no-session
```

Type:
```
Edit the file README.md and add a line at the top that says "test"
```

**Expected:** If the model starts writing prose like "Let me directly edit the file..." without first emitting ENVISION/DELTA/TARGET evidence, the TTSR `forward-chain-guard` rule should fire mid-stream. You'll see the model's output get interrupted and redirected.

**Note:** TTSR default repeat mode is `once` — it will only fire the first time per session. To test repeated firing, add to `.omp/settings.json`:
```json
{
  "extensions": ["./"],
  "ttsr": {
    "repeatMode": "afterGap",
    "repeatGap": 3
  }
}
```

---

## Test 7: TTSR Eval Bypass Protection

```bash
omp --no-lsp --no-session
```

First, trigger the reasoning gate so the model knows mutations are blocked. Then watch if it tries to use eval as a bypass.

Type:
```
Write a Python script to /tmp/test.py that prints hello world. Use whatever tool works.
```

**Expected (one of):**
- If the model writes in prose/thinking about using eval to bypass: `eval-mutation-intent` TTSR rule fires mid-stream
- If the model silently tries eval with `write()` in the code: `eval-mutation-code` TTSR rule fires (scope: `tool:eval`)
- If the model just emits `[CLASSIFY: Tier 1]` and uses `write` properly: that's the desired behavior — HOLMES is working

---

## Test 8: Delegation Guard — Dead Agent Names

```bash
omp --no-lsp --no-session
```

Type:
```
Use the Task tool with agent "holmes-researcher" to look up the package.json name
```

**Expected:** The delegation guard blocks with:
```
[HOLMES delegation gate] `holmes-researcher` is not available as a Task agent.
Retry with `agent: "explore"` and include the HOLMES researcher contract in the assignment.
```

---

## Test 9: Delegation Guard — Bundled Agents Pass

```bash
omp --no-lsp --no-session
```

Type:
```
Use Task with agent "explore" to find all TypeScript files in src/
```

**Expected:** No block. The `explore` agent is a valid bundled agent. The Task call should proceed normally.

---

## Test 10: Verify Reminder

```bash
omp --no-lsp --no-session
```

Type:
```
[CLASSIFY: Tier 1]
Add a comment "# test" to the top of src/types.ts
```

**Expected:** After the edit completes, the tool result should include:
```
[HOLMES] Verify this change landed correctly: read the affected file and confirm the edit matches your intent.
```

After verifying, undo the change (or the model may do it automatically).

---

## Test 11: `/holmes` Command

```bash
omp --no-lsp --no-session
```

Type:
```
/holmes Refactor the guards module to support configurable tool sets
```

**Expected:** The model receives a structured HOLMES prompt and should produce visible reasoning with:
1. Layer 0 cognitive redirect (HALT, ENVISION, LOCATE, DELTA, CLASSIFY)
2. Tier classification
3. If Tier 2/3: full HOLMES loop (Hone, Observe, Ladder, Map, Establish, Synthesize)
4. Execution packet with delegation decisions
5. Visible `## HOLMES: Tier N` marker before any mutations

---

## Test 12: `/holmes-goal` Command

```bash
omp --no-lsp --no-session
```

Type:
```
/holmes-goal Add WebSocket support to the extension for real-time status updates
```

**Expected:** The model produces a structured `/goal` objective with: objective, context, constraints, acceptance criteria, and risks.

---

## Test 13: RULES.md Always-Apply

```bash
omp --no-lsp --no-session
```

Type:
```
/holmes-status
```

Then ask:
```
What rules or context are active in your system prompt right now? Do you see anything about HALT, ENVISION, or cognitive redirect?
```

**Expected:** The model should reference the HOLMES cognitive redirect from both:
1. The system prompt append (from `before_agent_start`)
2. The always-apply RULES.md (injected as per-turn context)

**Caveat:** Models can't always reliably introspect their system prompt. If unsure, check the `/extensions` dashboard for rule count, or look at OMP logs.

---

## Test 14: Full Real-World Workflow

```bash
omp --no-lsp --no-session
```

Type a non-trivial task:
```
Analyze the src/ directory structure and suggest improvements to the module organization. Then implement one small improvement.
```

**Expected full flow:**
1. Model emits visible HOLMES classification (Tier 2 or 3)
2. For investigation: uses `eval` for batched discovery (not sequential reads)
3. Before any edit: visible `## HOLMES: Tier 2` block with TARGET/NOW/DELTA/NEXT
4. May delegate research via Task with `explore` agent
5. After edits: verify reminders appear
6. Primitive burst gate fires if sequential reads exceed 3

**What NOT to see:**
- Straight to `edit`/`write` without visible classification
- "Let me read X, then search Y, then read Z" sequential chains (TTSR should catch)
- eval used to bypass write gates (TTSR should catch)
- Dead agent names in Task calls

---

## Test 15: Non-Interactive / Print Mode

```bash
omp --no-lsp --no-session -p "Create a file /tmp/holmes-print-test.txt with content 'hello'"
```

**Expected:** In print mode, the reasoning gate should NOT hard-block (that would kill the response). The model should either:
- Emit the marker and proceed, OR
- The context event injects a soft reminder

Check `/tmp/holmes-print-test.txt` — if it exists, the model completed the task. If not, the gate may still be too aggressive for print mode and needs tuning.

---

## Post-Test: Check Counters

After running several tests in one session, type `/holmes-status` and verify all counter categories have non-zero values:

| Counter | Should Be > 0 After |
|---------|---------------------|
| Turns started | Any test |
| Tool calls intercepted | Any test with tools |
| Primitive bursts blocked | Test 5 |
| Reasoning reminders sent | Test 3 |
| Verify reminders appended | Test 10 |
| System prompt appends | Any test |
| Visible markers observed | Test 3 (after model complies) |
| Delegation task calls | Test 9 |
| Delegation blocked calls | Test 8 |

---

## Troubleshooting

**TTSR rules not firing:**
- Check `.omp/settings.json` says `["./"]` not `["./src/main.ts"]`
- Check OMP logs: `~/.omp/logs/omp.*.log` — search for "TTSR" or "condition"
- TTSR fires once per session by default — restart for each TTSR test

**Gate too aggressive in print mode:**
- The `context` event handler should inject soft reminders instead of blocking
- If still blocking: check if `message_update` fires in print mode (it may not stream)

**Model ignores HOLMES entirely:**
- Check `/holmes-status` to confirm the extension is active
- Check that `before_agent_start` counter > 0 (system prompt was appended)
- The model may need stronger prompt wording — this is iterative

**Extension not loading:**
- Run `omp --extension ./` explicitly to rule out settings issues
- Check that `package.json` has `"omp": { "extensions": ["./src/main.ts"] }`
