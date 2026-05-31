# `holmes_classify` custom tool design

## Verdict

Register `holmes_classify` as a model-callable checkpoint whose `execute` function is the only authority that creates classification records. The model supplies its proposed tier, plan, and HOLMES analysis as evidence. The extension treats that evidence as untrusted, cross-checks it against observed assistant text, the latest user request, prior tool calls, and extracted path/tool/risk signals, then stores an extension-owned record with a nonce and scope envelope. The mutation gate no longer reads `[CLASSIFY: Tier N]` markers as authorization; it allows mutation only when the pending tool call is covered by a current `holmes_classify` record and the tier-specific requirements are satisfied.

This is intentionally different from the older Task-courier design in the panel research: once `pi.registerTool()` is available, classification should not be routed through a session-authored Task prompt. The custom tool is faster, less gameable, and keeps the verdict in extension state from the start.

---

## 1. Tool registration code

### Placement

Add a small classification module, then wire it from `src/main.ts`:

- `src/classification.ts`: schema, state types, classifier algorithm, scope matching helpers, render helpers.
- `src/guards.ts`: replace `handleReasoningGuard` with `handleClassificationGate`.
- `src/main.ts`: create `classificationState`, register the tool, and pass shared state into the gate.

### TypeBox parameter schema

```ts
import { Type, type Static } from "@sinclair/typebox";
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
  ToolDefinition,
} from "@oh-my-pi/pi-coding-agent";

export const HOLMES_CLASSIFY_TOOL = "holmes_classify" as const;

const HolmesTierSchema = Type.Union([
  Type.Literal(1),
  Type.Literal(2),
  Type.Literal(3),
]);

const OperationKindSchema = Type.Union([
  Type.Literal("mechanical_text"),
  Type.Literal("mechanical_code"),
  Type.Literal("config_metadata"),
  Type.Literal("behavior_change"),
  Type.Literal("refactor"),
  Type.Literal("test"),
  Type.Literal("dependency"),
  Type.Literal("migration"),
  Type.Literal("deployment"),
  Type.Literal("security"),
  Type.Literal("data"),
  Type.Literal("unknown"),
]);

const PlannedActionSchema = Type.Object(
  {
    toolName: Type.String({ minLength: 1, maxLength: 80 }),
    paths: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
      maxItems: 64,
    }),
    operationKind: OperationKindSchema,
    summary: Type.String({ minLength: 1, maxLength: 2_000 }),

    // Required for opaque tools if the model wants them considered for the envelope.
    // The gate later compares the actual command/code/pattern exactly or by stable hash.
    exactOpaqueInput: Type.Optional(Type.String({ maxLength: 8_000 })),
  },
  { additionalProperties: false },
);

export const HolmesClassifyParamsSchema = Type.Object(
  {
    proposedTier: HolmesTierSchema,

    target: Type.Object(
      {
        summary: Type.String({ minLength: 1, maxLength: 4_000 }),
        files: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
          maxItems: 64,
        }),
        tools: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
          maxItems: 24,
        }),
        operationKind: OperationKindSchema,
        expectedMutationCount: Type.Optional(
          Type.Integer({ minimum: 0, maximum: 50 }),
        ),
      },
      { additionalProperties: false },
    ),

    reasoning: Type.String({ minLength: 1, maxLength: 12_000 }),

    holmes: Type.Optional(
      Type.Object(
        {
          target: Type.Optional(Type.String({ maxLength: 4_000 })),
          now: Type.Optional(Type.String({ maxLength: 4_000 })),
          delta: Type.Optional(Type.String({ maxLength: 4_000 })),
          next: Type.Optional(Type.String({ maxLength: 4_000 })),
          fullLoop: Type.Optional(
            Type.Object(
              {
                hone: Type.Optional(Type.String({ maxLength: 4_000 })),
                observe: Type.Optional(Type.String({ maxLength: 4_000 })),
                ladder: Type.Optional(Type.String({ maxLength: 4_000 })),
                map: Type.Optional(Type.String({ maxLength: 4_000 })),
                establish: Type.Optional(Type.String({ maxLength: 4_000 })),
                synthesize: Type.Optional(Type.String({ maxLength: 4_000 })),
              },
              { additionalProperties: false },
            ),
          ),
          knownFacts: Type.Optional(
            Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 32 }),
          ),
          assumptions: Type.Optional(
            Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 32 }),
          ),
          unknowns: Type.Optional(
            Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 32 }),
          ),
          tradeoffs: Type.Optional(
            Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 32 }),
          ),
        },
        { additionalProperties: false },
      ),
    ),

    plannedActions: Type.Array(PlannedActionSchema, { maxItems: 50 }),
  },
  { additionalProperties: false },
);

export type HolmesClassifyParams = Static<typeof HolmesClassifyParamsSchema>;
```

Design notes:

