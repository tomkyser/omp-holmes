# omp-holmes

OMP extension implementing the HOLMES cognitive redirect and reasoning enforcement framework.

## Structure
- `src/` — runtime extension: `main.ts` factory entry, classification engine, observation, guards, prompts, types, and `main.test.ts` unit suite
- `rules/` — TTSR rules; conditions are JavaScript `new RegExp`-compatible regex, not PCRE
- `skills/holmes/` — full HOLMES playbook skill + reference files
- `agents/` — source contract text for Task `explore`/`oracle` delegation; not native agent names
- `commands/` — slash-command assets (`/holmes`, `/holmes-goal`)
- `research/` — historical RALPH design docs
- `.planning/` — living plan, reviews, and test reports

## Build
No build step. OMP loads `./src/main.ts` via `package.json` `omp.extensions`.

`bun test src/main.test.ts` runs the unit suite; `bun run check` typechecks.

## Use locally
Use the extension root:
```sh
omp --extension ./
```

Or configure `.omp/settings.json`:
```json
{"extensions": ["./"]}
```

## Conventions
- Skills use YAML frontmatter + Markdown body
- Commands are Markdown with YAML frontmatter and `$ARGUMENTS` substitution
- Package-local `agents/*.md` files are retained source contracts for bundled Task agents, not runtime-discovered agent names
