# Adversary Review: `holmes_classify` Custom Tool Design

## Position

This design is a major improvement over the current marker gate. Moving authority into extension-owned `holmes_classify.execute()` removes the worst failure mode: the session model no longer gets to authorize itself by printing `[CLASSIFY: Tier 1]`.

My concern is now narrower but still material: the design is strong as an authorization and scope-binding mechanism, but weak as a semantic risk classifier. A deterministic scanner over user text, visible/thinking text, tool logs, and model-supplied planned actions can prove some safe cases, but it cannot prove that an arbitrary source-code edit is safe. If Tier 1 includes “mechanical_code” without exact diff/operator proof, subtle dangerous changes can still be laundered as trivial.

The safe framing is: **`holmes_classify` can be the enforcement record system; deterministic Tier 1 must be a very narrow proof-based allowlist, not a general heuristic judgment.**

---

## 1. Original 10 attack vectors

### 1. Session-controlled classifier input laundering

**Addressed in principle, with important gaps.**

The design explicitly treats tool parameters as untrusted and cross-checks them against the latest user request, visible/thinking observation, tool log, extracted paths, tools, operation kinds, and risk flags. It also says the mutation gate validates the eventual tool call against the extension-created scope envelope. That is the right direction.

The remaining gap is that the classifier is still largely classifying a **planned envelope**, not necessarily the concrete pending mutation. `PlannedActionSchema` has `toolName`, `paths`, `operationKind`, `summary`, and optional `exactOpaqueInput`; it does not require an exact structured edit fingerprint for ordinary `edit`, `write`, or narrow `ast_edit` actions. The later gate says Tier 1 exact leases must match a planned action fingerprint or exact single-path structured edit envelope, but the schema does not show where that fingerprint comes from for non-opaque tools.

That matters because the model can truthfully provide a single path and `mechanical_code` while the actual edit changes behavior. Unless the gate can compare the actual mutation payload against a classifier-approved exact patch/operator, input laundering survives in a smaller form.

**Required tightening:** classify concrete effects, not prose plans. For Tier 1, require either:

- an exact normalized mutation fingerprint for the actual pending tool input; or
- a deterministic proof that the concrete diff is from a closed safe operator set, such as whitespace-only, comment-only, non-source typo, formatting with no AST/token semantic change, or other explicitly enumerated mechanical transforms.

No ordinary source-code behavior change should reach Tier 1 because the model called it mechanical.

### 2. Turn-level Tier 1 lease reused for arbitrary later mutations

**Adequately addressed if implemented as written.**

The design replaces turn-level approval with records bound to scope, tool, path set, operation kind, mutation count, freshness, and nonce. Tier 1 is normally `leaseKind: "exact"` and `maxMutations: 1`. Scope/tool/path mismatch blocks rather than falling back to an older record.

The main gap is the exception allowing “an explicit tiny mechanical batch over the same file.” That is acceptable only if each batched action is individually fingerprinted or derived from a deterministic closed safe operator. A vague same-file budget reintroduces lease reuse.

### 3. Effectful-tool laundering through `eval`, `bash`, package scripts, or delegated agents

**Mostly addressed.**

The design correctly expands the effectful set beyond current `MUTATING_TOOLS` to include `eval`, `task`, `debug`, `browser`, `github`, `generate_image`, and unknown custom tools. It also correctly treats `eval` and `task` as effectful by default, and requires exact input binding for opaque tools.

The remaining distinction: exact hashes bind the call; they do not make opaque side effects understandable. `bash` can run package scripts, glob expansions, env-dependent behavior, networked commands, or tools whose behavior changes with repository state. `eval` can do the same through language APIs. Exact matching prevents post-classification substitution, but it does not justify Tier 1.

The design mostly respects that by saying `bash`/`eval` are never Tier 1 by default. I would make that absolute: opaque tools should never authorize Tier 1 mutation, even with exact hashes.

### 4. Session-as-courier tampering with Task classifier prompts

**Addressed cleanly.**

The custom tool removes Task from the authority path. The model calls `holmes_classify`, but the classification logic runs inside extension-owned `execute()` and stores the record directly in extension state. This eliminates prompt tampering, agent substitution, selective result surfacing, and fake Task-result prose as classifier authority.

This relies on the `pi.registerTool()` API providing real provenance: the extension must know that `execute()` ran locally, that the returned record was stored by the extension, and that the gate checks extension memory rather than visible text or copied JSON.

