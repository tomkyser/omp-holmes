# Enforcement & Mechanism Review — Round 3 Thorough

## Verdict

Tom's reframing is correct: scope is only a crude proxy. The classifier's real target is the predicted behavioral impact of the finished work: what changes for users, systems, data, safety, security, reliability, and downstream maintainers.

The enforcement conclusion is narrower than the product conclusion:

1. **Impact can be partially enforced deterministically.** Deterministic code can prove some zero-impact cases, identify many high-impact floors, and fail closed on unknowns. It cannot understand arbitrary code meaning well enough to prove ordinary source changes are low-impact.
2. **The current design's deterministic `execute()` can remain the authority path, but its algorithm must change from scope/risk signal classification to impact-certificate prove-down.** The important object is no longer `scopeFlags`; it is a concrete effect summary plus proof ledger: what behavior can this mutation change, and what evidence bounds that effect?
3. **A hybrid architecture is feasible in OMP, but only if the model component is extension-owned.** `ExtensionContext` exposes the current model and `ModelRegistry`, and `@oh-my-pi/pi-ai` exports `complete()`/`stream()`, so extension code can construct its own classifier model call. OMP does not provide a high-level `ctx.complete()` method, and `ExtensionContext` does not itself provide file-reading APIs, but trusted extension code can read files through normal Node/Bun filesystem APIs using `ctx.cwd`.
4. **A model assessor must never be the only downgrade authority for Tier 1 or for overriding deterministic high-impact floors.** It can help classify the ambiguous middle. It cannot make comment/whitespace proof, exact effect binding, hard risk floors, or cumulative scope tracking optional.

Recommended design: **deterministic prove-down first, concrete-effect impact certificates at the gate, then optional extension-owned model judgment for the soft middle.** That is option C with a limited form of option D.

---

## Source facts checked

These are the OMP mechanics relevant to Round 3:

- A registered tool's `execute` receives `ctx: ExtensionContext` (`/Users/tom.kyser/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts:370-377`).
- `ExtensionContext` contains `ui`, `cwd`, `sessionManager`, `modelRegistry`, current `model`, `getSystemPrompt()`, `getContextUsage()`, `compact()`, and session-control/status methods. It does **not** include a `readFile`, `fs`, `complete`, `stream`, or `askModel` method (`types.ts:259-286`).
- `ExtensionRunner.createContext()` populates those same fields from live runtime state (`runner.ts:447-465`).
- `ReadonlySessionManager` includes `getEntries`, `getBranch`, `getLeafEntry`, artifact helpers, and related read methods, so extension code can inspect persisted session history through `ctx.sessionManager` (`session-manager.ts:274-296`).
- `ModelRegistry` exposes model lookup and credential helpers: `getAll()`, `resolveCanonicalModel()`, `getAvailable()`, `find()`, and `getApiKey()` (`model-registry.ts:2085-2086`, `2203-2210`, `2220-2221`, `2251-2252`, `2265-2270`).
- `@oh-my-pi/pi-ai` exports `stream` and `complete`; `complete(model, context, options)` just calls `stream(...).result()` (`pi-ai/src/index.ts:29-30`, `pi-ai/src/stream.ts:391-397`).
- `pi-ai`'s LLM `Context` is just `{ systemPrompt?: string[]; messages: Message[]; tools?: Tool[] }`, so an extension-owned classifier call can be built without including session tools or assistant tool state (`pi-ai/src/types.ts:701-705`).
- The extension factory runs in-process and stores the actual tool definition object; `registerTool()` stores the definition in the extension's tool map (`loader.ts:144-151`), and the factory is invoked directly (`loader.ts:283-304`). There is no sandbox boundary preventing normal extension code from importing modules or reading files.

---

## 1. Can impact be enforced deterministically?

### Short answer

**Some impact can be enforced deterministically. Full impact cannot.**

A deterministic classifier cannot generally answer "what does this arbitrary code change mean?" It can answer narrower questions:

