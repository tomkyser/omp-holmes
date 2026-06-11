# omp-holmes

OMP extension implementing HOLMES: extension-owned four-tier mutation classification plus per-request answer obligations. Conceptual deep-dive: [FRAMEWORK.md](FRAMEWORK.md).

## Objective

HOLMES is a reasoning framework first. The enforcement machinery exists to produce a cognitive shift in the agent, not to police for its own sake. Every change should serve one of two coupled pillars:

1. Cognitive reframe — the agent extrapolates the objective desired effect of a request (inferred intent, not request text) and reasons END → NOW until the unknowns are named. Abduction is the method; forward-chaining and satisficing are the failure modes it displaces.
2. Composed execution — the agent favors designed, consolidated operations (one program in the sandbox, blocks of one-shot operations) over chains of primitive read/search/edit calls, the way a person who has reasoned scripts the solution instead of taking a thousand blind actions.

The pillars are coupled: consolidation is the observable signature of having reasoned. A program requires its variables named before it can be written, so a long primitive chain is what forward-chaining looks like in telemetry, and a composed one-shot is what a closed unknown map looks like. Tool-call count is a proxy metric for reasoning quality. The Claude Code-era RALPH prototype cut tool calls roughly 90% across all task types, including non-code work; making that reduction real and measurable in this binding is the success criterion.

Status against the pillars: pillar one is enforced (redirect, prove-down classification, universal answer obligations, reasoning grader). Pillar two has only its negative rail today (primitive-burst guard; eval gated as a mutation-bypass threat). The open front is the affirmative half: doctrine that teaches composed discovery/compute as the favored mode, provenance so consolidated operations stay extension-observable, and efficiency telemetry in `HolmesStats`.

Ceilings to respect: intent fidelity is not runtime-observable, so anything grading it stays advisory-first and bounded, never a hard gate; the extension counter-steers the harness's tool-pushing rails but cannot remove them; the frictionless floor and the bounded-coercion invariants (FRAMEWORK.md §4g) outrank any new enforcement idea.

## Structure
- `src/` — runtime extension:
  - `main.ts` factory entry; registers `/holmes`, `/holmes-goal`, `/holmes-status`, `holmes_classify`, `holmes_checkpoint`, and config flags
  - `classification.ts` prove-down engine (floors, certificates, prosecutor, leases, ledger, `holmes_classify`)
  - `answer.ts` answer-obligation gate (triage, escalation, state machine, `holmes_checkpoint` executor)
  - `grader.ts` extension-owned reasoning grader cloned from the risk-prosecutor pattern; grades `chain`/`closure`/`plan`
  - `observation.ts`, `guards.ts`, `prompts.ts`, `types.ts` support observation, tool-call gates, prompts, and shared types
  - Tests: `main.test.ts`, `answer.test.ts`, `grader.test.ts`
- `rules/` — TTSR rules; conditions are JavaScript `new RegExp`-compatible regex, not PCRE
- `skills/holmes/` — full HOLMES playbook skill + reference files
- `agents/` — retained source contract text for Task `explore`/`oracle` delegation; NOT runtime-discovered agent names
- `commands/` — slash-command assets (`/holmes`, `/holmes-goal`; `/holmes-status` is registered in code)
- `research/` — historical RALPH design docs
- `.planning/`, `.omp/` — gitignored, local-only

## Build
No build step. OMP loads `./src/main.ts` via `package.json` `omp.extensions`.

- `bun run test` — same as `bun test src/`; runs `src/main.test.ts`, `src/answer.test.ts`, `src/grader.test.ts`
- `bun test src/main.test.ts` — targeted unit suite
- `bun run check` — typecheck (`tsc --noEmit`)

## Use locally
Never enable the extension for this repository itself (no `extensions` entry in the local gitignored `.omp/settings.json`): HOLMES gates tool calls, and a gate broken mid-development can block the edits needed to fix it. Opt in per session when testing live:
```sh
omp --extension ./
```
For project-level or global enablement, see "Enabling it" in README.md (project `.omp/settings.json` or `~/.omp/agent/config.yml`, pointing at the package root).

## Conventions
- Skills use YAML frontmatter + Markdown body
- Commands are Markdown with YAML frontmatter and `$ARGUMENTS` substitution
- Model proposes, extension disposes: the model never authorizes mutation; only the extension-owned `holmes_classify` record does
- The model never clears answer obligations; `AnswerGateState` clears only through extension-observed facts: a required-level visible pass at/after `createdAtSequence`, or an extension-executed `holmes_checkpoint` with tool-log-checked evidence/closure citations
- Answer state is per `requestDigest`, never ledgered; terminal `soft_accept` is absorbing, and `MAX_ANSWER_RETRIES = 1` means worst case is one extra `nextTurn` checkpoint demand
- The reasoning grader is strictly upward-only and failure-inert: it can add `chain`/`closure`/`plan` repair obligations/advisories, but failed or skipped grader output maps to no authority
- Config uses `registerFlag`/`getFlag`: `holmes-grade-mutation-passes` → `gradeMutationPasses`, `holmes-grader-timeout-ms` → `graderTimeoutMs`; `gradeMutationPasses` default-off equivalence is test-pinned
- `APPEND_SYSTEM.md` is the source copy of `HOLMES_SYSTEM_PROMPT` in `src/prompts.ts`; keep them in sync