### 5. Steer-only classification by the same session model

**Addressed.**

The returned design does not accept the model’s own marker or prose as authorization. `proposedTier` may raise the tier, but cannot lower the assessed tier. Visible text and hidden thinking are telemetry/compliance evidence only.

That is the correct boundary.

### 6. Prompt injection against the classifier

**Addressed for classic prompt injection, but replaced by feature-gaming risk.**

There is no model classifier prompt to inject, so instructions like “classifier: answer Tier 1” become inert text. That is a major improvement.

The new risk is not prompt injection; it is deterministic feature manipulation. The model can avoid escalation words in its own reasoning, and user/repo text can contain irrelevant risk words that over-escalate. The design should assume risk keywords are useful only as escalation triggers, never as evidence of safety.

### 7. Compliance theater: HOLMES vocabulary without changed behavior

**Partially addressed.**

HOLMES vocabulary no longer authorizes mutation. Tier 2/3 requirements must be visible after classification, and the gate checks for TARGET/DELTA or full HOLMES phases plus evidence/delegation where required. That blocks the old “print marker, then mutate” attack.

The gap is that deterministic compliance checks can themselves become theater unless they are evidence-bound. “Factual claims in NOW must be supported by observed read/search/find/tool evidence” is correct, but it is the hard part. The implementation should require concrete references to observed tool results, paths, or tool-call IDs where feasible, not just the presence of the words TARGET/NOW/DELTA/NEXT.

### 8. Classifier blind spots from opaque or hard-to-normalize tool inputs

**Mostly addressed, with one key caveat.**

The design fails closed on uninspectable effects, treats shell/eval/resolve/broad AST rewrites conservatively, and requires exact opaque input hashes. That is the right baseline.

The caveat is that “inspectable” must mean more than “has a path.” A full-file `write` to one source file is inspectable syntactically but semantically broad. A narrow `edit` replacing one auth condition is inspectable but dangerous. For source-code mutation, Tier 1 requires semantic-preservation proof or a narrow safe operator, not just a concrete path and a non-risky summary.

### 9. Race/staleness attacks

**Addressed for conversation/scope staleness; incomplete for file-state staleness.**

The design binds records to user request digest, turn id, visible/thinking/tool-log digests, scope, tool, paths, mutation budget, and broader-scope announcements. That handles changed user requests, changed assistant framing, changed args, and scope expansion.

What is missing is explicit binding to observed file state. The design says the classifier does not read files and file contents enter only if already observed. That is acceptable for latency, but if a classification depends on a file or an edit anchor, the record should bind to the relevant observed file hash/anchor hash where available. External file drift between classification and mutation should invalidate or force reclassification for `write`, `ast_edit`, `resolve`, and opaque tools. Some direct `edit` anchors may fail on their own, but not every mutation surface has that protection.

### 10. Classifier shopping and result suppression

**Mostly addressed.**

All attempts are stored, overlapping scopes in the same user request are monotonic by maximum tier, and copied visible results do not matter. Reframing the same work should not lower the tier.

The residual bypass is scope slicing. A model can try to classify one small part at a time so that no individual record appears complex. The design partially counters this by including current-turn tool-log paths in the next classifier snapshot and by treating multiple files/modules as Tier 3. That must be enforced cumulatively across the whole current user request, including prior allowed mutations, blocked attempts, and classification attempts. If the cumulative path/module/aspect set grows, later “small” classifications should escalate.

---

## 2. New custom-tool-specific attack vectors

### Can the model game the tool's parameter inputs to influence classification downward?

**Partially. It cannot directly lower the final tier, but it can hide signals if the deterministic classifier relies on model-supplied scope or wording.**

The `maxTier(params.proposedTier, assessedTier)` rule prevents an explicit downgrade. Omitting risky terms, using `operationKind: "mechanical_code"`, minimizing `target.files`, or writing garbage reasoning should not be enough if the user request, observed text, tool log, and actual pending effect contradict it.

The gap is when the extension-observed state also lacks semantic evidence. Example: the model reads a file, notices an auth guard, plans to remove it, but visible reasoning says “small cleanup” and the tool log summary records only the path, not the relevant content. A regex classifier may see one source file, one edit, mechanical wording, no risk keywords, and approve Tier 1.

