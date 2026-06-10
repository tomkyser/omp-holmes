# omp-holmes

OMP extension implementing HOLMES: cognitive enforcement of backward reasoning via a four-tier prove-down classification gate.

## Structure
- `src/` — runtime extension: `main.ts` factory entry; `classification.ts` prove-down engine (floors, certificates, prosecutor, leases, ledger, `holmes_classify`); `observation.ts` bounded visible-text observation; `guards.ts` tool-call gates; `prompts.ts` system prompt + command builders; `types.ts` shared types; `main.test.ts` unit suite
- `rules/` — TTSR rules; conditions are JavaScript `new RegExp`-compatible regex, not PCRE
- `skills/holmes/` — full HOLMES playbook skill + reference files
- `agents/` — retained source contract text for Task `explore`/`oracle` delegation; NOT runtime-discovered agent names
- `commands/` — slash-command assets (`/holmes`, `/holmes-goal`; `/holmes-status` is registered in code)
- `research/` — historical RALPH design docs
- `.planning/`, `.omp/` — gitignored, local-only

## Build
No build step. OMP loads `./src/main.ts` via `package.json` `omp.extensions`.

- `bun test src/main.test.ts` — unit suite
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
- The model never authorizes mutation: only the extension-owned `holmes_classify` record does; keep that invariant when editing gates or prompts
- `APPEND_SYSTEM.md` is the source copy of `HOLMES_SYSTEM_PROMPT` in `src/prompts.ts`; keep them in sync