- `proposedTier` is accepted because a higher self-assessment may contain information the deterministic classifier does not see. It is never trusted for downgrades.
- `target.files`, `target.tools`, and `plannedActions` describe intended scope, but the gate later validates the actual tool call against the extension-created envelope.
- `exactOpaqueInput` exists for `bash`, `eval`, broad `ast_edit`, `resolve`, and other hard-to-normalize tools. Without an exact string/hash match, opaque tools are never covered by Tier 1 and are blocked unless Tier 2/3 explicitly authorizes an exact opaque action.
- `holmes` lets the model give useful analysis without making prose authoritative.

### Details returned and stored

```ts
type HolmesTier = 1 | 2 | 3;
type Confidence = "high" | "medium" | "low";

type ClassificationRequirement =
  | "NONE"
  | "TARGET_DELTA_BLOCK"
  | "TARGET_NOW_DELTA_NEXT_BLOCK"
  | "FULL_HOLMES_LOOP"
  | "RESOLVE_UNKNOWNS"
  | "DELEGATION_OR_RESEARCH_EVIDENCE";

interface ScopeEnvelope {
  paths: string[];
  tools: string[];
  operationKinds: string[];
  maxMutations: number;
  leaseKind: "exact" | "scope" | "blocked";
  exactOpaqueInputs: Record<string, string[]>; // toolName -> stable hashes or exact strings
  expiresOn: Array<
    | "new_user_turn"
    | "scope_mismatch"
    | "tool_mismatch"
    | "mutation_budget_consumed"
    | "requirements_unsatisfied"
    | "assistant_announces_broader_scope"
  >;
}

interface HolmesClassifyDetails {
  classificationId: string;
  nonce: string;
  toolCallId: string;
  proposedTier: HolmesTier;
  assessedTier: HolmesTier;
  tier: HolmesTier;
  confidence: Confidence;
  requirements: ClassificationRequirement[];
  scope: ScopeEnvelope;
  rationale: string;
  overrideReason?: string;
  signals: {
    tier1: string[];
    tier2: string[];
    tier3: string[];
    riskFlags: string[];
    scopeFlags: string[];
    holmesVocabulary: string[];
    sourceDigests: {
      userRequestDigest: string;
      visibleTextDigest: string;
      thinkingTextDigest: string;
      toolLogDigest: string;
    };
  };
}

interface ClassificationRecord extends HolmesClassifyDetails {
  source: "holmes_classify_tool";
  userRequestDigest: string;
  createdAtTurn: number;
  consumedMutations: number;
  createdAtMs: number;
  valid: boolean;
}
```

### Registration sketch

```ts
export function registerHolmesClassifyTool(args: {
  pi: ExtensionAPI;
  observation: () => MessageObservationState;
  classification: HolmesClassificationState;
  turn: HolmesTurnMetadata;
  toolLog: HolmesToolCallLog;
  stats: HolmesStats;
}): void {
  args.pi.registerTool<
    typeof HolmesClassifyParamsSchema,
    HolmesClassifyDetails
  >({
    name: HOLMES_CLASSIFY_TOOL,
    label: "HOLMES classify",
    description: [
      "Validate your HOLMES classification before any mutation.",
      "Call this after your initial analysis and before edit/write/ast_edit/resolve/bash/eval/task/browser/debug/github or any other mutation-capable tool.",
      "Provide your proposed tier, reasoning, target files, planned tools, and HOLMES analysis.",
      "The extension will independently classify from observed state and may raise the tier.",
      "Use the returned tier, requirements, and approved scope exactly; mutations outside the returned scope need a new classification.",
    ].join(" "),
    parameters: HolmesClassifyParamsSchema,
    hidden: false,
    defaultInactive: false,
    async execute(
      toolCallId: string,
      params: HolmesClassifyParams,
      signal: AbortSignal | undefined,
      _onUpdate: AgentToolUpdateCallback<HolmesClassifyDetails> | undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<HolmesClassifyDetails>> {
      signal?.throwIfAborted?.();

      const snapshot = buildClassificationSnapshot({
        params,
        observation: args.observation(),
        turn: args.turn,
        toolLog: args.toolLog,
      });

      const decision = classifySnapshot(snapshot, params);
      const record = makeClassificationRecord(toolCallId, snapshot, decision);

      args.classification.history.push(record);
      args.classification.active = mergeWithPriorOverlappingTier(
        record,
        args.classification.active,
      );
      args.stats.classificationsCreated++;

      return {
        content: [{ type: "text", text: renderClassificationForModel(record) }],
        details: record,
      };
    },
  });
}
```

`mergeWithPriorOverlappingTier` prevents classifier shopping: if the latest record overlaps a prior active scope in the same user turn, the stored tier is the maximum of the two unless the prior record expired because of a new user request.

---

## 2. Classification algorithm pseudocode