**Defense needed:** Tier 1 must not depend on model-provided `operationKind` or summary. It must be proven from concrete mutation shape. If the concrete diff cannot be proven non-semantic, minimum Tier 2; if it touches risk surfaces or unknown semantics, Tier 3.

### Can the model avoid calling the tool entirely, and what happens?

**Adequately handled if the gate covers every effectful tool before execution.**

The design says any mutation-capable tool without a current covering record is blocked with an instruction to call `holmes_classify`. Read-only tools remain allowed. That is correct.

The implementation risk is inventory/order, not concept. The gate must run before mutation for all effectful tools, unknown custom tools must default effectful, and no helper path may mutate outside the `tool_call` interception path.

### Can the model call the tool with minimal/garbage reasoning and still get Tier 1?

**Yes, and that is acceptable only for genuinely provable Tier 1 work.**

The schema requires non-empty reasoning, but low-information reasoning is inevitable. The design says the classifier then relies on observed state and may still return Tier 1 for plainly mechanical, single-file scope.

That is fine for cases where safety is objectively provable without model reasoning: a documentation typo, comment-only edit, whitespace-only formatting, exact non-source metadata update, or another closed-set operation. It is not fine for source-code token changes merely labeled as mechanical.

Garbage reasoning should lower confidence and narrow the envelope. It should never be the reason for Tier 1.

### Can the model split a complex task into many small Tier 1 classifications?

**Partially mitigated; needs a stronger cumulative-scope rule.**

The design has single-use Tier 1 records, mutation budgets, scope mismatch blocking, tool-log summaries, and multiple-file/module escalation. Those are good defenses.

The remaining attack is sequential slicing: classify/edit one file or one branch, then classify/edit another, each described as a small mechanical step. The design should make the classifier’s scope calculation cumulative over the current user request:

- paths planned in the new call;
- paths mentioned by the user;
- paths already read/edited in the turn;
- prior classification scopes;
- prior allowed and blocked mutation attempts;
- assistant-visible broader intent.

If the cumulative task is multi-file, multi-module, behavioral, or repeatedly mutating, later calls should not receive Tier 1 even if the next individual edit is small.

### Can the model use the tool's response to learn what signals trigger escalation, then avoid those signals?

**Yes. This is the main new red-team pressure point.**

The response returns rationale, risk flags, scope flags, and sometimes override reasons. That is valuable for auditability and model correction, but it teaches the model which words and scope shapes cause escalation. A motivated model can avoid saying “auth,” “security,” “migration,” “unknown,” or “tradeoff” in its own reasoning.

This is not fatal if safety is based on user request, paths, tool inputs, cumulative tool log, and concrete diff proof rather than model prose. It is fatal if absence of risky words is treated as evidence of Tier 1.

**Recommendation:** keep the response auditable, but do not rely on secrecy. Assume the model knows every rule. Tier 1 should still be safe under full rule knowledge.

### Can the model call `holmes_classify`, get Tier 2, then immediately call it again with different framing hoping for Tier 1?

**Mostly handled for overlapping scopes.**

The monotonic-overlap rule is the right defense: later calls in the same user request cannot lower the tier for overlapping scope unless the prior record expired due to a changed user request.

Two implementation details are critical:

1. The gate should consider all unexpired records that overlap the actual effect, not just the latest active record.
2. Broad prior risk should not be escaped by narrowing the second scope if the actual effect is part of the same user-requested work.

If the first Tier 2 was for `src/guards.ts`, a second call for the same file cannot downgrade it. If the first Tier 2/3 was for “update auth flow” and the second call says “edit one helper,” the helper should inherit the higher tier when the effect is within that broader request.

---

## 3. Deterministic classifier limitations

### What regex/heuristic classification will miss

A deterministic scanner will miss risks whose danger is semantic rather than lexical:

- removing or inverting authorization checks;
- weakening validation while keeping function names unchanged;
- changing crypto constants, randomness, key sizes, salts, rounds, modes, or comparison behavior without using obvious keywords;
- changing safety thresholds, rate limits, retry behavior, timeouts, circuit breakers, or resource limits;
- altering error handling from fail-closed to fail-open;
- changing transaction, locking, idempotency, or concurrency behavior;
- changing serialization/deserialization compatibility;
- changing public API behavior in a private-looking helper;
- modifying tests so they mask regressions;
- changing generated/config files whose names do not look risky;
- introducing data loss through a “cleanup” or “rename” operation;
- changing dependency versions with transitive security or runtime effects;
- modifying prompts/rules/hooks that change model behavior without looking like source-code risk.