- Did this concrete mutation avoid executable/configuration tokens entirely?
- Did it touch a known high-impact surface?
- Did it remove or alter a syntactic construct that commonly guards behavior?
- Did it change public contracts, schemas, dependency resolution, deployment behavior, prompts/rules/hooks, or tests that define safety evidence?
- Is the change's effect unknown because the file type, tool, or surrounding code cannot be interpreted?

That is enough for enforceable floors and safe prove-down. It is not enough to grant low tiers for arbitrary source changes.

### Impact categories that can be handled deterministically

#### Deterministically provable zero impact

This must be a closed set. Examples:

- No code-token change in a parsed source file.
- Whitespace-only source formatting with unchanged token stream or AST-equivalent proof for a language the classifier knows.
- Comment-only source edits where comments are not semantic for that file type and are outside tool directives, generated pragmas, build annotations, or literate/config hybrids.
- Documentation prose edits outside executable snippets, API contracts, safety instructions, CLI commands, runbooks, prompt/rule files, and generated docs that downstream tooling consumes.
- Typo-only non-code edits with exact single-effect fingerprint.

This is the only class that should receive Tier 1. "Small code change" is not zero impact.

#### Deterministically provable high impact

This is not a proof that the change is bad. It is a proof that the possible blast radius is high enough to require a high process floor.

Hard high-impact floors should include:

- Paths under known risk surfaces: auth, authorization, authentication, session, identity, payments, billing, crypto, secrets, permissions, migrations, persistence, schemas, data deletion/retention, deployment, CI release gates, infrastructure, safety-critical integrations, prompts/rules/hooks/classifier/gate code.
- Operations that remove, replace, negate, or bypass guards: `if`, `switch`, early returns, `throw`, `catch`, validation branches, permission checks, status checks, rate limits, feature flags, null/undefined guards, retry/backoff limits, timeout values, data filters.
- Changes to comparators, boolean operators, defaults, enum variants, schema constraints, public exports, function signatures, serialization formats, lockfiles, dependency manifests, and migration files.
- Test expectation changes that reduce safety evidence: deleting assertions, weakening matchers, changing fixtures, skipping tests, broadening mocks, or accepting errors that were previously rejected.
- Opaque or broad mutation tools: `bash`, `eval`, `task`, broad `ast_edit`, `browser`, `debug`, GitHub operations, unknown custom tools, and any tool input whose effect cannot be normalized before execution.

These are deterministic because the classifier is not claiming deep semantic understanding. It is saying: "this syntactic/path/tool effect can alter behavior beyond a cosmetic surface; do not prove down past the required floor."

#### Requires interpolation

Everything else requires interpolation: reasoning from available signals to predicted outcome.

Examples:

- A one-line implementation change in a normal source file that changes a return expression.
- A private helper refactor where callers may or may not observe behavior.
- A config value change where the schema is known but operational consequences depend on runtime load.
- A test addition that appears harmless but changes fixtures or setup order.
- A UI copy change that may affect user behavior but not system invariants.
- A parser, serializer, cache, scheduler, concurrency, or retry change outside explicitly named risk paths.

Deterministic code can collect facts for these cases. It cannot honestly prove their impact without either domain-specific analyzers or model/human judgment.

### The deterministic ceiling

The achievable deterministic target is:

```text
zero-impact certificate -> Tier 1 allowed
known high-impact floor -> Tier 3/4 floor, no downgrade below it
unknown or ambiguous impact -> remain at current higher tier unless a stronger certificate exists
bounded semantic impact -> Tier 2/3 only if concrete evidence bounds downstream effect
```

That is materially better than scope classification. It is not semantic intelligence.

---

## 2. The model intelligence gap

### The gap

Impact assessment asks: "what behavior changes, and how will the finished product be received?" For arbitrary code, that is semantic reasoning. Deterministic checks can identify certain classes of effect; they cannot infer intent, invariant preservation, caller expectations, or domain consequences for the soft middle.

If the product requirement is accurate middle-tier classification instead of conservative floors, some model intelligence is necessary.