### Snapshot assembly

```ts
interface ClassificationSnapshot {
  turnId: number;
  userRequest: string;
  userRequestDigest: string;
  visibleText: string;
  thinkingText: string;
  visibleTextDigest: string;
  thinkingTextDigest: string;
  toolCallsSoFar: ToolCallSummary[];
  toolLogDigest: string;

  pathsFromUserRequest: string[];
  pathsFromVisibleText: string[];
  pathsFromToolLog: string[];
  pathsFromParams: string[];
  toolsFromParams: string[];
  operationKindsFromParams: string[];
  exactOpaqueInputs: Record<string, string[]>;
}

function buildClassificationSnapshot(input): ClassificationSnapshot {
  const visible = limit(input.observation.visibleText, MAX_SCAN_CHARS);
  const thinking = limit(input.observation.thinkingText, MAX_SCAN_CHARS);
  const paramsText = stringifyBounded(input.params, 24_000);

  return {
    turnId: input.turn.turnId,
    userRequest: input.turn.latestUserRequest,
    userRequestDigest: stableHash(input.turn.latestUserRequest),
    visibleText: visible,
    thinkingText: thinking,
    visibleTextDigest: stableHash(visible),
    thinkingTextDigest: stableHash(thinking),
    toolCallsSoFar: summarizeToolLog(input.toolLog.currentTurn),
    toolLogDigest: stableHash(summarizeToolLog(input.toolLog.currentTurn)),

    pathsFromUserRequest: extractPathMentions(input.turn.latestUserRequest),
    pathsFromVisibleText: extractPathMentions(visible),
    pathsFromToolLog: extractPathsFromToolCalls(input.toolLog.currentTurn),
    pathsFromParams: extractPathMentions(paramsText),
    toolsFromParams: extractTools(input.params),
    operationKindsFromParams: extractOperationKinds(input.params),
    exactOpaqueInputs: hashOpaqueInputs(input.params.plannedActions),
  };
}
```

The snapshot is bounded and deterministic. No classifier path reads files or spawns agents. File contents enter only if already observed by normal `read`/`search`/`find` tool results and summarized into `toolLog`/observation state.

### Signal extraction

```ts
function classifySnapshot(snapshot, params): ClassificationDecisionDraft {
  const evidenceText = joinForFeatureExtraction([
    snapshot.userRequest,
    snapshot.visibleText,
    snapshot.thinkingText, // diagnostic only; never required for compliance
    params.reasoning,
    params.holmes?.target,
    params.holmes?.now,
    params.holmes?.delta,
    params.holmes?.next,
    params.holmes?.fullLoop?.hone,
    params.holmes?.fullLoop?.observe,
    params.holmes?.fullLoop?.ladder,
    params.holmes?.fullLoop?.map,
    params.holmes?.fullLoop?.establish,
    params.holmes?.fullLoop?.synthesize,
    ...(params.holmes?.assumptions ?? []),
    ...(params.holmes?.unknowns ?? []),
    ...(params.holmes?.tradeoffs ?? []),
  ]);

  const paths = stableUnique([
    ...snapshot.pathsFromParams,
    ...snapshot.pathsFromVisibleText,
    ...snapshot.pathsFromToolLog,
  ]);

  const userPaths = stableUnique(snapshot.pathsFromUserRequest);
  const plannedPaths = stableUnique(snapshot.pathsFromParams);
  const plannedTools = stableUnique(snapshot.toolsFromParams);
  const operationKinds = stableUnique(snapshot.operationKindsFromParams);

  const riskFlags = detectRiskFlags(snapshot.userRequest + "\n" + evidenceText);
  const unknownFlags = detectUnknownsOrVerificationNeeds(evidenceText, params);
  const tradeoffFlags = detectTradeoffs(evidenceText, params);
  const holmesFlags = detectHolmesVocabulary(evidenceText);
  const behavioralFlags = detectBehavioralChange(snapshot.userRequest, operationKinds, evidenceText);
  const scopeFlags = detectScopeFlags({ paths, userPaths, plannedPaths, plannedTools });
  const opaqueToolFlags = detectOpaqueToolFlags(plannedTools, params.plannedActions);

  const tier3Signals = [];
  const tier2Signals = [];
  const tier1Signals = [];
```

### Tier rules