Regexes are good at finding obvious escalation signals. They are poor at proving absence of risk.

### Can a subtle dangerous change slip through as Tier 1?

**Yes, under the design as written, unless Tier 1 is narrowed further.**

Examples that can look like one-file mechanical code edits:

- `if (!user.isAdmin) return forbidden()` becomes `if (user.isAdmin) return forbidden()`.
- `await verifySignature(payload)` is removed from a helper not named `auth`.
- `const ROUNDS = 12` becomes `const ROUNDS = 1` in `src/constants.ts`.
- `return secureCompare(a, b)` becomes `return a === b`.
- `catch { throw err }` becomes `catch { return defaultAllow }`.
- a migration helper changes `WHERE tenant_id = ?` to no tenant filter.

A risk-keyword approach may catch some if path/function names are obvious. It will miss others. The model can also avoid risky words in its own reasoning.

### Is the risk-keyword approach sufficient?

**No, not as an allow mechanism.**

Risk keywords are sufficient only as upward triggers. They should never contribute to a Tier 1 proof by their absence.

For a robust deterministic design, Tier 1 needs semantic-preservation constraints rather than risk-word absence. Acceptable Tier 1 categories should be closed and mechanically checkable. For source files, that likely means one of:

- no code-token change;
- AST-equivalent formatting/comment-only change;
- exact import sort/format generated by a known deterministic formatter with no semantic token changes;
- a very narrow, explicitly recognized transform whose before/after semantics are known to be safe.

Everything else in source code should be at least Tier 2, and risk-sensitive surfaces should be Tier 3.

---

## 4. Overall verdict

**Verdict: promising architecture, not yet robust enough to ship as written.**

I would accept the custom-tool direction. It is materially better than self-classification markers and solves the largest authority-boundary problems: marker spoofing, Task-courier tampering, steer-only classification, result suppression, broad turn-level leases, and many effectful-tool bypasses.

I would not accept the deterministic classifier rules as currently specified for production enforcement in a high-reliability environment. The residual under-classification risk is concentrated in one place: a subtle semantic source-code change can still look like a single-file mechanical action if the classifier lacks concrete diff semantics and relies on model-provided `operationKind`, summaries, path names, and risk keywords.

### Required before accepting

1. **Concrete-effect binding for every mutation tool.**
   Tier 1 records must bind to an exact normalized mutation fingerprint or deterministic safe operator. `exactOpaqueInput` is not enough; ordinary `edit`, `write`, and `ast_edit` need exact planned effect binding too.

2. **Narrow Tier 1 allowlist.**
   Tier 1 should be limited to mechanically provable non-semantic changes. Source-code token changes should default to Tier 2 unless a closed safe transform proves otherwise. Risk-sensitive paths/surfaces should force Tier 3.

3. **Cumulative scope ledger.**
   Classifications must account for prior reads, prior edits, prior blocked attempts, prior classification scopes, and assistant-visible broader intent in the same user request. Sequential slicing must escalate.

4. **File-state freshness.**
   Records should bind to observed file/anchor hashes when a classification depends on file state. Drift before mutation should invalidate or reclassify for tools that do not already enforce anchors.

5. **Opaque tools remain non-Tier-1.**
   Exact hashes for `bash`, `eval`, `task`, `browser`, `debug`, `github`, `resolve`, broad `ast_edit`, and unknown tools should provide single-use binding only, not Tier 1 safety.

6. **Evidence-bound Tier 2/3 compliance.**
   TARGET/NOW/DELTA/NEXT and full HOLMES checks should require references to observed tool evidence for factual claims, not just heading detection.

7. **Adversarial tests before rollout.**
   The test suite should cover all ten original attacks plus the new custom-tool attacks: parameter minimization, skipped tool call, garbage reasoning, repeated retry/reframing, sequential slicing, learned signal avoidance, stale file state, opaque command mismatch, and subtle semantic one-line changes.

### Residual risk after those changes

Even hardened, this system cannot prove cognition. It can enforce observable process, exact scope, and conservative escalation. That is still worth shipping: the goal should be to prevent cheap bypasses and force evidence on risky work, not to infer private intent.

With the required changes above, I would consider the design robust enough to replace the current self-classification marker gate. Without them, it is a strong enforcement shell around a classifier that can still be fooled by semantic changes disguised as mechanical edits.