The risk is where that intelligence lives.

### Architecture A: pure deterministic

**What it buys:**

- Strongest enforcement boundary.
- Ungameable by assistant prose if all down-proofs come from extension-observed facts and concrete tool input.
- Easy to fail closed.
- Tier 1 can be genuinely trustworthy.

**What it costs:**

- Many ordinary source changes remain Tier 3/4 because their behavioral impact is not provable.
- The classifier will over-escalate unless it has a rich library of language/file/schema-specific certificates.
- Users may experience HOLMES as conservative friction unless Tier 2 proof paths are practical.

This is safe but may be noisy.

### Architecture B: deterministic + model judgment

**What it buys:**

- Deterministic code handles clear zero/high cases.
- Model judgment handles the ambiguous semantic middle.
- Better UX for bounded source changes.

**What it costs:**

- The model component becomes part of the safety boundary unless carefully constrained.
- If it can lower tiers below deterministic floors, it reopens self-classification failure.
- It needs prompt-injection hardening because user text, code, comments, docs, and assistant reasoning are all untrusted inputs.

This is viable only if model output is treated as an advisory impact assessment with structured evidence, not as proof by itself.

### Architecture C: two-pass deterministic prove-down, then optional model refinement

This is the best design.

Pass 1: deterministic floors and certificates.

- Prove Tier 1 only from concrete zero-impact effect.
- Apply hard high-impact floors from path/tool/syntax/contract surfaces.
- Build an `ImpactEffectSummary` from the current file, pending mutation, path role, AST/token diff, config/schema role when known, and cumulative request ledger.
- Determine the lowest tier allowed by deterministic facts.

Pass 2: optional extension-owned model refinement for the soft middle.

- Only invoked when Pass 1 returns an ambiguous Tier 2/3/4 boundary.
- Receives a sealed prompt, structured inputs, bounded file context, concrete diff/effect summary, and explicit classification rubric.
- Returns structured JSON: predicted behavior change, affected users/systems, downstream dependencies, uncertainty, required verification, recommended tier.
- Cannot return Tier 1.
- Cannot override hard high-impact floors.
- Cannot erase unknowns or cumulative scope expansion unless it cites extension-observed evidence.

This preserves deterministic enforcement while using model intelligence where deterministic code is weakest.

### Architecture D: custom tool calls an LLM inside `execute()`

Feasible, with caveats.

`ExtensionContext` does not expose a direct `ctx.complete()` or `ctx.stream()` method. It does expose:

- `ctx.model`: the current `Model | undefined`.
- `ctx.modelRegistry`: model lookup and API key access.
- `ctx.getSystemPrompt()`: current effective session prompt, if the extension wants it.
- `ctx.sessionManager`: session entries/history.

Separately, `@oh-my-pi/pi-ai` exports `complete()` and `stream()`. Extension code running in-process can import those, construct a minimal `Context`, obtain the API key with `ctx.modelRegistry.getApiKey(model, ctx.sessionManager.getSessionId())`, and call the provider.

So option D is mechanically possible as extension code, but it is not a turnkey ExtensionContext method.

Important caveats:

1. **Do not use the normal session context.** The classifier call should not include session tools, assistant messages, or unbounded chat history. It should use a small, purpose-built context.
2. **Do not use untrusted text as instructions.** User request, assistant plan, code comments, and docs must be quoted as data. The classifier system prompt must be extension-owned.
3. **Do not make the model output authoritative by itself.** The output can refine a Tier 2/3/4 decision; deterministic floors and exact effect checks still win.
4. **Decide model selection explicitly.** If the classifier uses `ctx.model`, it follows the session's current model. That is convenient but not fully independent from user/session configuration. Prefer a configured classifier model or role resolved through `ModelRegistry`, with a deterministic fallback when unavailable.
5. **Avoid model calls inside the hot `tool_call` gate.** Round 2 found `tool_call` handlers are awaited directly and a hung gate can hang tool execution. Run model refinement in `holmes_classify.execute()` or an explicit refinement tool, not in the pre-execution event handler.

