# Gap 3 — TTSR rules defined but not active

## Verdict

The path-fix theory is correct but incomplete.

Required fix set:

1. Change `.omp/settings.json` from the file entrypoint to the package root:

```json
{
  "extensions": [
    "./"
  ]
}
```

2. Keep `package.json` as-is:

```json
"omp": {
  "extensions": ["./src/main.ts"]
}
```

3. Rewrite all five rule `condition` regexes to JavaScript/Bun-compatible syntax. OMP compiles TTSR conditions with `new RegExp(pattern)`. The current rules use PCRE-style `(?is)` prefixes, so all five currently fail to compile even after discovery is fixed. `forward-chain-guard.md` also uses `\A`, which is not a JavaScript start-of-input anchor.

So: `.omp/settings.json` to `./` makes `rules/` discoverable; regex rewrites make the rules register with TTSR.

## 1. Path fix theory

Confirmed in OMP source:

- `src/discovery/omp-extension-roots.ts` reads project and user settings via `readSettingsExtensions(path.join(project, "settings.json"))` and `readSettingsExtensions(path.join(user, "settings.json"))`.
- `readSettingsExtensions()` returns string entries from the `extensions` array only.
- Relative paths are resolved with `path.resolve(ctx.cwd, raw)`.
- `listOmpExtensionRoots()` builds candidates from CLI roots, project settings, user settings, and installed plugins.
- It filters all candidates through `isDirectory()` and only pushes entries whose resolved path is a directory.

Implication for this package:

- Current `.omp/settings.json`: `"./src/main.ts"` resolves to a file, so it is filtered out and contributes zero sub-discovery surface.
- Proposed `.omp/settings.json`: `"./"` resolves to `/Users/tom.kyser/dev/reasoner`, which is a directory and contains `rules/`, `skills/`, `commands/`, and `hooks/`; it will pass through as an `OmpExtensionRoot`.

## 2. Sub-discovery after `./`

Confirmed in `src/discovery/omp-plugins.ts`:

- `loadSkills()` calls `listOmpExtensionRoots(ctx)` and scans `path.join(root.path, "skills")`.
- `loadSlashCommands()` scans `path.join(root.path, "commands")` for `*.md`.
- `loadRules()` scans `path.join(root.path, "rules")` for `*.md` and `*.mdc` and transforms each file with `buildRuleFromMarkdown(...)`.
- The same provider also wires package `hooks/`, `tools/`, `prompts/`, and `.mcp.json`.

With `root.path === /Users/tom.kyser/dev/reasoner`, OMP will walk:

- `/Users/tom.kyser/dev/reasoner/rules/*.md`
- `/Users/tom.kyser/dev/reasoner/skills/**`
- `/Users/tom.kyser/dev/reasoner/commands/*.md`
- plus hooks/tools/prompts/MCP if present

This path does not discover `agents/`; agent discovery is a separate Gap 4 concern.

## 3. TTSR rule format and runtime behavior

Confirmed in `src/capability/rule.ts`, `src/discovery/helpers.ts`, `src/export/ttsr.ts`, and `src/session/agent-session.ts`:

- `buildRuleFromMarkdown()` parses YAML frontmatter, strips it from body content, and calls `parseRuleConditionAndScope()`.
- `condition` accepts a string or string array. It is not CSV-split, which is correct for regex patterns containing commas.
- `scope` accepts a string or string array. A string like `text, thinking` is split into `['text', 'thinking']`.
- TTSR compiles each condition with `new RegExp(pattern)`. No separate flags argument is used.
- Invalid regexes are logged and skipped. If a rule has zero successfully compiled conditions, `TtsrManager.addRule()` returns `false`; the rule is not active as TTSR.
- Runtime matching happens on `message_update` events:
  - `text_delta` => source `text`
  - `thinking_delta` => source `thinking`
  - `toolcall_delta` => source `tool`
- TTSR buffers deltas per stream and tests the whole buffer against each compiled regex.
- If a matching rule should interrupt, OMP aborts the stream, injects the rule body as a hidden `ttsr-injection` custom message, marks the rule injected, and retries the agent turn.
- Existing rules set `scope: text, thinking`, so they intentionally do not match tool-call argument deltas. They catch prose/thinking forward-chaining, not silent direct tool calls.

Default runtime caveat: `TtsrManager` defaults `repeatMode` to `once`; unless settings override it, each TTSR rule can interrupt only once per session/manager state.