```ts
  if (scopeFlags.multipleFiles || scopeFlags.multipleModules) {
    tier3Signals.push("multiple files/modules/subsystems in planned or observed scope");
  }
  if (riskFlags.some(isTier3Surface)) {
    tier3Signals.push("security/auth/crypto/data/deployment/migration/safety surface");
  }
  if (scopeFlags.noConcreteMutationScope) {
    tier3Signals.push("no concrete approved mutation scope can be built");
  }
  if (unknownFlags.researchNeeded || unknownFlags.unresolvedDependencies) {
    tier3Signals.push("model or request mentions unresolved research/verification/dependency need");
  }
  if (opaqueToolFlags.uninspectableMutation) {
    tier3Signals.push("planned tool has opaque side effects without exact input binding");
  }
  if (isBroadOrAmbiguousRequest(snapshot.userRequest)) {
    tier3Signals.push("user request is broad or ambiguous");
  }

  if (scopeFlags.multipleAspectsSingleModule) {
    tier2Signals.push("multiple aspects of one module/system");
  }
  if (behavioralFlags.nonTrivialLogic || behavioralFlags.userRequestedBehaviorChange) {
    tier2Signals.push("non-trivial logic or behavioral change");
  }
  if (tradeoffFlags.hasAlternatives || tradeoffFlags.hasTradeoffs) {
    tier2Signals.push("reasoning mentions alternatives/tradeoffs/design choice");
  }
  if (operationKinds.some(isTier2OperationKind)) {
    tier2Signals.push("operation kind requires design judgment");
  }

  const tier1Candidate =
    paths.length === 1 &&
    plannedPaths.length === 1 &&
    isClearlyMechanical(operationKinds, evidenceText, snapshot.userRequest) &&
    !riskFlags.some(isTier3Surface) &&
    !unknownFlags.any &&
    !tradeoffFlags.any &&
    !behavioralFlags.nonTrivialLogic &&
    !scopeFlags.scopeMismatch &&
    !opaqueToolFlags.any;

  if (tier1Candidate) {
    tier1Signals.push("single concrete file");
    tier1Signals.push("mechanical operation");
    tier1Signals.push("no unknowns/tradeoffs/risk surfaces detected");
  }

  const assessedTier: HolmesTier = tier3Signals.length > 0
    ? 3
    : tier2Signals.length > 0
      ? 2
      : tier1Candidate
        ? 1
        : 3; // fail closed when the classifier cannot prove Tier 1/2

  const finalTier = maxTier(params.proposedTier, assessedTier);
```

Tier 1 is a closed set. The classifier must prove every Tier 1 condition. Tier 2 and Tier 3 are trigger-based. Unknown or unclassifiable input is Tier 3, not Tier 1.

### Requirements and envelope

```ts
  const requirements = requirementsFor(finalTier, {
    unknownFlags,
    tier3Signals,
    riskFlags,
  });

  const scope = buildScopeEnvelope({
    finalTier,
    assessedTier,
    paths: plannedPaths,
    plannedTools,
    operationKinds,
    exactOpaqueInputs: snapshot.exactOpaqueInputs,
    requestedMutationCount: params.target.expectedMutationCount,
    plannedActionCount: params.plannedActions.length,
  });

  return {
    assessedTier,
    tier: finalTier,
    confidence: confidenceFor(finalTier, tier1Signals, tier2Signals, tier3Signals),
    requirements,
    scope,
    rationale: summarizeSignals(tier1Signals, tier2Signals, tier3Signals),
    overrideReason: finalTier > params.proposedTier
      ? `Raised from Tier ${params.proposedTier} because ${highestPrioritySignal(tier2Signals, tier3Signals)}.`
      : undefined,
    signals: { tier1: tier1Signals, tier2: tier2Signals, tier3: tier3Signals, riskFlags, scopeFlags, holmesVocabulary: holmesFlags },
  };
}
```

`requirementsFor`:

- Tier 1: `[]` / `NONE`.
- Tier 2: `TARGET_DELTA_BLOCK` and preferably `TARGET_NOW_DELTA_NEXT_BLOCK` before mutation. The gate checks visible assistant text after this classification call.
- Tier 3: `FULL_HOLMES_LOOP`, `RESOLVE_UNKNOWNS`, and `DELEGATION_OR_RESEARCH_EVIDENCE` when risk/unknown flags indicate external research or multi-scope validation is needed.

`buildScopeEnvelope`:

- Tier 1:
  - `leaseKind: "exact"`.
  - Exactly one concrete path.
  - Allowed tools: normally `edit`; `write` only for clearly mechanical non-source/documentation creation or replacement if the exact path is the single approved path; never `bash`, `eval`, broad `ast_edit`, or uninspectable `resolve`.
  - `maxMutations: 1` unless the planned actions are an explicit tiny mechanical batch over the same file; default remains 1.
- Tier 2:
  - `leaseKind: "scope"` after requirements are satisfied.
  - Paths must be explicit and same-module/same-system.
  - Allowed tools are structured mutation tools (`edit`, `write`, narrow `ast_edit`) over the explicit path set.
  - Opaque tools require exact input hashes and stay single-use.
- Tier 3:
  - `leaseKind: "scope"` only if the approved path set is explicit; otherwise `"blocked"` until a new classification supplies concrete scope after research.
  - Allows broader tool set only after full HOLMES requirements are visible and any delegation/research evidence is observed.
  - Opaque tools are exact-input only.


