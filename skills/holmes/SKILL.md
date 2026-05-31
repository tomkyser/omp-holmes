---
name: holmes
description: Structured backward reasoning for complex multi-file changes, ambiguous requests, system design, debugging with unknowns, or tasks requiring investigation before action.
condition: User asks for multi-file refactor, system change with unclear scope, debugging with unknown root cause, or any task where the path from current state to done is not immediately clear.
---

# HOLMES

Activate HOLMES for Tier 2/3 work: multi-file changes, ambiguous requests, system design, unknown root causes, or any task where the route from current state to done is not obvious. Skip it for Tier 1 mechanical edits where the target, transform, and verification are already clear.

HOLMES prevents forward-chaining failure. Do not start from the first plausible edit and hope the path converges. Reason backward from the completed state, expose the gaps that must be closed, then execute only after the map is grounded in evidence.

## Visible Marker Gate

Before any mutating tool, first emit visible assistant text with one classification marker: `[CLASSIFY: Tier 1]`, `## HOLMES: Tier 2`, or `## HOLMES: Tier 3`. Hidden thinking, tool-call arguments, and code comments do not count. For Tier 2/3, include compact visible `TARGET`, `DELTA`, and `NEXT` lines when they help the user follow the route; the marker is the mechanical gate.

## The HOLMES Loop

### H — Hone the finished state

Define what must be true when the work is complete. Capture the user-visible behavior, changed interfaces, affected artifacts, non-goals, and acceptance criteria. Ask backward: “What must be true immediately before done can be claimed?” Convert vague intent into checkable outcomes.

Write down constraints before tools: forbidden files, compatibility requirements, performance or allocation concerns, test boundaries, migration needs, and any required clean cutover. If the acceptance target cannot be stated, continue the loop instead of editing.

### O — Observe the current state

Gather only evidence needed to close the gaps. Locate definitions, call sites, tests, configuration, data contracts, and runtime paths. Prefer structural search for code shape, regex search for text, and focused reads for surrounding context. Record facts with provenance: file path, symbol, and relevant line range.

Do not infer from naming alone. Do not assume a single caller, format, or branch. If the root cause is unknown, reproduce or trace until a concrete failing mechanism is identified.

### L — Ladder the gaps

Classify every open gap:

- Tier 1: Known target, known transform, known verification, small scope. Execute directly after the marker.
- Tier 2: Known facts but broad or multi-step surface. Reason once, map batches and delegation, then execute after the marker.
- Tier 3: Any assumption, factual unknown, architectural decision, root-cause gap, or sequencing risk remains. Resolve or delegate before mutation.

Build the ladder from current state to finished state: prerequisites, decisions, edit groups, dependency order, and verification gates. Each rung must remove one uncertainty or create one required condition.

### M — Map the execution route

Choose the smallest safe route to done. List exact files, symbols, and call sites to change. Decide whether the cutover is direct replacement, adapter removal, schema migration, test update, or behavior fix. Include the verification method before making edits.

Annotate plan steps with execution tags:

- `[batch-eval]` for grouped inspection, parsing, simulation, or deterministic transforms that would otherwise require several primitive calls.
- `[direct-primitive]` for one precise read, search, edit, or write.
- `[specialized-tool]` for AST search/edit, debugger, browser, GitHub, or other semantic tooling.
- `[delegate]` for bounded research, disjoint edits, or independent verification.

For concrete examples, consult `skill://holmes/references/execution-patterns.md`.

## Delegation Protocol

Use native Task agents; package-local `agents/holmes-researcher.md` and `agents/holmes-verifier.md` are not discovered as Task agent names.

- Research: call Task with `agent: "explore"` and embed the HOLMES researcher contract in the assignment: read-only; no edits, builds, or formatters; bounded factual questions; return answer, file/line facts, consumers, unknowns, and searches.
- Verification: call Task with `agent: "oracle"` and embed the HOLMES verifier contract in the assignment: no edits; verify changed files and acceptance criteria; run only targeted checks the parent permits; report PASS/FAIL/BLOCKED with evidence.

Do not call Task with `agent: "holmes-researcher"` or `agent: "holmes-verifier"` unless those agents are explicitly listed by the Task tool in the current session. In normal extension use, use bundled agents plus the contracts above.

### E — Establish the change

Execute the mapped route with a Layer 4 pattern:

1. **Preflight**: confirm target files, constraints, current state, and verification commands or scenarios.
2. **Read**: load complete relevant sections, not isolated lines; reuse existing conventions.
3. **Transform**: make the minimal coherent change; remove obsolete paths; update all direct consumers.
4. **Verify**: run the targeted checks that prove the acceptance criteria, or perform explicit static verification when commands are unavailable.
5. **Report**: state what changed and the evidence collected.

Keep edits boring. Prefer a clean cutover over parallel implementations. Avoid speculative validation, retries, abstractions, telemetry, or compatibility layers unless they are part of the acceptance criteria.

### S — Synthesize the result

Compare the finished state against the Hone criteria. Report only grounded evidence: files changed, checks run, observed failures, and remaining blockers if any. If verification fails or unexpected state appears, re-enter HOLMES at Observe; do not patch around symptoms.

## Loop Gates

Enter or continue HOLMES while any of these are true:

- Acceptance criteria are ambiguous or not testable.
- The affected files, consumers, or data contracts are not known.
- The root cause has not been proven.
- The edit would require guessing about behavior, ownership, or sequencing.
- The verification strategy is missing or does not cover the changed behavior.
- Tool output contradicts the current model of the system.

Exit to execution only when all are true:

- Done state is concrete and checkable.
- Affected surface area is mapped enough to avoid orphaned callers or dead paths.
- The transform is known and bounded.
- Verification covers the acceptance criteria and the highest-risk branches.
- Any remaining unknown is explicitly irrelevant to the requested deliverable.

Re-enter the loop after any failed check, conflicting evidence, surprising file state, or newly discovered caller.
