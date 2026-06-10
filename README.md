# omp-holmes

HOLMES is a **cognitive enforcement** system for [OMP](https://omp.sh) — not a guidance system. Prompts that *ask* a model to reason carefully are advisory; the model can ignore them. HOLMES instead makes the agent runtime refuse to execute mutations that were never properly reasoned about. It forces backward reasoning from the desired end state and mechanically counters two built-in model tendencies:

- **Forward-chaining**: anchoring on the first plausible step, editing immediately, and discovering the important unknowns mid-execution.
- **Laziness**: shallow exploration, hand-waved impact claims, and skipped verification.

It ships as a local OMP extension package: `package.json` declares `omp.extensions`, and `src/main.ts` is the runtime entry point that wires every enforcement surface.

## The cognitive model

### Layer 0: the redirect

Layer 0 runs every turn and is the always-on habit the rest of the system enforces:

| Step | Meaning |
|------|---------|
| **HALT** | Stop before planning or effectful tools. |
| **ENVISION** | Define concrete, verifiable "done". |
| **LOCATE** | Separate KNOWN facts from ASSUMED beliefs and UNKNOWN gaps. |
| **DELTA** | List required changes and evidence gaps. |
| **CLASSIFY** | Call the extension-owned `holmes_classify` tool; its returned tier, requirements, and scope are authoritative. |

### The HOLMES loop

For non-trivial work (Tier 3 and above), classification requires the full inner loop:

| Phase | Meaning |
|-------|---------|
| **H**one | Pin the TARGET: what must be true when the work is complete — outcomes, constraints, non-goals, acceptance criteria. |
| **O**bserve | Ground the NOW: sourced facts with provenance (file, symbol, line range), not inferences from naming. |
| **L**adder | Reason backward from target to now: the necessary conditions, in dependency order, each rung closing one uncertainty. |
| **M**ap | Surface the VARIABLES: unknowns, blockers, decision points, and the execution route with verification built in. |
| **E**stablish | Close the gaps with evidence — or re-enter the loop when new blockers, conflicting evidence, or surprising state appear. |
| **S**ynthesize | Produce the concrete mutation scope and verification criteria that classification will bind to. |

Tier 4 work iterates the loop until the latest synthesis is a fixed point: no blocking unknowns, scope matching the cumulative request, evidence present, and a concrete mutation lease able to cover the next effect.

## Trust architecture: the model proposes, the extension disposes

Nothing the model *says* grants authority. Visible `[CLASSIFY: Tier N]` markers, hidden thinking, code comments, and tool-call arguments never authorize anything — they are untrusted claims. The single mutation authority is the extension-owned `holmes_classify` tool: its execution happens inside trusted extension code, its record is what the runtime gate checks, and its returned tier, requirements, and scope are binding. Mutations outside the returned scope require a new classification.

## The four-tier prove-down impact model

HOLMES classifies the *impact of the finished work*, not the size of the request:

| Tier | Impact |
|------|--------|
| **Tier 4** | Potential cascading or unresolved impact — cross-system propagation, safety/security surfaces, public contracts, data, deployment, multi-agent coordination, or unresolved unknowns. |
| **Tier 3** | Bounded, but still needs HOLMES analysis — one full loop pass to close the unknowns. |
| **Tier 2** | Predictable local behavior change — TARGET/DELTA before mutation is enough. |
| **Tier 1** | Cosmetic / no behavior change — provably non-semantic. Never valid for new creative or research deliverables. |

Classification **starts at the highest plausible tier and steps down only on positive evidence**: 4→3 prove the impact is bounded, 3→2 prove it is predictable, 2→1 prove it is null/cosmetic. "This is simple", "mechanical", and "low impact" are claims, not proof; the absence of scary words is never proof.

## The three-layer adjudication pipeline

Each `holmes_classify` call runs through three layers with strictly separated authority:

### Layer 1 — objective impact floors

Hard minimum tiers derived **only from extension-observed facts**: file path roles (source vs test vs config vs docs vs agent-guardrail vs sensitive surfaces), tool classes (structured vs opaque), and the cumulative ledger state. Floors cannot be overridden by anything the model claims. A floor at Tier 3 means the result can never be lower than Tier 3, regardless of arguments.

### Layer 2 — evidence certificates

The **only authority that can lower a tier**. Certificates are computed by the extension itself from the exact planned payloads (the `exactPatch` / `exactContent` the model pre-committed) diffed against the extension's own snapshot of the target files. Examples: blank-line-only, comment-only, docs-prose-only, whitespace-only, AST-equivalent, exports-unchanged, references-bounded, session-scoped-only. Because the extension computes them from real bytes, they are proof — not narrative.

### Layer 3 — the risk prosecutor

An LLM reviewer whose authority is **strictly upward-only**: it can raise concern (add floors, surface proof obligations), never grant safety or lower a tier. It is fed a quarantined packet in which all model-originated text is explicitly labeled as untrusted claims, so a persuasive self-assessment cannot launder itself into authority. If the prosecutor times out or errors, the deterministic result stands.

The shape of the pipeline is the point: facts set the floor, mechanical proof is the only way down, and judgment can only push up.

## Mutation leases

Passing classification does not yield a binary "approved" flag. It yields a **lease**: authority scoped to specific tools + paths + effect fingerprint + a mutation budget. Each allowed mutation consumes budget; exhausted, drifted, or expired leases evaporate.

Exact-payload pre-commitment is **mechanized ENVISION**. To classify an `edit`, the model supplies the exact patch it will submit (`structuredEffect.exactPatch`); for `write`, the exact content (`exactContent`); for `ast_edit`, the exact ops; for opaque tools (`bash`, `eval`, `task`), the exact command or code (`exactOpaqueInput`). The model must know *precisely* what it intends before authority exists. When the actual tool call deviates from the pre-committed payload — an improvised "small extra fix" — the effect fingerprint no longer matches and the authority evaporates. Sloppy envisioning becomes a concrete, felt cost.

## The cumulative request ledger

Every user request gets a ledger that accumulates classifications, blocked effects, scoped floors, and verification outcomes across the whole request. This kills two evasion patterns:

- **Tool-shopping**: getting blocked on `edit` and retrying the same effect through `bash` — the ledger remembers the blocked effect.
- **Classification re-rolls**: re-calling `holmes_classify` with rosier prose until the tier drops — prior floors persist in the ledger and apply to overlapping scope.

**Verification failures floor the scope at Tier 4.** When a verification-capable tool fails against paths in scope, the ledger records an unresolved failure and every subsequent classification overlapping those paths is floored at Tier 4. The only exit is an **extension-observed** successful verification covering the failed paths — a real passing tool result, not a claim that things are fine now. Fail-closed, but always with a provable exit.

## Enforcement surfaces

| Surface | Behavior |
|---------|----------|
| System prompt | The HOLMES classification checkpoint is appended on every agent start (`APPEND_SYSTEM.md` is the source copy). |
| TTSR rules (8) | Stream-time rules that abort generation mid-stream when the text shows a failure pattern forming. |
| Skill | `skills/holmes/SKILL.md` — the full HOLMES playbook for on-demand reference. |
| Commands (3) | `/holmes`, `/holmes-goal`, `/holmes-status`. |
| Tool-call gates | Runtime `tool_call` interception, in order: primitive-burst → delegation → classification. |
| Tool-result modifiers | Verification reminders appended after mutating edit/write/apply-style results; verification outcomes feed the ledger. |

### Stream-time rules (TTSR)

`rules/RULES.md` is the always-apply compact Layer 0 redirect. Seven conditional rules abort generation mid-stream when their pattern fires:

- `forward-chain-guard.md` — direct mutation plans before END/DELTA evidence (forward-chaining intent)
- `assumption-guard.md` — assumptions being converted into action
- `batch-primitive-prose.md` / `batch-primitive-numbered.md` — prose or numbered plans chaining primitive discovery calls
- `edit-without-verify.md` — edit plans that omit a verification step
- `eval-mutation-intent.md` — attempts to use `eval` as a mutation-gate bypass
- `eval-mutation-code.md` — filesystem-mutation code inside eval cells

Recommended TTSR settings: `repeatMode: "afterGap"` with `repeatGap: 3`, so rules re-arm after short gaps instead of firing once per session.

### Runtime gates

On every `tool_call`, in order:

1. **Primitive burst** — blocks chains of one-off discovery primitives that should be a single batched lookup (URL/resource reads and post-mutation verification reads are exempt).
2. **Delegation** — blocks invalid HOLMES Task delegation (wrong agent names, non-read-only research assignments).
3. **Classification** — checks the pending effect against the active lease: covered tool, covered paths, matching effect fingerprint, remaining budget, freshness. Missing classification, scope mismatch, and unbounded impact each get distinct block messages with a safe next action.

### Commands

| Command | Purpose |
|---------|---------|
| `/holmes <task>` | Run Layer 0 and the full HOLMES loop on a task before acting. |
| `/holmes-goal <intent>` | Convert raw intent into a HOLMES-informed `/goal` objective. |
| `/holmes-status` | Show registered surfaces, classification state, and runtime counters. |

## Delegation protocol

HOLMES delegation uses **bundled OMP Task agents** with the HOLMES contracts embedded in the assignment text:

- **Research** (Tier 3 factual unknowns): Task with `agent: "explore"`, assignment embedding the researcher contract — read-only, no edits/builds/formatters, bounded factual questions, file/line evidence.
- **Verification** (Tier 2/3 review): Task with `agent: "oracle"`, assignment embedding the verifier contract — no edits, explicit changed files and acceptance criteria, targeted checks only, PASS/FAIL/BLOCKED with evidence.

`holmes-researcher` and `holmes-verifier` are **not valid agent names** and the runtime blocks calls that use them. The `agents/*.md` files are retained as source contract text only.

Subagents do not inherit the parent session's classification: a subagent that mutates must satisfy HOLMES in its own session.

## Design philosophy

- **Enforce what you can verify, advise what you cannot.** Path roles, exact payloads, tool results, and ledger state are extension-observable, so they are enforced. Reasoning quality is not directly observable, so it is shaped through prompts, rules, and the skill — and through the consequences below.
- **Consequences, not nagging.** Bad reasoning is not met with lectures; it becomes effect mismatches, evaporated leases, gate blocks, and Tier 4 verification floors. Sloppiness costs authority, which is the one currency an agent actually optimizes.
- **Tier 1 stays ceremony-free by design.** A provably cosmetic change proceeds with minimal visible ceremony inside its exact scope. The system is heavy exactly where impact is heavy.

## Install and local use

Use the package root, not the TypeScript file, so OMP discovers the package-local rules, skill, and commands:

```sh
# From this checkout
omp --extension ./
```

Or configure the project with `.omp/settings.json`:

```json
{
  "extensions": ["./"],
  "ttsr": {
    "repeatMode": "afterGap",
    "repeatGap": 3
  }
}
```

Development:

```sh
bun install
bun test src/main.test.ts   # unit suite
bun run check               # typecheck
```

There is no build step; OMP loads `./src/main.ts` directly via `package.json`'s `omp.extensions`. Marketplace publishing is out of scope.

## Architecture

| Path | Responsibility |
|------|----------------|
| `src/main.ts` | Extension factory entry: registers the tool, commands, lifecycle handlers, observation, gates, and result modifiers. |
| `src/classification.ts` | Deterministic prove-down engine: objective floors, evidence certificates, risk prosecutor, mutation leases, cumulative ledger; registers `holmes_classify`. |
| `src/observation.ts` | Bounded visible-text observation from message events; HOLMES evidence detection. |
| `src/guards.ts` | Tool-call gates: primitive burst, delegation, and classification gate dispatch. |
| `src/prompts.ts` | `HOLMES_SYSTEM_PROMPT`, command prompt builders, verification reminder. |
| `src/types.ts` | Shared state and type definitions. |
| `rules/` | TTSR rule assets (always-apply `RULES.md` + 7 conditional rules). |
| `skills/holmes/` | The HOLMES playbook skill and reference files. |
| `commands/` | Slash-command assets. |
| `agents/` | Retained source contract text for delegation (not runtime agent names). |
| `APPEND_SYSTEM.md` | Source copy of the system-prompt appendage. |

## Background

HOLMES applies abductive reasoning: work backward from the desired end state to determine what must be true, rather than forward-chaining from the first plausible step. The framework was originally prototyped as RALPH for Claude Code (see `research/`), then redesigned for OMP's extension surface. The core insight: classify the gap, not the request — complexity lives in the delta between current state and desired end state, not in the words of the ask.

## License

MIT