## 4. `package.json` `omp.extensions` vs settings `extensions`

No conflict found.

There are two related mechanisms:

1. Settings `extensions` is the configured path list. It is used both by extension loading and by package sub-discovery root detection.
2. `package.json` `omp.extensions` is used when a configured path is a directory; it resolves the actual extension module entrypoint(s) inside that directory.

For `settings.extensions = ["./"]`:

- `discoverAndLoadExtensions()` receives `"./"` as a configured path.
- It stats the resolved path, sees a directory, and calls `resolveExtensionEntries(resolved)`.
- `resolveExtensionEntries()` reads `<root>/package.json`, finds `omp.extensions`, and resolves `./src/main.ts`.
- The extension factory still loads from `src/main.ts`.

Double-load risk is low:

- `discoverAndLoadExtensions()` dedupes loaded paths by resolved absolute path.
- If both CLI `--extension ./` and settings `"./"` are present, both resolve to the same package entrypoint and dedupe.
- The native capability discovery path for settings directories does not appear to load the root package manifest for `./`, so it should not add a second `src/main.ts` entry before the explicit configured path does.

## 5. Existing rule assessment

Current regex validation result: all five `condition` values fail under Bun/JavaScript `new RegExp(pattern)` with `Invalid group` because they begin with `(?is)`. This means path discovery alone will not activate them.

Bun in this environment does support scoped modifier groups such as `(?is:...)`; I verified `(?s:a.b)` matches across a newline. The least invasive rewrite is therefore to wrap each pattern body in `(?is:...)` and replace non-JS pieces.

### Proposed condition rewrites

#### `rules/forward-chain-guard.md`

Issues:

- Current `(?is)` prefix is invalid.
- Current `\A` is not a JS start anchor.
- Intended behavior is otherwise clear: from the start of the assistant buffer, if no END/DELTA/TARGET evidence appears early, catch direct mutation/run intent.

Use:

```yaml
condition: '(?is:^(?!.{0,600}\b(?:ENVISION|DELTA|TARGET|END(?:\s+state)?|done\s+looks\s+like|success\s+(?:means|looks))\b).{0,700}\b(?:let\s+me|I(?:''ll|\s+will)|I\s+am\s+going\s+to)\s+(?:directly\s+|just\s+)?(?:edit|write|run|apply|execute)\b)'
```

Risk: includes `run`, so it can interrupt legitimate early verification prose like “let me run the test” when the model has not emitted HOLMES evidence first. That is consistent with the rule’s design, but it makes visible END/DELTA evidence mandatory before even verification-oriented action prose.

#### `rules/assumption-guard.md`

Issue:

- Current `(?is)` prefix is invalid.

Use:

```yaml
condition: '(?is:\b(?:this\s+should\s+work|I\s+believe\s+(?:this|that|it)|probably|I\s+think\s+(?:this|that|it)\s+will|most\s+likely)\b.{0,160}\b(?:so\s+(?:I(?:''ll|\s+will)|let\s+me)|therefore|which\s+means\s+(?:I(?:''ll|\s+will)|let\s+me))\b)'
```

Risk: `therefore` by itself can trigger after “probably” even if no explicit action follows. That may be acceptable as an assumption-to-conclusion guard, but it is broader than “assumption -> action”.

#### `rules/batch-primitive-prose.md`

Issue:

- Current `(?is)` prefix is invalid.

Use:

```yaml
condition: '(?is:\b(?:I(?:''ll|\s+will)|let\s+me)\b.{0,120}\b(?:read|search|find)\b.{0,180}\b(?:then|next|after(?:ward)?|from\s+there)\b.{0,120}\b(?:read|search|find)\b)'
```

Risk: this catches serial prose plans, not actual tool-call sequences. It will not trigger if the model silently calls primitive tools without first writing a chain.

#### `rules/batch-primitive-numbered.md`

Issues:

- Current `(?is)` prefix is invalid.
- Current `\b(?:first|1\.)\b` does not match `1.` reliably because the trailing `\b` after `.` is not a word boundary.
- Same issue exists for `2.` inside the second-step group.

Use:

```yaml
condition: '(?is:(?:\bfirst\b|1\.).{0,80}\b(?:read|search|find)\b.{0,240}(?:\bsecond\b|2\.|\bthen\b|\bnext\b).{0,80}\b(?:read|search|find)\b)'
```

Risk: catches “first read ... then search ...” even when the model later says the first result determines the second. The rule body already allows sequencing if the dependency is stated; this is an intended interrupt to force that explanation.