---

## 3. Tool return value

The tool returns both human-readable `content` and machine-readable `details`. The gate uses only the extension-stored `ClassificationRecord`, but returning the same data in `details` makes the decision auditable in tool output.

Example Tier 2 response:

```ts
{
  content: [
    {
      type: "text",
      text: [
        "HOLMES classification HCLS-7f3c9a: Tier 2.",
        "Proposed Tier 1 was raised: non-trivial behavioral change in one module.",
        "Before mutation: provide TARGET/DELTA, preferably TARGET/NOW/DELTA/NEXT.",
        "Approved scope: edit/write/narrow ast_edit on src/guards.ts only; maxMutations=1.",
        "Expires on new user turn, scope mismatch, tool mismatch, or mutation budget consumption."
      ].join("\n")
    }
  ],
  details: {
    classificationId: "HCLS-7f3c9a",
    nonce: "extension-generated-random",
    toolCallId,
    proposedTier: 1,
    assessedTier: 2,
    tier: 2,
    confidence: "high",
    requirements: ["TARGET_DELTA_BLOCK", "TARGET_NOW_DELTA_NEXT_BLOCK"],
    scope: {
      paths: ["src/guards.ts"],
      tools: ["edit", "write", "ast_edit"],
      operationKinds: ["behavior_change"],
      maxMutations: 1,
      leaseKind: "scope",
      exactOpaqueInputs: {},
      expiresOn: ["new_user_turn", "scope_mismatch", "tool_mismatch", "mutation_budget_consumed"]
    },
    rationale: "The request changes guard behavior rather than performing a mechanical edit.",
    overrideReason: "Raised from Tier 1 because behavioral change requires design validation.",
    signals: { ... }
  }
}
```

The returned text should be collaborative and terse. It should never accuse the model of lying; it should explain which observable signal drove the tier and what to do next.

The returned `classificationId`/`nonce` is not something the model can copy into a later tool call to bypass the gate. The gate verifies the record from extension memory, not user-visible text.

---

## 4. Gate integration design

### Current behavior being replaced

Current `handleReasoningGuard` opens mutation when `hasVisibleClassification(observation)` is true. That means a visible marker such as `[CLASSIFY: Tier 1]` authorizes all later `edit`, `write`, `ast_edit`, `resolve`, or `bash` calls in the turn. It does not validate tier correctness, scope, tool, paths, or Tier 2/3 artifacts.

### New tool-call gate

```ts
function handleClassificationGate(args: {
  event: ToolCallEvent;
  observation: MessageObservationState;
  classification: HolmesClassificationState;
  turn: HolmesTurnMetadata;
  toolLog: HolmesToolCallLog;
  delegation: DelegationState;
}): ToolCallEventResult | undefined {
  recordToolCallAttempt(args.toolLog, args.event);

  if (args.event.toolName === HOLMES_CLASSIFY_TOOL) {
    return undefined;
  }

  if (isReadOnlyTool(args.event.toolName)) {
    return undefined;
  }

  if (!isEffectfulTool(args.event.toolName)) {
    // Unknown custom tools are effectful by default unless explicitly allowlisted.
    return blockUnknownTool(args.event.toolName);
  }

  const effect = summarizePendingEffect(args.event);
  if (!effect.inspectable) {
    return blockNeedsClassificationOrInspectableTool(effect);
  }

  const record = args.classification.active;
  if (!record || !record.valid) {
    return blockNoClassification(args.event, effect);
  }

  const stale = validateClassificationFreshness(record, args.turn, args.observation);
  if (!stale.ok) {
    expire(record, stale.reason);
    return blockStaleClassification(stale.reason, effect);
  }

  const coverage = classificationCoversEffect(record.scope, effect);
  if (!coverage.ok) {
    return blockScopeMismatch(record, effect, coverage.reason);
  }

  const missing = missingTierRequirements({
    record,
    observation: args.observation,
    delegation: args.delegation,
    toolLog: args.toolLog,
  });
  if (missing.length > 0) {
    return blockMissingRequirements(record, missing);
  }

  consumeMutationBudget(record, effect);
  return undefined;
}
```

### Effectful tool policy

Read-only allowlist:

- `read`
- `search`
- `find`
- `ast_grep`
- `web_search`
- `holmes_classify`

Effectful by default:

- `edit`
- `write`
- `ast_edit`
- `resolve` when applying a pending action
- `bash`
- `eval`
- `task`
- `debug`
- `browser`
- `github`
- `generate_image`
- any unknown custom tool

`eval` is effectful because it can call `write()`, `append()`, filesystem APIs, subprocess APIs, or shell commands. `task` is effectful because subagents can mutate unless separately constrained and classified. Subagents do not inherit parent classifications.

