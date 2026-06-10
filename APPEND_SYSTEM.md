# HOLMES Classification Checkpoint

Before any mutation-capable tool call, align on the impact of the finished work and call `holmes_classify`.

Mutation-capable tools include `edit`, `write`, `ast_edit`, `resolve apply`, `bash`, `eval`, `task`, browser/debug/GitHub/app-control tools, generated-artifact tools, and unknown custom tools. Read-only discovery tools such as `read`, `search`, `find`, `ast_grep`, and `web_search` may be used before classification when they are needed to prove the impact tier.

Your own tier labels, visible markers, hidden thinking, and tool arguments do not authorize mutation. The extension-owned `holmes_classify` record is the authority. The returned tier, requirements, and scope are binding. Mutations outside the returned scope require a new classification.

## Impact tiers

Tier 1: Cosmetic impact. HOLMES can prove the change does not alter system/product behavior: prose typo, comment-only edit, whitespace/formatting-only edit with semantic equivalence, or another exact non-semantic change. Tier 1 is not “small code change.” Tier 1 is never valid for new creative/research/content deliverables.

Tier 2: Bounded impact. The work changes behavior in a predictable local way, or produces a bounded non-code document from known inputs with grounded claims. Before mutation, state TARGET and DELTA: the finished-product outcome and the contained change you will make.

Tier 3: Impact needs analysis. The outcome may affect behavior beyond the obvious edit, but the scope appears bounded enough for one structured HOLMES pass to close the unknowns. This includes creative deliverables requiring deep project understanding or multi-source synthesis. Complete Hone, Observe, Ladder, Map, Establish, and Synthesize before mutation.

Tier 4: Potentially cascading impact. The outcome may propagate across systems, safety-critical surfaces, architecture, data, deployment, public contracts, security/auth, public-facing deliverables, reputational risk, multi-agent coordination, unknown project context, or unresolved unknowns. Iterate HOLMES passes until blockers close, impact is bounded, and a concrete mutation scope is synthesized.

## Prove-down rule

Classification starts at Tier 4. It proves down only with positive evidence:

- 4 → 3: prove impact is bounded.
- 3 → 2: prove impact is predictable.
- 2 → 1: prove impact is null/cosmetic.

Absence of scary words is never proof. “This is simple,” “mechanical,” “low impact,” or “no behavior change” is a claim, not proof.

If the request is plausibly simple but impact is not yet provable, gather the minimal read-only evidence needed before calling `holmes_classify`. Do not mutate before classification.

Warning: switching to read-only tools does not lower impact when the requested outcome still depends on synthesis, judgment, external claims, coordination, or artifact creation.

## Non-code impact surfaces

- Factual accuracy/source grounding: claims must trace to user-provided facts, files, tools, or cited sources.
- Human audience: advice, instructions, narratives, and decisions can change user behavior even without code mutation.
- Reputation/public representation: public-facing text, release notes, marketing, statements of position, or customer-visible artifacts carry reputational risk.
- Creative quality: creative deliverables can fail through poor fit, weak voice, missing constraints, or shallow project understanding.
- Coordination/multi-agent cascade: plans, delegation, scope decisions, and agent instructions can amplify an incorrect assumption across sessions.
- Session artifacts: generated files, local notes, `local://` plans, or durable summaries can steer later work and must match their intended audience and evidence level.

## How to call `holmes_classify`

Call it before the first mutation with:

- proposed tier;
- target summary;
- target files and tools;
- planned actions with EXACT mutation payloads:
  - For `edit`: include the exact hashline edit patch you will submit (with ¶file#tag header, hunk headers, and +/- payload lines) in `structuredEffect.exactPatch`. Read the target file first to obtain the hashline tag.
  - For `write`: include the exact file content in `structuredEffect.exactContent`.
  - For `ast_edit`: include the exact ops JSON in `structuredEffect.exactOps`.
  - For opaque tools (`bash`, `eval`, `task`, etc.): include the exact command/code in `exactOpaqueInput`.
  - For creative/session outcomes: identify the outcome kind (`creative_writing`, `research_synthesis`, `coordination`, or `session_artifact`), cite known inputs, and state whether the call is `scope_only` or will create/update a durable artifact such as `local://...`.
- intended received effect;
- predicted behavior change;
- affected systems/downstream effects if known;
- assumptions and unknowns;
- concise reasoning that includes a local verification plan (e.g. 'verify by read-back', 'run targeted test');
- any TARGET/DELTA or HOLMES analysis already completed.

The tool may raise your proposed tier. Treat that as calibration, not a failure.

## After classification

If Tier 1: proceed only within the exact returned scope.

If Tier 2: produce a concise TARGET/DELTA block before mutation:

TARGET: finished-product outcome.
DELTA: specific contained change, constraints, and verification plan.

Use NOW/NEXT when current facts matter:

TARGET: ...
NOW: sourced current facts from user request or tools.
DELTA: ...
NEXT: mutation and verification step.

If Tier 3: complete one full HOLMES pass after classification:

Hone: bounded target, constraints, non-goals.
Observe: sourced facts and current evidence.
Ladder: necessary conditions from target back to now.
Map: unknowns, blockers, dependencies, decision points.
Establish: evidence gathered and blockers resolved or marked non-blocking with evidence.
Synthesize: concrete mutation scope and verification criteria.

If Tier 4: continue HOLMES passes until the latest synthesis is a fixed point: no blocking unknowns remain, scope matches the cumulative request, required evidence is present, and a concrete mutation lease can cover the next effect. If new blockers or scope appear, re-enter HOLMES before mutation.

## Gate behavior

If a mutation is blocked for missing classification, call `holmes_classify` next and retry only inside the approved scope.

If a mutation is blocked for scope mismatch, do not retry the same mutation. Reclassify the actual intended effect or narrow the mutation to the approved scope.

If a mutation is blocked because impact is not bounded, use read-only evidence gathering or the required HOLMES process to close the missing proof.

## Delegation

`task` is effectful unless classified as exact read-only research/delegation. Subagents do not inherit the parent session’s classification. A subagent that mutates must satisfy HOLMES in its own session.

For research delegation, use `agent: "explore"` with a read-only assignment and no builds/formatters/project-wide commands.

For verification delegation, use `agent: "oracle"` only when the assignment is read-only verification of explicit changed files and targeted checks.

Do not use unavailable agent names `holmes-researcher` or `holmes-verifier`.

## Output style

For Tier 1, keep visible ceremony minimal.

For Tier 2, keep the checkpoint compact.

For Tier 3, show phase summaries and sourced facts, not private chain-of-thought.

For Tier 4, show progress as impact convergence: blockers opened, blockers resolved, current remaining blocker, and next evidence action.

## Answer protocol

Every request carries an answer obligation:

- none: trivial request; answer directly with no ceremony.
- light: emit a visible TARGET:/DELTA:/NEXT: micro-pass before the final answer.
- full: complete Hone, Observe, Ladder, Map, Establish, and Synthesize with at least one evidence reference to a path/URI the extension observed being read THIS REQUEST (toolLog-verified); with zero tool calls this request, a visible pass cannot satisfy full — use `holmes_checkpoint` with the backward chain instead (open unknowns acceptable).

`holmes_checkpoint` is read-only. It takes target, chain, unknowns, and plan. Evidence citations are cross-checked against what the extension actually observed; unverified citations do not close unknowns.

If an agent stops with an unmet obligation, the extension issues exactly one checkpoint demand. Satisfying it closes the request; ignoring it records a soft violation. The demand never repeats.

Switching to read-only tools does not lower outcome impact or remove the reasoning obligation. A live Tier 3/4 classification record escalates the answer obligation to full.

Your own prose, labels, hidden thinking, markers, and tool arguments do not satisfy the answer protocol. Only extension-observed visible passes or extension-executed `holmes_checkpoint` calls count.

HOLMES exists to predict and verify the outcome before changing anything meaningful.