### Is this self-classification?

Not if implemented correctly.

It is self-classification if:

- the session agent writes the tier in prose;
- the session agent fills a schema and the extension trusts it;
- a Task agent returns a verdict through the same untrusted courier channel;
- the classifier model receives the session agent's reasoning as instruction rather than evidence.

It is extension-owned classification if:

- local extension code owns the classifier prompt and rubric;
- the model call is made inside extension code;
- inputs are structured and quoted as untrusted data;
- output is parsed and bounded;
- deterministic floors are applied before and after the call;
- the final record is stored in extension state, not derived from visible assistant text.

The session agent can still influence the classifier indirectly by choosing what plan it proposes and what files it reads. It cannot directly dictate the verdict unless the extension trusts its prose.

---

## 3. What does `ExtensionContext` provide?

### Model/LLM access

`ExtensionContext` provides model metadata and credentials plumbing, not a direct completion API.

Available:

- `ctx.model`: current model.
- `ctx.modelRegistry`: model catalog, availability checks, model resolution, and API key retrieval.
- `ctx.getSystemPrompt()`: current session prompt.
- `ctx.getContextUsage()`: current context usage.

Not available directly:

- `ctx.complete()`.
- `ctx.stream()`.
- `ctx.askModel()`.
- A built-in "classifier model" abstraction.

Practical result: a tool can make an LLM call if extension code imports `@oh-my-pi/pi-ai` and uses `complete()`/`stream()` with the model and credentials from context. That is implementation work inside the extension, not a first-class `ExtensionContext` service.

### File reading

`ExtensionContext` itself does not expose file-reading helpers.

Available:

- `ctx.cwd`, the workspace root.
- `ctx.sessionManager` artifact/session helpers.
- Normal in-process extension code can import `node:fs`, `node:fs/promises`, or use Bun APIs to read files relative to `ctx.cwd`.
- The extension factory can also capture `pi`, whose API includes `exec()`, but shelling out for classification should be avoided.

Practical result: the tool can read the actual current contents of files, but not because `ExtensionContext` has a `readFile` method. It can do so because extensions are trusted in-process code with filesystem access.

### Session history

Yes. `ctx.sessionManager` is a `ReadonlySessionManager`, which includes `getEntries()`, `getBranch()`, `getLeafEntry()`, `getEntry()`, header/session metadata, artifact helpers, and related read methods.

This matters because impact classification must be cumulative. The classifier can inspect:

- latest user request;
- previous assistant/tool messages in the branch;
- prior HOLMES custom entries if the extension persists them;
- prior classifications, blocked mutations, scope expansions, and verification outcomes if recorded as custom entries.

### Could the tool inspect actual change context?

Yes, but timing matters.

Before mutation, inside `holmes_classify.execute()`:

- It can read the current files named in the plan.
- It can inspect surrounding code context, path role, AST structure, exports/imports, config schemas, and known risk surfaces.
- It cannot know the exact future edit unless the model provided an exact normalized effect fingerprint or patch.

At the mutation gate, in the `tool_call` handler:

- It sees the actual pending tool input before the underlying mutating tool executes.
- It can summarize the pending effect.
- For `edit`/`write`, it can read current file contents, apply the proposed change in memory, and compare tokens/AST/config values.
- For narrow `ast_edit`, it may be able to derive the affected pattern/output, but if it cannot preview exact effects cheaply, it must treat the call as opaque or require exact preview/fingerprint support.
- For `bash`, `eval`, `task`, `browser`, `debug`, `github`, and unknown tools, it should treat effects as opaque unless the operation is explicitly classified and exact-input-bound at a high enough tier.

Therefore: **impact proof belongs as close as possible to the concrete pending mutation.** A proactive plan classifier can set process floor; the gate must still bind the actual effect.

---

## 4. Hybrid architecture feasibility

### Feasible execution path

A feasible OMP path is:

