# UX & Latency Recommendation: External HOLMES Classifier

## Verdict

Use an **extension-owned hybrid classifier**:

1. Start a lightweight pre-classification as early as possible from the user request and current turn context.
2. At the **first mutation-capable `tool_call`**, require an extension-owned classifier decision bound to the concrete pending mutation fingerprint.
3. Use **`quick_task` by default**, with deterministic routing/escalation to **`oracle`** for ambiguity, safety-sensitive work, broad scope, or dangerous tools.
4. Cache only extension-owned decisions, scoped to an exact mutation fingerprint or to a classifier-issued narrow envelope.

The Tier 1 fast path exists, but it is the **classifier's** fast path. The session agent never opens the gate by claiming `[CLASSIFY: Tier 1]`.

If OMP cannot invoke or force a Task/classifier from extension-owned state, do not emulate this with session-agent prose. A steer/follow-up that asks the same session model to self-report a classification is not objective. In that case, use a sidecar/provider call owned by the extension, or fail closed until the platform provides an extension-owned classifier invocation path.

## 1. Latency budget per tier

Budgets below are added latency from HOLMES classification, not total task runtime.

| Classified tier | Target added latency | Hard ceiling before degrading UX | UX requirement |
| --- | ---: | ---: | --- |
| Tier 1: trivial/mechanical | p50 < 1s, p95 < 2s | 3s | Should feel like a normal tool pause. No visible multi-turn ceremony. |
| Tier 2: non-trivial single-scope | p50 2-3s, p95 <= 5s | 7s | Acceptable as a reasoning checkpoint; show what is being checked. |
| Tier 3: multi-scope/safety-sensitive | p50 5-8s, p95 <= 10s | 15s | Acceptable because work is high-risk; prefer correctness over speed. |

Design implication: **never run `oracle` for every mutation**. A 5-15s classifier on typo/config edits will make users disable HOLMES. The system should spend latency only when the classifier sees real risk.

## 2. Recommended classifier agent type

### Primary: hybrid router

Use a cheap deterministic router before model classification:

- Route directly to **`quick_task`** for normal pending edits/writes where the requested effect is bounded.
- Route directly to **`oracle`** when the pending mutation has strong Tier 3 signals:
  - security/auth/permissions/crypto/secrets/payment/health/safety language;
  - multi-subsystem or architectural language;
  - broad `bash`, `eval`, generated-code, migration, dependency, or bulk rewrite operations;
  - tool input whose effect set cannot be statically summarized.
- Escalate from `quick_task` to **`oracle`** when quick_task returns low confidence, Tier 3, an envelope too broad to enforce safely, or a reason containing unresolved assumptions.

This avoids serial quick_task -> oracle delay for obvious high-risk work while keeping the common path fast.

### Classifier output contract

The classifier result must be structured and stored by the extension, not inferred from assistant text:

```json
{
  "nonce": "extension-generated",
  "fingerprint": "canonical pending mutation hash",
  "tier": 1,
  "confidence": "high",
  "decision": "allow",
  "envelope": {
    "tools": ["edit"],
    "paths": ["README.md"],
    "operationClass": "typo_or_mechanical_text_fix",
    "expiresOnTurn": 42,
    "maxMutations": 1
  },
  "requirements": []
}
```

For Tier 2/3 the `requirements` field should name the required HOLMES process evidence, e.g. TARGET/NOW/DELTA/NEXT or full Hone/Observe/Ladder/Map/Establish/Synthesize plus delegation.

### Gate behavior

At `tool_call` for any mutation-capable tool:

1. Compute a canonical fingerprint from:
   - turn id;
   - latest user request digest;
   - bounded visible assistant context digest;
   - tool name;
   - canonicalized tool input;
   - effect summary: paths, action type, command class, diff/content hash where available;
   - classifier prompt/rule version;
   - extension-generated nonce.
2. If an extension-owned decision matches the fingerprint or its explicit envelope, allow.
3. If no matching decision exists, block immediately with a clear HOLMES classification-pending reason and start/continue classifier work.
4. On classifier completion, store the decision in extension state and nudge the model to retry.
5. If the retry's tool/input differs outside the envelope, discard the decision and reclassify.

Exact retries should not reclassify. Changed args should.

## 3. UX patterns to reduce perceived wait

### Pre-classify early, but treat it as provisional

Start a quick pre-classification from the user message before the session agent reaches mutation. This can often finish while the model is reading or planning. It may predict likely tier and likely scope, but it must not authorize mutation by itself unless the eventual tool call matches the classifier-approved envelope.

Good use:

- User: "Fix the typo in README." Preclassifier likely returns Tier 1 for `README.md` mechanical text edit.
- First edit call touches only `README.md` with a typo-sized diff. Gate allows immediately if the fingerprint/envelope matches.

Bad use:

- User asks for a typo fix, but pending tool call rewrites `src/main.ts`. The preclassification must not apply.

