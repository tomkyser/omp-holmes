# UX & latency review: `holmes_classify` custom tool design

## Verdict

The custom tool design is a strong UX/latency improvement over the earlier external classifier design and a necessary safety improvement over visible self-classification markers. Its deterministic `execute` path should be effectively free compared with model/tool orchestration. The remaining UX cost is not classifier computation; it is the extra visible tool-call boundary before mutation.

That trade is acceptable for Tier 1 only if the UI makes the checkpoint nearly invisible: collapsed call, terse result, no bulky JSON by default, no red-error styling for normal gate recovery, and no block/retry churn in print mode. Without that polish, users doing typo/config edits will experience HOLMES as ceremony even though the algorithm is fast.

## 1. Latency analysis

### Comparison to original latency budgets

My original budgets were added latency from HOLMES classification:

| Tier | Original target | Hard ceiling | Requirement |
| --- | ---: | ---: | --- |
| Tier 1 | p50 < 1s, p95 < 2s | 3s | Feel like a normal tool pause; no visible multi-turn ceremony |
| Tier 2 | p50 2-3s, p95 <= 5s | 7s | Acceptable reasoning checkpoint |
| Tier 3 | p50 5-8s, p95 <= 10s | 15s | Acceptable for high-risk work |

The proposed `holmes_classify.execute` path is much cheaper than the original hybrid `quick_task`/`oracle` classifier recommendation:

- no model call;
- no Task/subagent call;
- no file reads;
- no shell/process startup;
- bounded string scanning, path extraction, hashing, and small set operations only.

So the classifier algorithm itself should fit comfortably inside the Tier 1 latency budget. The design spends its latency budget on the one thing that remains unavoidable: the model/tool loop boundary.

### User-perceived cost

From the user's perspective the sequence is:

1. model analyzes the request;
2. model calls `holmes_classify`;
3. local deterministic tool returns immediately;
4. model continues and mutates if the returned scope permits it.

The user-perceived pause is therefore the agent runtime's tool-call round trip plus the model continuation, not the classifier's CPU work. That is still more than the old marker path, but it should feel like a normal lightweight tool call if rendered correctly.

### Is the extra tool call acceptable for Tier 1?

Yes, with UI constraints:

- The Tier 1 call/result must be visually collapsed or single-line by default.
- The model should call it early, before attempting mutation, so the user sees one smooth pause instead of an error/retry.
- The result should authorize a narrow exact scope and then get out of the way.

If Tier 1 renders as a full tool card containing the whole `reasoning`, `target`, and `plannedActions` payload, the perceived cost will exceed the actual latency cost. Users will not distinguish "fast deterministic safety check" from "HOLMES is making simple edits noisy."

### Old marker design vs new tool design

| Dimension | Old self-classify marker | New `holmes_classify` tool |
| --- | --- | --- |
| Added runtime overhead | Essentially zero | One tool-call boundary; local execute is negligible |
| Visual overhead | One visible marker line | Tool call/result unless collapsed |
| Security | Gameable; model opens its own gate | Extension-owned record opens the gate |
| Scope control | Turn-level marker can authorize unrelated later mutations | Nonce/scope/tool/path/mutation-bound record |
| Tier correctness | Model assertion | Deterministic classifier can raise tier |
| Print mode | Fast, but unsafe | Slightly more orchestration; safer fail-closed behavior |

The new design is the right trade. The old path optimized for speed by trusting the adversary. The new path pays one orchestration boundary to move authority into extension state.

## 2. User experience

### How the tool call appears

The design registers the tool with `hidden: false` and label `HOLMES classify`. Unless OMP collapses custom tools by default, users will likely see a normal tool card.

That is acceptable for Tier 2/3 and too noisy for Tier 1 if the raw call arguments or full details are shown. The schema includes potentially large fields (`reasoning` up to 12k, HOLMES blocks, up to 50 planned actions). Exposing those by default would make a typo fix look like process theater.

Recommendation: keep an expandable audit trail, but make the default rendering compact.

### Does the workflow feel natural?

