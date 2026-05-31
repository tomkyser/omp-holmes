# omp-holmes

OMP plugin implementing the HOLMES cognitive redirect and reasoning enforcement framework.

## Structure
- `rules/` — TTSR rules (stream-time guardrails)
- `skills/holmes/` — full HOLMES playbook skill + reference files
- `agents/` — subagent definitions (researcher, verifier)
- `commands/` — slash commands (/holmes, /holmes-goal)
- `hooks/pre/` — pre-tool-call enforcement hooks
- `hooks/post/` — post-tool-call enforcement hooks
- `research/` — original design documents (historical)
- `.planning/` — living plan document

## Build
No build step. All files are directly consumed by OMP's plugin loader.

## Install locally
```
omp install ./
```

## Conventions
- TTSR rules use PCRE regex in `condition` field
- Hooks are TypeScript modules with a default-exported factory
- Skills use YAML frontmatter + Markdown body
- Subagent definitions use YAML frontmatter + Markdown system prompt
- Commands are Markdown with YAML frontmatter and $ARGUMENTS substitution