#### `rules/edit-without-verify.md`

Issue:

- Current `(?is)` prefix is invalid.

Use:

```yaml
condition: '(?is:(?:\b(?:edit|write|patch|modify)\b(?:(?!\b(?:verify|verification|confirm|confirmation|check|read[- ]?back|re-read|inspect)\b).){0,260}\b(?:and\s+)?(?:we(?:''re|\s+are)\s+done|done|that\s+should|finish(?:ed)?|complete)\b|\bapply\s+the\s+change\b(?!.{0,260}\b(?:verify|verification|confirm|confirmation|check|read[- ]?back|re-read|inspect)\b)))'
```

Risk: a very long plan with verification mentioned more than 260 chars after `apply the change` can still trigger. That is acceptable for this guard; verification should be close to the mutation plan.

### Validation performed

- Current five patterns: tested with `new RegExp(pattern)` in JS; all five fail with `Invalid group`.
- Proposed five patterns: tested with Bun `new RegExp(pattern)`; all compiled.
- Smoke samples validated expected behavior for:
  - forward-chain with and without ENVISION evidence
  - assumption-to-action wording
  - prose primitive batching
  - numbered primitive batching including `1.` / `2.`
  - edit/apply plans with and without verification language

## 6. `RULES.md` in `rules/`

With the `./` root fix, `rules/RULES.md` will be scanned because `loadRules()` loads every `*.md` and `*.mdc` file in `rules/`.

It does not need to be moved or renamed to avoid TTSR activation:

- It has no YAML frontmatter.
- Therefore it has no `condition`, no `scope`, no `alwaysApply`, and no `description`.
- `sdk.ts` buckets rules as:
  - TTSR only if `condition` exists and `ttsrManager.addRule(rule)` succeeds.
  - always-on rule only if `alwaysApply === true`.
  - rulebook rule only if `description` exists.
- Current `RULES.md` is loaded as a Rule object and then dropped from active TTSR/rulebook/always-apply buckets.

Recommendation: do not move it solely for TTSR safety. If it is intended to be active context, add explicit frontmatter such as `alwaysApply: true` and `description: ...`; otherwise leave it inert or move it out of `rules/` for cleanliness.

## 7. `resources_discover` as an alternative

Confirmed limitation:

- `ResourcesDiscoverResult` has only:
  - `skillPaths?: string[]`
  - `promptPaths?: string[]`
  - `themePaths?: string[]`
- There is no `rulePaths` field.
- `ExtensionAPI` exposes `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`, message rendering, and event handlers; it does not expose `registerRule()`.
- Source search found no programmatic rule registration surface other than native capability discovery / `options.rules` passed internally to SDK setup.

So `resources_discover` cannot register TTSR rules. It may be intended to supplement skills/prompts/themes, but I found no call site for `ExtensionRunner.emitResourcesDiscover()` in the checked `src/` tree, so the reliable fix path for this package is still settings-root sub-discovery, not `resources_discover`.

## Fix path

1. Change `.omp/settings.json` to point at the package root:

```json
{
  "extensions": [
    "./"
  ]
}
```

2. Keep `package.json` `omp.extensions` pointing at `./src/main.ts` so the extension factory still loads.

3. Rewrite the five `condition` fields using the proposed JS-compatible forms above.

4. Start OMP from `/Users/tom.kyser/dev/reasoner` and verify:

- extension startup message/behavior still appears, proving `src/main.ts` loaded through `package.json`.
- `/holmes` and `/holmes-goal` commands are available, proving `commands/` package sub-discovery works.
- `skill://holmes` or equivalent skill lookup works, proving `skills/` package sub-discovery works.
- A controlled assistant output such as “Let me edit the file” before HOLMES evidence triggers a `ttsr_triggered` event / TTSR notification, proving `rules/` discovery plus regex registration works.

## Risks and edge cases

- Path fix alone is insufficient; current regexes will be discovered but skipped by TTSR due invalid JS syntax.
- Existing `scope: text, thinking` is correct for prose/thinking interruption, but it will not catch direct silent tool calls. Keep hook-based guards for tool-call enforcement.
- TTSR default repeat behavior is once-per-rule; repeated violations may not re-trigger unless settings use an after-gap repeat mode.
- `RULES.md` is inert today. It is not a TTSR hazard, but it is also not providing always-on guidance.
- `resources_discover` cannot help with rules and should not be part of the Gap 3 rule activation plan.