### Scope matching

`classificationCoversEffect` checks:

1. `record.userRequestDigest === currentUserRequestDigest`.
2. `event.toolName` is in `scope.tools`.
3. Extracted affected paths are a non-empty subset of `scope.paths`.
4. Operation class is compatible with `scope.operationKinds`.
5. `record.consumedMutations < scope.maxMutations`.
6. For Tier 1 exact leases, the pending tool input/effect fingerprint matches the planned action fingerprint or exact single-path structured edit envelope.
7. For opaque tools, actual command/code/pattern/staged action hash matches `scope.exactOpaqueInputs[event.toolName]`.
8. The assistant has not announced broader scope after classification; if it has, block until reclassified.

Mismatch means block, not fallback to an older lower-tier record.

### Tier requirement checks

Tier 2 visible requirement check:

- The assistant text after the classification result contains a bounded block with `TARGET` and `DELTA`; recommended: `TARGET`, `NOW`, `DELTA`, `NEXT`.
- Factual claims in `NOW` must be supported by observed read/search/find/tool evidence when they are used to justify mutation.

Tier 3 visible requirement check:

- The assistant text after classification contains full HOLMES phases: Hone, Observe, Ladder, Map, Establish, Synthesize.
- Any unknown flagged by the classifier is explicitly resolved or marked non-blocking with evidence.
- If the record requires delegation/research evidence, `toolLog` contains the required read-only `task`/research/delegation event or equivalent observed tool evidence.
- No mutation is allowed while a blocking unknown remains visible.

### Event ordering in `src/main.ts`

Recommended order:

1. `context`: capture latest user request and digest; reset classification only when the user request digest changes.
2. `turn_start`: increment turn counters; reset primitive burst; do not accidentally preserve a classification across a new user request.
3. `before_agent_start`: append updated HOLMES prompt.
4. `message_update` / `message_end`: update observation; no visible marker opens the gate.
5. `tool_call`:
   - record tool call attempt;
   - primitive burst guard;
   - delegation/TTSR guard;
   - classification gate before any effectful mutation;
   - `holmes_classify` is explicitly exempt and allowed.
6. `tool_result`: append verify reminder for real mutations; update tool log summaries if needed.

---

## 5. System prompt changes

Replace the marker contract in `src/prompts.ts`. The new system prompt should say:

```text
# HOLMES Classification Checkpoint

Before any mutation-capable tool call, complete the HOLMES cognitive redirect silently or visibly as appropriate, then call `holmes_classify` with:
- your proposed tier;
- the target and planned operation;
- target files and tools;
- concise reasoning;
- any TARGET/NOW/DELTA/NEXT or full HOLMES analysis you have already done.

The `holmes_classify` tool validates your classification from extension-observed state. Its returned tier, requirements, and scope are authoritative. Your own tier label and visible markers are advisory and do not unlock mutation.

If the tool returns Tier 1, proceed only within the returned scope.
If it returns Tier 2, produce the required TARGET/DELTA or TARGET/NOW/DELTA/NEXT block before mutating.
If it returns Tier 3, complete the full HOLMES loop, resolve unknowns, and perform required research/delegation before mutating.

If a mutation is blocked for missing classification, call `holmes_classify` next. Do not fight the gate; treat it as a calibration partner that protects the task scope.

In print/non-interactive mode, call `holmes_classify` early after initial analysis so the classification is ready before the first mutation.
```

Keep the existing Layer 0 and HOLMES loop content, but remove these old claims:

- visible `[CLASSIFY: Tier N]` marker is required to open the gate;
- Tier 1 fast path is to print `[CLASSIFY: Tier 1]` and proceed;
- hidden thinking/tool arguments do not count for the marker gate.

Visible reasoning remains useful for the human and for Tier 2/3 compliance, but the gate key is now the extension-owned classification record.

---

## 6. State management

### New extension state

```ts
interface HolmesClassificationState {
  active?: ClassificationRecord;
  history: ClassificationRecord[];
  latestUserRequestDigest: string;
  latestUserRequest: string;
  turnId: number;
}

interface HolmesTurnMetadata {
  turnId: number;
  latestUserRequest: string;
  latestUserRequestDigest: string;
  startedAtMs: number;
  isPrintMode?: boolean;
}

interface HolmesToolCallLog {
  currentTurn: ToolCallSummary[];
}

interface ToolCallSummary {
  toolCallId?: string;
  toolName: string;
  inputDigest: string;
  affectedPaths: string[];
  operationClass: string;
  effectful: boolean;
  allowed?: boolean;
  blockedReason?: string;
  timestampMs: number;
}
```

### Reset and invalidation

Reset active classification on:

- new user request digest;
- user interrupt or explicit new turn with changed request;
- scope mismatch;
- tool mismatch;
- path expansion beyond envelope;
- Tier 1 mutation consumed;
- mutation budget consumed;
- opaque input hash mismatch;
- classifier rule version change;
- assistant announces broader scope after classification.

Do not reset merely because an internal agent continuation happens after a tool result. The unit of validity is current user request plus classifier-issued scope envelope, not every provider loop iteration.

### Multiple calls

Every `holmes_classify` call creates an independent record with a new nonce. The latest record is active. For overlapping scopes in the same user request, the active tier is monotonic: a later call cannot reduce the required tier below a prior active overlapping record unless the prior record expired because the user request changed. This removes classifier-shopping value while preserving the user's requirement that repeated calls are independent and latest matching scope wins.

### Source of truth

Only `ClassificationRecord.source === "holmes_classify_tool"` records stored by `execute` can authorize mutation. Assistant text, hidden thinking, tool arguments, copied JSON, and visible markers are telemetry/compliance evidence only.

---

## 7. Edge cases and failure modes

### Model never calls `holmes_classify`

Gate blocks every mutation-capable tool with a short message:

```text
[HOLMES classifier gate] Mutation blocked: no current `holmes_classify` record covers edit src/foo.ts. Call `holmes_classify` with proposed tier, reasoning, planned files/tools, then retry within the returned scope.
```

Read-only tools remain allowed.

### Model calls `holmes_classify` multiple times

Each call gets a new nonce and record. Latest active matching scope is used, with monotonic tier protection for overlapping records. Non-overlapping records do not authorize each other.

### Minimal or empty reasoning

The schema requires non-empty `reasoning`, but it can still be low information. The classifier then relies on observed state. If observed request/scope is plainly mechanical and single-file, Tier 1 may still be possible. If scope or operation cannot be proven mechanical, it escalates to Tier 3 or returns a blocked envelope.

### Mutation between classification and intended edit

Every effectful tool call is checked. A classification for `edit src/a.ts` does not cover `bash`, `write src/b.ts`, `task`, or a different `ast_edit`. The gate blocks and requests reclassification.

### Print mode (`omp -p`)

The custom tool still runs normally. Prompting should make the model call it early. If the model fails to call it, the same gate blocks mutation with an actionable diagnostic; print mode must not soften enforcement. Because `execute` is local deterministic code, the added latency is a single normal tool call rather than an external classifier round trip.

### Subagents / Task

Subagents do not inherit the parent `ClassificationRecord` because their extension instance and state are separate. Parent `task` calls are effectful unless the task is explicitly read-only and covered by a classification envelope. A subagent that mutates must call its own `holmes_classify` in its own session.

### `bash` / `eval`

Never Tier 1 by default. They are approved only when the classification envelope contains an exact command/code hash and the tier requirements are satisfied. If effect extraction is incomplete, classify Tier 3 or block until the model uses a more inspectable direct tool.

### `resolve`

`resolve.apply` is mutation-capable. It can be allowed only if the pending action id and staged diff/payload hash are observable and covered by the envelope. If not observable, block or Tier 3; do not Tier 1 it.

### Broad `ast_edit`

A glob or pattern rewrite whose match count/path set is unknown is Tier 3 or blocked. A narrow single-file structural rewrite may be Tier 2 if paths and operation are explicit. Tier 1 only for an exact, mechanical, single-file rewrite with known path and no semantic risk.

### Classifier execution error

If `execute` throws or returns malformed details, no record is stored. The gate fails closed. The returned tool error should instruct the model to retry `holmes_classify` with concrete scope or simplify the planned mutation into inspectable direct tools.

---

## 8. How the design addresses Adversary's top attack vectors

1. **Session-controlled classifier input laundering**
   - Params are untrusted. The tool cross-checks latest user request, visible/thinking observation, tool log, path mentions, and risk keywords. The gate validates actual pending tool effects against the returned envelope.

2. **Turn-level Tier 1 lease reused for later mutations**
   - Records are scope-bound, tool-bound, path-bound, mutation-count-bound, and expire on mismatch. Tier 1 is normally single-use exact scope.

3. **Effectful-tool laundering through `eval`, `bash`, package scripts, or delegated agents**
   - Effectful set expands beyond current `MUTATING_TOOLS` to include `eval`, `task`, browser/debug/github/generate/custom tools. Opaque tools require exact input hashes and usually Tier 3.

4. **Session-as-courier tampering with Task classifier prompts**
   - Classification no longer uses Task as the authority path. The model calls a registered custom tool whose `execute` function is extension-owned code. Task calls are separate effectful actions.

5. **Steer-only classification by the same session model**
   - Steers and visible text do not authorize mutation. Only records created inside `holmes_classify.execute` count.

6. **Prompt injection against the classifier**
   - There is no model classifier prompt to inject. User/repo/session text is scanned deterministically as untrusted data. Params cannot force a downgrade.