### Use the first mutation as the natural pause point

The user already expects a pause before files change. Make that pause explicit:

- UI notification: `HOLMES is classifying the pending edit...`
- Block reason: `Classification pending for edit README.md; retry after HOLMES decision.`
- Follow-up/steer when ready: `HOLMES classified the pending edit as Tier 1; retry the exact edit.`

Do not make the agent print a fake classification ritual. The visible marker can remain for human legibility, but it must not open the gate.

### Cache the task envelope, not the agent's claim

Same-turn work should not pay classifier latency for every small edit. The classifier may authorize a narrow envelope:

- Tier 1: usually one exact mutation, or a small mechanical batch over explicit files already present in the pending payload.
- Tier 2: bounded file set and operation class after required TARGET/NOW/DELTA/NEXT evidence is present.
- Tier 3: explicit multi-scope envelope after full HOLMES loop and delegation requirements are satisfied.

Invalidate the cache on:

- new user message or user interrupt;
- changed tool input outside the envelope;
- new file/path/scope outside the envelope;
- mutation-capable `bash`/`eval` not included in the envelope;
- classifier rule/prompt version change;
- timeout or turn boundary.

### Avoid retry churn

If the classifier is still running, repeated exact retries should return the same short pending message rather than launching duplicate classifiers. The extension should keep one in-flight classifier per fingerprint.

When the decision arrives, send a steer/follow-up that tells the model the decision is ready. In interactive mode, the user should see one coherent pause, not a loop of blocked tool errors.

### Show useful work during wait

While waiting, the session agent can continue non-mutating work:

- read nearby context;
- explain the intended verification;
- prepare TARGET/DELTA for Tier 2/3;
- ask no user question unless classification reveals a genuine ambiguity.

But it must not mutate until the extension-owned decision allows it.

## 4. Print mode / non-interactive recommendations

Classification should still happen in `omp -p` and other non-interactive modes. The difference is UX: there is no human available to tolerate a block/retry loop.

Recommended print-mode behavior:

1. Start user-request preclassification before the model begins tool use.
2. At mutation-capable `tool_call`, use an extension-owned classifier path that can complete without requiring the human to re-run the command.
3. If the only available mechanism is block-and-retry, the extension must provide an automatic continuation/steer when the classifier result is ready; otherwise print mode should fail closed with a clear reason.
4. Use slightly larger ceilings because there is no interactive typing flow to interrupt:
   - Tier 1: <= 3s;
   - Tier 2: <= 7s;
   - Tier 3: <= 15s, fail closed on timeout.
5. Never soften enforcement in print mode just to avoid latency. A non-interactive mutation is still a mutation.

If current OMP cannot resume after a blocked tool in print mode, that is a platform constraint to fix. The safe fallback is not "allow unclassified mutation"; it is "block with actionable diagnostic."

## 5. When to skip classification entirely

Skip classification only when no project mutation is possible.

Allowed skips:

- read-only tools such as `read`, `search`, `find`;
- extension-owned classifier Task/tool calls themselves;
- status/help commands that do not change project state;
- deterministic discard/no-op operations proven not to mutate files or pending actions.

Do not skip classification for:

- `edit`, `write`, `ast_edit`, or `resolve apply`;
- `bash`, even when the command looks harmless, unless HOLMES has a separate read-only shell sandbox/parser with a formally tiny whitelist;
- `eval` or any tool capable of filesystem writes;
- browser/debug operations that can change local app/project state;
- repeated mutations merely because the session agent says they are part of the same task.

The safe rule: **read-only can skip; mutation-capable must be classified or covered by an extension-owned classifier envelope.**

## Cache key recommendation

Use two layers:

### Exact decision key

```text
classifierVersion
+ turnId
+ userMessageDigest
+ assistantVisibleDigest
+ toolName
+ canonicalToolInputHash
+ effectSummaryHash
+ nonce
```

This allows exact retry with zero extra classifier latency.

### Envelope key

```text
classifierVersion
+ turnId
+ userMessageDigest
+ approvedTier
+ approvedToolSet
+ approvedPathSet
+ operationClass
+ requirementsSatisfiedDigest
+ nonce
```

The envelope must be issued by the classifier, not inferred by the session agent. Tier 1 envelopes should be narrow and short-lived. Tier 2/3 envelopes can be broader only when the required HOLMES reasoning/delegation evidence is present and extension-observed.

## Implementation note for current OMP constraints

`message_update` is useful for observing visible assistant text, but it is not a hard interruption surface. Hard enforcement belongs at `tool_call`.

`sendUserMessage(..., { deliverAs: "steer" })` is good for nudging the model after a decision arrives, but it is not the source of truth. The source of truth is extension state containing a nonce-bound classifier result.

If classifier output must pass through the normal assistant as prose, the session agent can spoof it. Bind every classifier decision to an extension-generated nonce and pending mutation fingerprint, and store it out-of-band in extension state before allowing mutation.
