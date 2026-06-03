test
# omp-holmes

HOLMES is a cognitive redirect and reasoning enforcement package for [OMP](https://omp.sh). It is a local OMP extension package: `package.json` declares `omp.extensions`, and `src/main.ts` is the runtime entry point that wires the extension surfaces.

HOLMES forces backward reasoning from the desired end state before acting. It prevents forward-chaining failures where the agent anchors on the first plausible step, starts editing, and only discovers the important unknowns mid-execution.

## Local use

Use the package root, not the TypeScript file, so OMP loads the runtime entry point and discovers package-local rules, skills, and commands:

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

`repeatMode: "afterGap"` with `repeatGap: 3` keeps stream-time rules available after short gaps instead of firing only once per session.

Publishing and marketplace installation are intentionally out of scope for this branch of work.

In OMP 15.2.1, `/extensions` is an interactive TUI command. `omp -p "/extensions"` is not a reliable check because print mode sends it to the model instead of opening the dashboard.

## Runtime architecture

The runtime code is split into focused modules:

| Module | Responsibility |
|--------|----------------|
| `src/main.ts` | Extension factory; imports the modules below, registers commands, lifecycle handlers, message observation, tool gates, and result modifiers; exports `default function holmes(pi)` |
| `src/types.ts` | Shared state interfaces and OMP event-related type definitions |
| `src/observation.ts` | Bounded visible-text observation from `message_update` and `message_end`; HOLMES evidence detection and accumulation |
| `src/guards.ts` | Pure guard decisions for visible reasoning evidence, primitive exploration bursts, and Task delegation |
| `src/prompts.ts` | `HOLMES_SYSTEM_PROMPT`, command prompt builders, visible marker instructions, and delegation protocol text |

`package.json` points OMP at `./src/main.ts`:

```json
{
  "omp": {
    "extensions": ["./src/main.ts"]
  }
}
```

## Active extension surface

| Surface | Active behavior |
|---------|-----------------|
| System prompt | Appends HOLMES Layer 0, Tier 2/3 inner loop, tool-call discipline, visible marker requirements, and delegation protocol on `before_agent_start` |
| TTSR rules (`rules/`, 7 files) | Package-root discovery activates the rule surface: seven rule files are discovered; the conditional TTSR rules interrupt forward-chaining, assumption-to-action leaps, primitive batching, unverified edit plans, and eval-bypass intent; `RULES.md` is the always-apply compact redirect |
| Skill | `skills/holmes/SKILL.md` remains the full HOLMES playbook for on-demand reference |
| Commands (3) | `/holmes`, `/holmes-goal`, and `/holmes-status` |
| Message observation | `message_update` and `message_end` accumulate bounded visible assistant text and detect HOLMES evidence before tools run |
| Tool call gates | `tool_call` blocks mutating tools without visible classification, primitive exploration bursts, invalid HOLMES Task delegation, and shell/file primitive misuse |
| Tool result modifiers | `tool_result` appends verification reminders after mutating edit/write/apply-style results |

## Visible classification marker protocol

Before any mutating tool call, the assistant must emit a visible marker:

```text
[CLASSIFY: Tier N]
```

Use `Tier 1`, `Tier 2`, or `Tier 3` according to the HOLMES gap classification. Hidden thinking, tool-call arguments, and private chain-of-thought do not satisfy the gate; the marker must appear in visible assistant text before mutation. Tier 2/3 turns should also include the HOLMES reasoning packet needed to justify action.

The mutating surface includes file edits and apply-style operations such as `edit`, `write`, `ast_edit`, `resolve`, and shell commands that can mutate state.

## Delegation protocol

HOLMES delegation uses bundled OMP Task agents rather than package-local `agents/` discovery:

- Tier 3 factual unknowns: call Task with `agent: "explore"` and include the HOLMES researcher contract in the assignment: read-only, no edits, no builds or formatters, bounded questions, and file/line evidence.
- Tier 2/3 verification or senior review: call Task with `agent: "oracle"` and include the HOLMES verifier contract: no edits, changed files and acceptance criteria, targeted checks only, and PASS/FAIL/BLOCKED evidence.

The package-local `agents/` files are retained as source contract text. They are not treated as native Task agent names by the extension runtime.

## TTSR rules and eval-bypass protection

The `rules/` directory is active when the package root is loaded with `omp --extension ./` or `"extensions": ["./"]`. Seven rule files are discovered; the rule conditions use JavaScript/Bun-compatible `new RegExp(...)` syntax.

Active rule files:

- `RULES.md` — always-apply compact HOLMES redirect
- `forward-chain-guard.md` — blocks direct mutation plans before END/DELTA evidence
- `assumption-guard.md` — blocks assumptions being converted into action
- `batch-primitive-prose.md` — blocks prose plans that chain primitive discovery calls
- `batch-primitive-numbered.md` — blocks numbered primitive discovery chains
- `edit-without-verify.md` — blocks edit plans that omit verification
- `eval-mutation-intent.md` — blocks attempts to use `eval` as a mutation-gate bypass

`eval` remains appropriate for batched read-only discovery. Filesystem mutation must go through the normal mutating tools after the visible classification marker is emitted.

## Commands

| Command | Purpose |
|---------|---------|
| `/holmes <task>` | Ask the agent to run Layer 0 redirect and the full HOLMES loop before acting |
| `/holmes-goal <intent>` | Convert a raw intent into a HOLMES-informed `/goal` objective |
| `/holmes-status` | Show registered HOLMES surfaces and runtime counters |

## Tool call discipline

HOLMES enforces a simple rule: architect exploration as scripts. For multi-step file discovery or investigation, batch work inside `eval()` with a small JS/Python plan returning only the facts needed for the next decision.

Direct primitives (`read`, `search`, `find`) are reserved for:

- one-shot lookups of a specific file or symbol
- hashline anchor capture immediately before an edit
- post-edit verification reads

The runtime gate blocks primitive exploration bursts while exempting URL/resource reads and verification reads immediately after mutating tools.

## File structure

```text
omp-holmes/
  package.json                              # Extension manifest: omp.extensions -> ./src/main.ts
  src/
    main.ts                                 # Entry point factory and event wiring
    types.ts                                # Shared state and type definitions
    observation.ts                          # Message text observation and evidence detection
    guards.ts                               # Pure reasoning, primitive burst, and delegation guards
    prompts.ts                              # System prompt and command prompt builders
  APPEND_SYSTEM.md                          # Source copy of the HOLMES system-prompt appendage
  skills/
    holmes/
      SKILL.md                              # Full HOLMES playbook
      references/
        execution-patterns.md               # Concrete eval/preflight/verify examples
  commands/
    holmes.md                               # Package slash-command asset
    holmes-goal.md                          # Package slash-command asset
  hooks/
    pre/
      tool-discipline.ts                    # Legacy/source hook asset; runtime gate is in src/
      reasoning-guard.ts                    # Legacy/source hook asset; runtime gate is in src/
    post/
      verify-reminder.ts                    # Legacy/source hook asset; runtime modifier is in src/
  rules/
    RULES.md                                # Always-apply compact redirect
    forward-chain-guard.md                  # Active rule asset
    assumption-guard.md                     # Active rule asset
    batch-primitive-prose.md                # Active rule asset
    batch-primitive-numbered.md             # Active rule asset
    edit-without-verify.md                  # Active rule asset
    eval-mutation-intent.md                 # Active rule asset
  agents/
    holmes-researcher.md                    # Source contract text for bundled Task/explore delegation
    holmes-verifier.md                      # Source contract text for bundled Task/oracle verification
```

## Background

HOLMES is based on applied abductive reasoning: work backward from the desired end state to determine what must be true, rather than forward-chaining from the first plausible step. The framework was originally prototyped as RALPH for Claude Code, then redesigned for OMP's extension surface.

The core insight: classify the gap, not the request. Complexity lives in the delta between current state and desired end state, not in the words of the request.

## License

MIT