The flow `analyze → classify → mutate` is natural. It matches the user's mental model that the system should pause before changing files, not after. It is also cleaner than the old marker ritual because the model is not asked to print magic words as authorization.

The important prompt nuance is that Tier 1 should not become visible ceremony. For trivial work, the natural flow should be:

```text
[collapsed] HOLMES: Tier 1 · edit README.md allowed
edit/write happens
```

not:

```text
I will now classify...
<large tool call>
<large tool result>
I have classified...
```

### What the user sees when classification raises the tier

The proposed result text is good in principle:

```text
HOLMES classification HCLS-7f3c9a: Tier 2.
Proposed Tier 1 was raised: non-trivial behavioral change in one module.
Before mutation: provide TARGET/DELTA...
```

That is clear and non-accusatory. The UX should preserve exactly that tone: the tool is a calibration partner, not a scolding mechanism.

Two refinements:

1. Put the override reason in the default collapsed result, not only in expandable details.
2. Include the next required action in plain language:
   - `Raised to Tier 2: behavior change in src/guards.ts. Need TARGET/DELTA before edit.`
   - `Raised to Tier 3: broad/unknown scope. Need full HOLMES loop and research/delegation evidence.`

### What the user sees when the gate blocks missing classification

The block message in the design is actionable:

```text
[HOLMES classifier gate] Mutation blocked: no current `holmes_classify` record covers edit src/foo.ts. Call `holmes_classify` with proposed tier, reasoning, planned files/tools, then retry within the returned scope.
```

That is correct for the model, but user-facing presentation matters. If this appears as a red tool failure for normal recovery, users will read it as the system breaking. Prefer a guard/checkpoint style:

```text
HOLMES needs a classification before editing src/foo.ts. The agent should classify and retry within the approved scope.
```

Use error styling only when the session cannot recover automatically or the same mutation repeats without an intervening classification.

## 3. Friction analysis

### Simple typo fix

Expected visible steps with good rendering:

1. Model may say a short intent or directly call the tool.
2. Collapsed `HOLMES: Tier 1 · exact edit allowed` checkpoint.
3. Edit tool call.
4. Verification/read if required by normal workflow.

The user sees one extra checkpoint compared with the old marker design. They should not need to act, approve, or read a HOLMES block.

Expected visible steps with poor rendering:

1. Model explains it must classify.
2. Full `holmes_classify` JSON input appears.
3. Multi-line classification result appears.
4. Model restates the result.
5. Edit happens.

That would feel disproportionate for a typo fix and would create disable pressure.

### Complex refactor

For a complex refactor, the ceremony is proportional to risk. Tier 2/3 already require reasoning, research, scoping, and verification. A visible classification checkpoint helps because it tells the user why the work is being slowed down and what evidence is required before mutation.

The design is especially good here because it can raise a too-optimistic proposed tier and bind the approved scope. That makes the UX more predictable: the user sees the system constrain broad work before files change, rather than after a risky mutation.

### Will users disable HOLMES because of classify-tool overhead?

Not because of deterministic execution. They may disable it if any of these happen:

- Tier 1 tool calls render as verbose audit logs.
- The first mutation often blocks because the model forgot to classify.
- Print mode exits with a guard error for simple requests that should have auto-recovered.
- Repeated scope mismatches create loops of similar HOLMES messages.
- Every small edit consumes a separate visible checkpoint instead of using a narrow same-file envelope where safe.

The design already addresses much of this with exact/scope leases and clear block reasons. The missing UX-critical piece is custom rendering plus bounded retry behavior.

## 4. Print mode

### Does `omp -p "fix typo"` work smoothly?

It should, if the prompt reliably makes the model call `holmes_classify` before its first mutation. The tool itself is well-suited to print mode because it is local deterministic code, not a Task classifier or external model round trip.

The smooth path is:

```text
model calls holmes_classify → Tier 1 exact scope → edit/write → verify → final answer
```

No human interaction is required.

### Infinite block-retry risk

There is a real non-interactive risk if the model fails to adapt after a block:

1. model attempts `edit`;
2. gate blocks for missing classification;
3. model retries the same `edit` without calling `holmes_classify`;
4. gate blocks again;
5. loop continues until runtime limits stop it.

There is also a scope-mismatch loop risk:

1. model classifies `README.md`;
2. model edits `src/main.ts`;
3. gate blocks mismatch;
4. model reclassifies too narrowly or retries the wrong edit;
5. repeat.

Print mode needs explicit loop brakes:

- Track repeated classification-gate blocks per turn and per pending effect fingerprint.
- If the same effect is blocked twice without an intervening successful `holmes_classify`, fail closed with one concise diagnostic.
- If a classification exists but scope mismatch repeats, fail closed after a bounded number of mismatches and report the approved scope vs attempted scope.
- Do not keep launching duplicate classifier calls for the same fingerprint.

Failing closed is acceptable. An infinite or long block/retry loop is not.

## 5. Recommendations

### 1. Collapse Tier 1 classifications by default

Yes. Tier 1 should be minimized in the UI.

Default Tier 1 rendering should be no more than:

```text
HOLMES Tier 1 · exact edit allowed: README.md
```

or even:

```text
HOLMES checked · Tier 1
```

with path/tool details available on expansion. Do not show full reasoning, full params, nonce, hashes, or signals unless the user expands the audit view.

### 2. Add custom `renderCall` / `renderResult`

Yes. This is the most important UX requirement in the design.

Recommended default renderings:

#### Call

```text
HOLMES checking scope before mutation…
```

For Tier 1-like planned scope, avoid showing raw JSON.

#### Tier 1 result

```text
HOLMES Tier 1 · edit README.md · 1 mutation allowed
```

#### Raised result

```text
HOLMES raised to Tier 2 · behavior change in src/guards.ts · TARGET/DELTA required
```

#### Tier 3 / blocked result

```text
HOLMES Tier 3 · broad/unknown scope · full HOLMES loop and evidence required before mutation
```

#### Gate block

```text
HOLMES checkpoint needed before editing src/foo.ts. Classify, then retry within the approved scope.
```

Keep the full `details` object inspectable for audit/debugging, but not as the default visual surface.

### 3. Instrument user-perceived latency

Add counters/timestamps around the checkpoint, not just classifier creation:

- time from model tool call received to tool result returned;
- time from classification result to first allowed mutation;
- number of missing-classification blocks;
- number of scope-mismatch blocks;
- number of repeated blocks in print mode;
- percentage of Tier 1 requests that classify before first mutation attempt.

The classifier's CPU time should be tiny; the product risk is orchestration friction. Measure that directly.

### 4. Make normal recovery look like progress, not failure

A missing classification block should be framed as a checkpoint the agent can satisfy, not as an error the user must fix. Reserve failure/error language for unrecoverable print-mode exits, malformed classifier results, or repeated loops.

### 5. Keep Tier 1 exact, but avoid one checkpoint per microscopic same-file edit when safe

The design's Tier 1 default of one exact mutation is safe. The allowed exception for an explicit tiny mechanical batch over the same file is important for UX. Use it for cases like multiple typo replacements in one README, but keep the criteria closed and deterministic.

### 6. Do not hide raised tiers

Tier 1 should collapse. Tier raises should be visible. If HOLMES changes the model's proposed Tier 1 to Tier 2/3, the user should see the reason because that is where the system spends extra time.

### 7. Print mode must have bounded retries

Before shipping this path, validate `omp -p "fix typo"` under two scenarios:

1. compliant model: calls `holmes_classify` first;
2. non-compliant model: attempts mutation first.

The first should complete smoothly. The second should either recover once or fail closed with a single actionable diagnostic. It must not loop.

## Bottom line

Adopt the custom tool design. It satisfies the original latency principle better than the Task-courier classifier because the classifier is local deterministic code. The only UX danger is visual and orchestration friction from an extra tool boundary. Solve that with collapsed Tier 1 rendering, custom renderers, concise override reasons, and bounded print-mode retries.