1. The session agent performs read-only preflight if needed.
2. The session agent calls `holmes_classify` with proposed plan, files, tools, reasoning, and any exact planned effect fingerprints it can provide.
3. `holmes_classify.execute()` builds an extension-owned snapshot:
   - latest user request;
   - cumulative session/tool ledger;
   - planned files/tools;
   - current file contents for explicit paths when safe and bounded;
   - path role and known-risk surface classification;
   - optional AST/token/config summaries;
   - prior classification/process records.
4. Deterministic pass creates:
   - zero-impact certificates where possible;
   - high-impact floors;
   - unknown/opaque blockers;
   - cumulative scope and process floor.
5. If deterministic pass leaves an ambiguous Tier 2/3/4 boundary and model refinement is enabled, extension code makes a private classifier LLM call:
   - no tools;
   - no session assistant authority;
   - bounded quoted inputs;
   - strict JSON output;
   - timeout/fail-closed behavior.
6. `execute()` stores a `ProcessRecord` and/or `MutationLease` in extension state.
7. Later, any effectful tool call reaches the `tool_call` gate.
8. The gate summarizes the concrete pending effect, reads current files if needed for exact proof, validates freshness, checks process-floor requirements, and verifies lease coverage.
9. If the concrete effect differs from the classified plan or has higher impact than expected, the gate blocks and requires reclassification.

### Tier boundaries under the hybrid design

#### Tier 1 proof

Always deterministic.

Requirements:

- concrete pending effect or exact normalized planned effect;
- non-semantic certificate;
- no opaque tool;
- no risk-surface file where comments/docs can be operational instructions;
- exact single-use lease.

The model cannot grant Tier 1.

#### Tier 2/3/4 boundary

Deterministic floors first.

Then optional model interpolation can answer:

- what behavior appears to change;
- which user/system outcomes could be affected;
- whether the impact is local, cross-module, or systemic;
- what verification would establish confidence;
- whether one TARGET/DELTA checkpoint is sufficient or a full HOLMES pass is required;
- whether Tier 4 iterative closure is required.

The model can raise tier or prevent downgrade. It can recommend a lower Tier 2/3 boundary only when no deterministic blocker exists and it provides evidence references the extension can tie to observed context.

#### Tier 4 closure

Still not model-only.

A model can help synthesize closure, but the gate should require mechanical closure evidence:

- all open blocking unknowns have evidence references;
- latest synthesis covers cumulative scope;
- no new scope/unknowns appeared after synthesis;
- concrete mutation leases exist;
- verification plan is explicit;
- hard review/delegation requirements are satisfied if policy requires them.

### Does this require a tool-design change?

Yes, but not necessarily a new external tool.

The current custom tool shape can remain recognizable, but the internal record and gate contract need changes:

- Add `HolmesTier = 1 | 2 | 3 | 4` everywhere.
- Split process floor from mutation lease.
- Replace `tier1/tier2/tier3Signals` with `ImpactProof` and `FailedProofObligation` ledgers.
- Add `ImpactEffectSummary`:
  - file role;
  - concrete operation kind from tool input, not model label;
  - AST/token/config diff class;
  - guard/conditional/validation/public-contract changes;
  - downstream/caller indicators when cheaply available;
  - unknown/opaque markers;
  - deterministic floors;
  - optional model assessment provenance.
- Make Tier 1 require concrete effect proof at gate time unless exact planned effect was supplied and later matched.
- Add model-refinement configuration if option D is enabled: classifier model selector, timeout, max input sizes, fail-closed policy, JSON schema version, and telemetry fields.

So the **algorithm absolutely changes**. The **tool design also changes** because the stored details and gate inputs must represent impact, not just scope.

---

## 5. Enforcement of impact-based classification

### Deterministic-only enforcement boundary

Boundary:

```text
model proposes -> extension computes deterministic proof -> extension stores record -> gate authorizes exact covered effects only
```

Enforced properties:

- Assistant prose cannot authorize mutation.
- Omitted risk words do not prove low impact.
- Unknown file/tool/effect stays high.
- Tier 1 is exact and non-semantic.
- Known high-impact syntactic/path/tool changes cannot be downgraded.
- Actual pending mutation must match the lease.

Residual issue:

- Classification is conservative. Many semantically safe edits will require Tier 2/3/4 because deterministic code cannot prove their impact is contained.

### Hybrid/model enforcement boundary

Boundary:

```text
model proposes -> deterministic floors -> extension-owned classifier model advises -> deterministic post-check -> extension stores record -> gate authorizes exact covered effects only
```

Enforced properties:

- The session agent cannot directly decide the tier.
- The classifier model prompt/rubric is extension-owned.
- The classifier model has no tools and no mutation capability.
- Its output is structured evidence, not an authorization token.
- Deterministic floors still dominate.

Residual issue:

- The classifier model can be wrong or prompt-injected by quoted code/user content if the prompt is weak or output is over-trusted.
- If the classifier uses the current session model, user/session configuration affects which model judges impact. That is not the same as session-agent self-classification, but it is not a fully independent adjudicator either.

### Can the session agent influence a model call made inside `execute()`?

It can influence inputs, not authority, if designed correctly.

Influence paths that remain:

- It chooses the proposed plan.
- It may choose which files to read before classification.
- Its prior assistant text may be included if the extension includes it.
- User-supplied code/comments/docs can contain prompt-injection text if included in classifier context.
- If the extension uses `ctx.model`, the session's selected model affects classifier quality.

Controls:

- Treat all session/user/code text as data.
- Build the classifier prompt inside extension code.
- Exclude assistant chain-of-thought and visible self-certification from downgrade proof.
- Include current file content/diff excerpts only in fenced/JSON-escaped data fields.
- Require the classifier model to emit JSON validated by schema.
- Apply deterministic floors after the model result as well as before it.
- Store model-assessment provenance and confidence, not just the recommended tier.
- Fail closed on timeout, malformed output, missing credentials, or model uncertainty.

The session agent should not be able to influence the final verdict downward unless the deterministic evidence and extension-owned classifier both support that outcome within allowed bounds.

---

## 6. The classifier classifying itself

### Philosophical part

Tom's recursive framing is right: the classifier's own decision has impact.

Under-classification impact:

- risky work mutates with insufficient reasoning;
- dangerous small changes bypass review;
- users over-trust the gate;
- failures appear after the system already authorized action.

Over-classification impact:

- users see HOLMES as ceremony;
- agents waste work satisfying high tiers for cosmetic edits;
- users learn to disable or route around the guard;
- signal loses credibility.

So the classifier should optimize for the received effect of the classification decision: safe enough to trust, calibrated enough to keep enabled.

### Mechanical enforcement

The classifier cannot become self-aware. But we can mechanize recursive impact awareness as calibration feedback.

Add a `ClassifierDecisionLedger` maintained by the extension:

```ts
interface ClassifierDecisionLedgerEntry {
  decisionId: string;
  ruleVersion: string;
  userRequestDigest: string;
  deterministicFloor: HolmesTier;
  finalTier: HolmesTier;
  impactCertificates: string[];
  failedProofs: string[];
  modelAssessment?: {
    model: string;
    outputSchemaVersion: string;
    recommendedTier: HolmesTier;
    uncertainty: "low" | "medium" | "high";
    citedEvidence: string[];
  };
  actualMutationFingerprints: string[];
  laterBlocks: string[];
  reclassificationReason?: string;
  verificationOutcome?: "passed" | "failed" | "not_run" | "blocked";
  userNarrowedAfterClassification?: boolean;
  userAbortedAfterClassification?: boolean;
}
```

Use it for calibration signals:

- Tier distribution by operation/file type.
- How often Tier 1 exact leases are later blocked for mismatch.
- How often Tier 2 work expands into Tier 3/4.
- How often Tier 3 single-pass work discovers new blocking unknowns.
- How often Tier 4 closure fails or loops without progress.
- User interruptions/narrowing immediately after over-escalation.
- Verification failures after lower-tier authorization.
- Model-refinement disagreement with deterministic floors.
- Repeated false positives on exact zero-impact classes.
- Repeated false negatives where later gate blocks or verification failures reveal higher impact.

### Feedback rules

Use feedback to adjust certificates, not to let the live model negotiate tiers.

Safe feedback uses:

- offline rule updates;
- adversarial regression tests;
- adding deterministic zero-impact certificates for common over-escalated patterns;
- adding hard floors for patterns that produced scope expansion or verification failure;
- tuning model classifier prompt/schema;
- product dashboards for classifier health.

Unsafe feedback uses:

- lowering tiers in the same session because the user complained;
- treating user override frequency as proof of safety;
- allowing the session agent to cite historical inconvenience as downgrade proof;
- online-learning rules directly from untrusted tasks;
- making Tier 1 broader because Tier 2 feels too common.

### Can stats feed back into classification?

Yes, but only through extension-owned, versioned calibration.

A safe loop:

1. Store decision ledger entries as extension custom entries or external telemetry if product policy allows.
2. Aggregate by rule version, file type, effect class, and final outcome.
3. Identify over-escalation and under-escalation clusters.
4. Add or tighten deterministic certificates.
5. Add regression fixtures for every changed certificate.
6. Roll forward a new `ruleVersion`.
7. Keep old decision records auditable under the rule version that created them.

The classifier should not continuously self-modify at runtime. Runtime feedback should raise caution, not lower it. For example, if a Tier 2 task expands into Tier 4 in the same request, future overlapping classifications in that request should inherit the higher floor. Conversely, if a user repeatedly narrows a task after Tier 4, that narrowing is a new request/scope and must be reclassified from scratch, not treated as proof the original Tier 4 was wrong.

---

## Impact prove-down redesign

### Old prove-down question

Round 2's prove-down question was effectively:

```text
Can we prove this scope is narrow enough for a lower tier?
```

That was already better than trigger-up classification, but it still centered scope.

### New prove-down question

Round 3 should ask:

```text
Can we prove the behavioral impact of the concrete effect is contained enough for a lower tier?
```

Scope remains evidence, not the target.

A one-file change can be catastrophic. A hundred-file doc format pass can be non-semantic. A one-line timeout/config/schema change can be system-wide. Therefore each step-down must include impact containment.

### Tier 4 -> Tier 3: prove impact does not require iterative closure

Required proof:

- Cumulative objective is bounded.
- Affected behavior surface is known.
- No safety/security/data/deploy/auth/crypto/payment/migration/process-control/public-API floor applies.
- Unknowns are finite and resolvable in one pass.
- No evidence suggests downstream contract or cross-subsystem impact.
- Tools are inspectable or exact-input-bound.

Failure examples:

- "single file" auth guard change;
- config timeout with operational semantics unknown;
- prompt/rule/hook/classifier change;
- migration/schema/deploy file;
- broad refactor whose downstream callers are not known;
- debugging where root cause is unknown.

### Tier 3 -> Tier 2: prove impact is local and predictable

Required proof:

- One concrete behavior surface.
- Known current file context.
- Known callers/downstream contracts or proof they are unaffected.
- No unresolved assumptions that affect the mutation.
- Verification route is clear and local.
- Mutation tool/effect is inspectable.

Tier 2 becomes the normal home for bounded semantic source edits. It should not require the classifier to prove zero impact. It requires proof that impact is localized and understandable with a short TARGET/DELTA checkpoint.

### Tier 2 -> Tier 1: prove no behavioral impact

Required proof:

- Concrete effect available.
- Non-semantic certificate succeeds.
- Exact lease matches later mutation.
- No config/prompt/rule/hook/docs-as-contract exception.
- No opaque tool.

This is the hard boundary. A source-code token change should not be Tier 1 unless a language-specific equivalence proof shows no semantic change.