7. **Compliance theater with HOLMES vocabulary**
   - HOLMES vocabulary is a signal and compliance artifact, not an authority. Tier 2/3 gates require observable blocks/evidence after the authoritative classification.

8. **Opaque or hard-to-normalize tool inputs**
   - Conservative default: uninspectable effect means Tier 3 or blocked. Shell/eval/resolve/broad AST rewrites are exact-hash or no approval.

9. **Race/staleness attacks**
   - Records bind to user request digest, turn id, source digests, scope, tool, paths, and mutation budget. New user request, scope change, path expansion, or opaque input mismatch invalidates.

10. **Classifier shopping and result suppression**
   - All attempts are stored. Latest active scope wins, but overlapping scopes are monotonic by maximum tier. The model cannot pick an older favorable record or lower a prior active risk assessment.

---

## 9. Latency analysis

### Hot path cost

`holmes_classify.execute` performs bounded string scanning, path extraction, stable hashing, and small-array set operations over already observed state. It does not read files, spawn agents, or run shell commands. CPU work is proportional to bounded text limits (`MAX_SCAN_CHARS` for visible/thinking text plus schema-bounded params), so execution should be negligible compared with an LLM tool round trip.

### User-perceived cost

- Tier 1: one extra tool call before mutation. No external classifier latency and no visible ritual beyond the tool result.
- Tier 2: one tool call plus the model emits TARGET/DELTA or TARGET/NOW/DELTA/NEXT before mutation.
- Tier 3: one tool call plus full HOLMES/research/delegation as required by the returned record.

This fits the panel latency principle: spend almost no classifier latency on mechanical changes, and spend process time only when risk signals justify it.

### Retry behavior

If the model follows the prompt and calls `holmes_classify` before mutating, there is no blocked mutation retry. If it skips the tool, the first mutation-capable call blocks once with a clear instruction, then succeeds after a matching classification and retry.

### Print mode

The deterministic custom tool is safer for print mode than Task-courier classification because it does not require waiting on a subagent or human-visible multi-turn ceremony. If the model fails to call it, print mode still fails closed with a diagnostic rather than allowing unclassified mutation.

---

## 10. Integration summary by file

### `src/main.ts`

- Create `classificationState` and `toolLog` closures next to `observationState`.
- Register `holmes_classify` before event handlers.
- Add a `context` handler to capture latest user request and digest.
- Stop setting `reasoningState.hasReasoned` from visible markers.
- Replace `handleReasoningGuard` with `handleClassificationGate`.
- Update `/holmes-status` counters with active classification id/tier/scope and classification count.

### `src/types.ts`

- Add classification state, record, requirement, scope, effect summary, and tool-log types.
- Replace narrow `MUTATING_TOOLS` with `READ_ONLY_TOOLS` and `EFFECTFUL_TOOLS`; unknown tools default effectful.
- Keep `CLASSIFY_MARKER` only for telemetry/backward compatibility, not gate authorization.

### `src/observation.ts`

- Keep bounded visible/thinking accumulation.
- Add helpers:
  - `redactSelfClassification(text)` for any diagnostic classifier context;
  - `extractPathMentions(text)`;
  - `detectTier2Compliance(text, classificationCreatedAt)`;
  - `detectTier3Compliance(text, classificationCreatedAt)`;
  - `detectAssistantBroadenedScope(text, record)`.
- `hasVisibleClassification` becomes diagnostic only.

### `src/guards.ts`

- Keep primitive burst, delegation guard, and verify reminder.
- Add effect extraction and classification gate helpers.
- Ensure `holmes_classify` is exempt from mutation gating but still logged.
- Gate must run before any mutation-capable tool executes.

### `src/prompts.ts`

- Replace visible marker gate language with the collaborative classification checkpoint language above.
- Keep Layer 0 and Tier 2/3 HOLMES loop instructions.
- Explain that the tool may raise the tier and that the returned scope is binding.

---

## 11. Relationship to other HOLMES layers

1. **System prompt drives behavior.** The prompt teaches the model to reason backward and call `holmes_classify` as the natural checkpoint before mutation.
2. **`holmes_classify` validates and authorizes.** The tool turns observed state plus untrusted model analysis into an extension-owned classification record.
3. **TTSR/rules catch drift.** Existing primitive-burst and tool-discipline rules still nudge the model when it starts forward-chaining or using poor tool paths.
4. **Gate enforces.** `tool_call` is the hard boundary; it blocks mutation without a valid record and satisfied tier requirements.
5. **Observation provides telemetry.** `message_update`/`message_end` feed the classifier and compliance checks, but observed text is never the authorization source.

Each layer should reduce pressure on the next one: a good prompt makes tool calls timely, the tool makes tier/scoping explicit, TTSR catches mid-stream drift, and the gate fires only when the previous layers failed or scope changed.
