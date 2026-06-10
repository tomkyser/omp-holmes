# omp-holmes

OMP extension implementing HOLMES: extension-owned four-tier mutation classification plus per-request answer obligations. Conceptual deep-dive: [FRAMEWORK.md](FRAMEWORK.md).

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
Use the extension root:
```sh
omp --extension ./
```

Or configure `.omp/settings.json`:
```json
{"extensions": ["./"], "ttsr": {"repeatMode": "afterGap", "repeatGap": 3}}
```

## Conventions
- Skills use YAML frontmatter + Markdown body
- Commands are Markdown with YAML frontmatter and `$ARGUMENTS` substitution
- Model proposes, extension disposes: the model never authorizes mutation; only the extension-owned `holmes_classify` record does
- The model never clears answer obligations; `AnswerGateState` clears only through extension-observed facts: a required-level visible pass at/after `createdAtSequence`, or an extension-executed `holmes_checkpoint` with tool-log-checked evidence/closure citations
- Answer state is per `requestDigest`, never ledgered; terminal `soft_accept` is absorbing, and `MAX_ANSWER_RETRIES = 1` means worst case is one extra `nextTurn` checkpoint demand
- The reasoning grader is strictly upward-only and failure-inert: it can add `chain`/`closure`/`plan` repair obligations/advisories, but failed or skipped grader output maps to no authority
- Config uses `registerFlag`/`getFlag`: `holmes-grade-mutation-passes` → `gradeMutationPasses`, `holmes-grader-timeout-ms` → `graderTimeoutMs`; `gradeMutationPasses` default-off equivalence is test-pinned
- `APPEND_SYSTEM.md` is the source copy of `HOLMES_SYSTEM_PROMPT` in `src/prompts.ts`; keep them in sync