---

## High-impact vs low-impact signals

### High impact, low scope

These are the cases the old scope classifier misses:

- Removing or weakening an authorization check.
- Changing a boolean operator in a permission predicate.
- Changing a timeout/retry/backoff/concurrency limit.
- Altering a schema constraint or migration default.
- Changing a public function signature or exported type.
- Replacing `throw`/`return error` with success path.
- Changing a payment amount, currency, rounding, or idempotency key.
- Updating a prompt/rule/hook/classifier instruction.
- Deleting or weakening a test assertion that guards a critical behavior.

These require hard floors even when the diff is one line.

### Low impact, high scope

These are over-escalation traps:

- Repo-wide whitespace formatting with AST/token equivalence.
- Comment typo fixes across many files where comments are non-semantic.
- Documentation prose formatting outside contracts/snippets/runbooks.
- Mechanical line wrapping in markdown.
- Generated formatting that is proven non-semantic for the file type.

These can be lower tier if the non-semantic proof is concrete and batch-safe. File count alone should not force Tier 4.

### High impact, high scope

These should naturally remain Tier 4 unless tightly bounded by process evidence:

- Architecture/API redesign.
- Cross-subsystem auth/session/data changes.
- Deployment/migration/release changes.
- Data retention/deletion/persistence changes.
- Security/crypto/payment changes across callers.
- Debugging unknown production-impacting behavior.
- Classifier/gate/tooling changes that affect future agent behavior.

### Low or moderate impact, low scope

These are Tier 2 candidates unless zero-impact proof exists:

- Bounded private helper behavior change.
- Local bug fix with known caller and test route.
- Small UI behavior/copy change not tied to safety or contracts.
- Local test addition that strengthens evidence without changing runtime behavior.
- Private refactor with compiler/type/test evidence route.

They are not Tier 1 merely because they are small.

---

## Avoiding false positives and false negatives

### False positives: cosmetic changes over-escalated

Mitigations:

- Make zero-impact certificates concrete and broad enough for real cosmetic work.
- Allow batch Tier 1 for multiple files only when every changed file has a non-semantic certificate and the operation is exact/fingerprint-bound.
- Distinguish documentation prose from docs that act as contracts, prompts, runbooks, commands, or generated artifacts.
- Let read-only preflight gather enough evidence before classification.
- Report missing proof precisely so the agent can obtain it.

Do not mitigate false positives by treating "small" or "single file" as low impact.

### False negatives: high-impact small changes under-escalated

Mitigations:

- Hard floors for risk surfaces and syntactic guard/check/default/config/schema/public-contract changes.
- Concrete pending-effect analysis at the gate, not just plan analysis in `execute()`.
- Unknown file types and opaque tools stay high.
- Cumulative request ledger prevents sequential slicing.
- Deterministic floors are applied after optional model refinement.
- Verification failures and scope expansion raise overlapping future floors in the same request.

The false-negative rule should be blunt: **when impact is not known, do not classify it as low.**

---

## Concrete recommendation

Implement impact-based classification as a layered gate:

1. **Effect extraction:** derive an `ImpactEffectSummary` from user request, cumulative session ledger, planned actions, current file content, and pending mutation input.
2. **Deterministic certificates:** prove zero impact, set hard high-impact floors, and record failed proof obligations.
3. **Process floor + mutation lease:** keep Round 2's separation; impact affects the floor, exact concrete effects define leases.
4. **Optional extension-owned model assessor:** use only for ambiguous Tier 2/3/4 impact interpolation, never for Tier 1 or overriding hard floors.
5. **Gate-time revalidation:** classify plans early for UX, but prove the actual mutation from concrete tool input before execution.
6. **Classifier decision ledger:** track outcomes and calibrate rule versions offline; use runtime feedback only to raise caution or require reclassification.

This answers Tom's reframing without pretending deterministic code can understand arbitrary program semantics. Deterministic code enforces the safety shell. Model intelligence, if added, supplies bounded interpolation inside that shell.