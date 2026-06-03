import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export const HOLMES_CLASSIFY_TOOL = "holmes_classify" as const;
export const HOLMES_RULE_VERSION = "holmes-classify-v1" as const;
export const LLM_ASSESSOR_PROMPT_VERSION = "holmes-impact-assessor-v1" as const;
export const LLM_ASSESSOR_SCHEMA_VERSION = "holmes-impact-assessor-output-v1" as const;

export type HolmesTier = 1 | 2 | 3 | 4;
export type Confidence = "high" | "medium" | "low";
export type LeaseKind = "exact" | "scope" | "blocked";

export type RuntimeSurface =
  | "none"
  | "presentation"
  | "application_logic"
  | "authz"
  | "data_persistence"
  | "crypto"
  | "external_api"
  | "deployment"
  | "concurrency"
  | "agent_guardrail"
  | "unknown";

export type OperationKind =
  | "mechanical_text"
  | "mechanical_code"
  | "config_metadata"
  | "behavior_change"
  | "refactor"
  | "test"
  | "dependency"
  | "migration"
  | "deployment"
  | "security"
  | "data"
  | "unknown";

export type OperationClass =
  | "prose_edit"
  | "comment_edit"
  | "whitespace_format"
  | "source_behavior"
  | "source_refactor"
  | "test_add"
  | "test_weaken"
  | "config_runtime"
  | "dependency"
  | "schema_migration"
  | "deploy_ci"
  | "agent_guardrail"
  | "opaque"
  | "unknown";

export type EvidenceKind =
  | "user_request"
  | "assistant_text"
  | "tool_call"
  | "tool_result"
  | "file_snapshot"
  | "model_assessor"
  | "classification_record"
  | "gate_block";

export type EvidenceSource = "visible_text" | "thinking";

export interface EvidenceRef {
  kind: EvidenceKind;
  digest: string;
  path?: string;
  toolCallId?: string;
  classificationId?: string;
  excerpt?: string;
  observedAtMs?: number;
  sequence?: number;
}

export interface HolmesEvidence {
  tier?: HolmesTier;
  marker?: string;
  source: EvidenceSource;
  matchedAt: number;
  hasLayer0Terms: boolean;
}

export interface PrimitiveBurstState {
  burst: number;
  lastTool?: string;
}

export interface DelegationState {
  researchDelegatedThisTurn: boolean;
  verificationDelegatedThisTurn: boolean;
  taskCallsThisTurn: number;
  blockedTaskCalls: number;
}

export interface MessageObservationState {
  turnIndex: number;
  visibleByIndex: Map<number, string>;
  thinkingByIndex: Map<number, string>;
  visibleText: string;
  thinkingText: string;
  visibleEvidence?: HolmesEvidence;
  thinkingEvidence?: HolmesEvidence;
}

export type ImpactSignalKind =
  | "hard_floor"
  | "hard_ceiling"
  | "soft_signal"
  | "missing_proof";

export type ImpactSignalSource =
  | "path"
  | "tool"
  | "effect"
  | "ledger"
  | "intent"
  | "file_type"
  | "syntax"
  | "model_params"
  | "assistant_text"
  | "model_assessor";

export interface ImpactSignal {
  id: string;
  kind: ImpactSignalKind;
  source: ImpactSignalSource;
  tierFloor?: HolmesTier;
  tierCeiling?: HolmesTier;
  reason: string;
  evidenceRefs: EvidenceRef[];
}

export interface ImpactFloor {
  tier: HolmesTier;
  reason: string;
  source: ImpactSignalSource;
  evidenceRefs: EvidenceRef[];
  overridableByModel: boolean;
}

export type RiskKind =
  | "auth_security_change"
  | "crypto_secret_change"
  | "data_migration_change"
  | "deploy_infra_change"
  | "export_contract_change"
  | "public_docs_contract_change"
  | "test_evidence_weakening"
  | "guard_validation_weakening"
  | "safety_control_change"
  | "concurrency_change"
  | "opaque_tool_unbounded"
  | "scope_slicing"
  | "intent_effect_mismatch"
  | "unknown_surface"
  | "other";

export interface RiskProsecutorRisk {
  kind: RiskKind;
  severity: "low" | "medium" | "high";
  evidenceIds: string[];
  explanation: string;
  missingEvidence: string[];
  confidence: "low" | "medium" | "high";
}

export interface RiskProsecutorUnsupportedClaim {
  claimId: string;
  reason: string;
  neededEvidence: string[];
}

export interface RiskProsecutorAssessment {
  status: "completed" | "timeout" | "error" | "skipped";
  risks: RiskProsecutorRisk[];
  unsupportedClaims: RiskProsecutorUnsupportedClaim[];
  requiredChecks: string[];
  promptInjectionSeen: boolean;
  prosecutorFloors: ImpactFloor[];
  prosecutorProofObligations: string[];
}

export interface ImpactCeiling {
  tier: HolmesTier;
  reason: string;
  certificate:
    | "docs_prose_only"
    | "comment_only"
    | "whitespace_only"
    | "ast_equivalent"
    | "non_executable_metadata"
    | "exact_safe_operator";
  evidenceRefs: EvidenceRef[];
}

export type EvidenceCertificateKind =
  | "whitespace_only"
  | "comment_only"
  | "docs_prose_only"
  | "blank_line_only"
  | "ast_equivalent"
  | "exports_unchanged"
  | "references_bounded"
  | "local_only";

export interface EvidenceCertificate {
  kind: EvidenceCertificateKind;
  tierSupport: HolmesTier[];
  subjectPaths: string[];
  subjectSymbols: string[];
  evidenceRefs: EvidenceRef[];
  computedFrom: {
    exactPatchDigest?: string;
    exactContentDigest?: string;
    preimageDigests: Record<string, string>;
    postimageDigests: Record<string, string>;
  };
  limitations: string[];
}

export interface LexicalRiskHint {
  id: string;
  kind: string;
  matchedTerms: string[];
  source: "user_request" | "assistant_text" | "params" | "planned_summary" | "path" | "patch_payload";
  tierSuggestion: HolmesTier;
  quarantined: boolean;
}

export interface FailedProofObligation {
  tierBlockedAt: HolmesTier;
  obligation: string;
  reason: string;
  evidenceRefs: EvidenceRef[];
}

export interface IntentEnvelope {
  requestedObject: string[];
  requestedOperation: string[];
  requestedEffect: string;
  constraints: string[];
  nonGoals: string[];
  ambiguity: "clear" | "ambiguous" | "conflicting";
}

export type IntentAlignment =
  | { status: "aligned"; evidenceRefs: EvidenceRef[] }
  | { status: "partial"; missingOrExtra: string[]; evidenceRefs: EvidenceRef[] }
  | { status: "mismatch"; reason: string; floor: HolmesTier; evidenceRefs: EvidenceRef[] }
  | { status: "unknown"; missingProof: string[] };

export interface ImpactAssessment {
  receivedEffect: string;
  affectedSystems: string[];
  runtimeSurfaces: RuntimeSurface[];
  downstreamBoundary:
    | "none"
    | "single_module"
    | "single_system"
    | "cross_system"
    | "unknown";
  predictability:
    | "proven_null"
    | "predictable"
    | "bounded_uncertain"
    | "unbounded_or_unknown";
  intentAlignment: IntentAlignment;
  floors: ImpactFloor[];
  ceilings: ImpactCeiling[];
  signals: ImpactSignal[];
  evidenceRefs: EvidenceRef[];
  missingProof: FailedProofObligation[];
}

export interface ImpactStepDownProof {
  fromTier: HolmesTier;
  toTier: HolmesTier;
  impactQuestion: "bounded" | "predictable" | "null";
  ok: boolean;
  evidenceRefs: EvidenceRef[];
  excludedImpactRisks: string[];
  objectiveFloors: ImpactFloor[];
  missingProof: FailedProofObligation[];
  invalidatesOn: InvalidationReason[];
}

export type ClassificationRequirement =
  | "NONE"
  | "TARGET_DELTA_VISIBLE"
  | "TARGET_NOW_DELTA_NEXT_VISIBLE"
  | "FULL_HOLMES_PASS_ONCE"
  | "TIER4_ITERATIVE_CLOSURE"
  | "RESOLVE_FLAGGED_UNKNOWNS"
  | "EVIDENCE_REFERENCES_REQUIRED"
  | "RESEARCH_OR_DELEGATION_EVIDENCE"
  | "EXACT_EFFECT_MATCH_REQUIRED"
  | "LOCAL_VERIFICATION_PLAN";

export type InvalidationReason =
  | "new_user_request"
  | "scope_mismatch"
  | "tool_mismatch"
  | "effect_mismatch"
  | "opaque_input_mismatch"
  | "mutation_budget_consumed"
  | "requirements_unsatisfied"
  | "assistant_announced_broader_scope"
  | "file_state_drift"
  | "rule_version_changed"
  | "verification_failed"
  | "classification_error"
  | "hard_floor_discovered_at_gate"
  | "tier4_not_at_fixed_point";

export interface ScopeEnvelope {
  paths: string[];
  tools: string[];
  operationKinds: OperationKind[];
  maxMutations: number;
  leaseKind: LeaseKind;
  exactOpaqueInputs: Record<string, string[]>;
  effectFingerprints: string[];
  fileSnapshotDigests: Record<string, string>;
  expiresOn: InvalidationReason[];
}

export interface MutationLease {
  leaseId: string;
  classificationId: string;
  tier: HolmesTier;
  leaseKind: LeaseKind;
  paths: string[];
  tools: string[];
  operationClasses: OperationClass[];
  maxMutations: number;
  consumedMutations: number;
  effectFingerprints: string[];
  exactOpaqueInputs: Record<string, string[]>;
  fileStateFingerprints: Record<string, string>;
  expiresOn: InvalidationReason[];
}

export interface OpenUnknown {
  id: string;
  text: string;
  source: "classifier" | "model_params" | "tool_log" | "user_request" | "llm_assessor";
  blocking: boolean;
  resolvedByEvidenceRefs: EvidenceRef[];
}

export interface ClassificationProcessState {
  status:
    | "mutation_ready"
    | "tier2_requirements_pending"
    | "tier3_pass_required"
    | "tier4_looping"
    | "blocked_no_concrete_lease";
  openUnknowns: OpenUnknown[];
  passCountAfterClassification: number;
  closureSatisfied: boolean;
  requiredEvidence: string[];
}

export type ProcessState = ClassificationProcessState;

export interface LlmImpactAssessment {
  attempted: boolean;
  used: boolean;
  status:
    | "not_needed"
    | "succeeded"
    | "timeout"
    | "unavailable"
    | "malformed"
    | "error";
  modelId?: string;
  promptVersion: string;
  outputSchemaVersion: string;
  recommendedTier?: Exclude<HolmesTier, 1>;
  confidence?: Confidence;
  predictedBehaviorChange?: string;
  affectedSystems?: string[];
  downstreamEffects?: string[];
  uncertainty?: Confidence;
  requiredVerification?: string[];
  citedEvidence?: string[];
  rawOutputDigest?: string;
  errorMessage?: string;
  durationMs?: number;
}

export interface SourceDigests {
  userRequestDigest: string;
  visibleTextDigest: string;
  thinkingTextDigest: string;
  toolLogDigest: string;
  fileContextDigest?: string;
}

export interface ClassificationRecord {
  classificationId: string;
  nonce: string;
  toolCallId: string;
  source: "holmes_classify_tool";
  ruleVersion: string;
  proposedTier: HolmesTier;
  assessedTier: HolmesTier;
  tier: HolmesTier;
  createdAtMs: number;
  createdAtTurn: number;
  createdAtSequence: number;
  userRequestDigest: string;
  sourceDigests: SourceDigests;
  paramsDigest: string;
  impact: ImpactAssessment;
  intent: IntentEnvelope;
  proofDown: ImpactStepDownProof[];
  requirements: ClassificationRequirement[];
  process: ClassificationProcessState;
  scope: ScopeEnvelope;
  lease: MutationLease;
  consumedMutations: number;
  valid: boolean;
  invalidatedBy?: InvalidationReason;
  llmAssessment?: LlmImpactAssessment;
  riskProsecutorAssessment?: RiskProsecutorAssessment;
  rationale: string;
}

export interface PendingToolEffect {
  toolCallId: string;
  toolName: string;
  inputDigest: string;
  inputFingerprint: string;
  effectFingerprint: string;
  affectedPaths: string[];
  operationClass: OperationClass;
  inspectable: boolean;
  opaque: boolean;
  exactOpaqueInput?: string;
  mutationCount: number;
  fileStateFingerprints: Record<string, string>;
  summary: string;
  hardFloors: ImpactFloor[];
}

export interface ToolCallSummary {
  toolCallId: string;
  toolName: string;
  inputDigest: string;
  inputFingerprint: string;
  effectFingerprint?: string;
  affectedPaths: string[];
  operationClass: OperationClass;
  effectful: boolean;
  inspectable: boolean;
  allowed?: boolean;
  blockedReason?: string;
  timestampMs: number;
}

export interface HolmesToolCallLog {
  currentTurn: ToolCallSummary[];
  byUserRequestDigest: Map<string, ToolCallSummary[]>;
  lastEffectFingerprint?: string;
  repeatedBlockCount: number;
}

export interface ScopedFloorEntry {
  tier: HolmesTier;
  reason: string;
  source: "effect" | "path" | "tool" | "ledger" | "intent" | "model_params";
  paths: string[];
  classificationId: string;
  objective: boolean;
  supersededBy?: string;
}

export interface CumulativeScopeLedger {
  userRequestDigest: string;
  pathsMentioned: string[];
  pathsRead: string[];
  pathsSearched: string[];
  pathsFound: string[];
  pathsMutated: string[];
  toolsUsed: string[];
  priorClassifications: string[];
  priorTierFloor: HolmesTier;
  scopedFloors: ScopedFloorEntry[];
  blockedEffects: string[];
  allowedEffects: string[];
  verificationFailures: string[];
  broadenedScopeEvents: EvidenceRef[];
  openUnknowns: OpenUnknown[];
  impactSignals: ImpactSignal[];
}

export interface HolmesClassificationState {
  activeProcess?: ClassificationRecord;
  activeLease?: MutationLease;
  history: ClassificationRecord[];
  leases: Map<string, MutationLease>;
  ledgerByRequest: Map<string, CumulativeScopeLedger>;
  latestUserRequest: string;
  latestUserRequestDigest: string;
  turnId: number;
  sequence: number;
  ruleVersion: string;
  lastGateBlockByEffect: Map<string, number>;
}

export interface HolmesTurnMetadata {
  turnId: number;
  latestUserRequest: string;
  latestUserRequestDigest: string;
  startedAtMs: number;
  isPrintMode?: boolean;
}

export interface ClassificationGateState {
  classification: HolmesClassificationState;
  turn: HolmesTurnMetadata;
  toolLog: HolmesToolCallLog;
  repeatedBlockLimit: number;
}

export interface FileSnapshotSummary {
  path: string;
  digest: string;
  bytesRead: number;
  truncated: boolean;
  fileRole: RuntimeSurface | "docs" | "test" | "config" | "source" | "unknown";
  excerpt?: string;
}

export interface ClassificationSnapshot {
  ruleVersion: string;
  turnId: number;
  sequence: number;
  userRequest: string;
  userRequestDigest: string;
  visibleText: string;
  thinkingText: string;
  visibleTextDigest: string;
  thinkingTextDigest: string;
  toolCallsSoFar: ToolCallSummary[];
  toolLogDigest: string;
  ledger: CumulativeScopeLedger;
  pathsFromUserRequest: string[];
  pathsFromVisibleText: string[];
  pathsFromToolLog: string[];
  pathsFromParams: string[];
  toolsFromParams: string[];
  operationKindsFromParams: OperationKind[];
  exactOpaqueInputs: Record<string, string[]>;
  fileSnapshots: FileSnapshotSummary[];
}

export interface ProveDownResult {
  assumedTier: 4;
  deterministicTier: HolmesTier;
  assessedTier: HolmesTier;
  finalTier: HolmesTier;
  proposedTier: HolmesTier;
  impact: ImpactAssessment;
  intent: IntentEnvelope;
  proofDown: ImpactStepDownProof[];
  requirements: ClassificationRequirement[];
  scope: ScopeEnvelope;
  lease: MutationLease;
  floors: ImpactFloor[];
  ceilings: ImpactCeiling[];
  missingProof: FailedProofObligation[];
  llmAssessment?: LlmImpactAssessment;
  riskProsecutorAssessment?: RiskProsecutorAssessment;
  rationale: string;
}

export interface HolmesClassifyStructuredEditEffect {
  kind: "edit";
  path: string;
  exactPatch: string;
  semanticClassClaim?: string;
}

export interface HolmesClassifyStructuredWriteEffect {
  kind: "write";
  path: string;
  exactContent: string;
  replacementClassClaim?: string;
}

export interface HolmesClassifyStructuredAstEditEffect {
  kind: "ast_edit";
  paths: string[];
  exactOps: string;
  expectedMatchCount?: number;
}

export type HolmesClassifyStructuredEffect =
  | HolmesClassifyStructuredEditEffect
  | HolmesClassifyStructuredWriteEffect
  | HolmesClassifyStructuredAstEditEffect;

export interface HolmesClassifyPlannedAction {
  toolName: string;
  paths: string[];
  operationKind: OperationKind;
  summary: string;
  exactOpaqueInput?: string;
  structuredEffect?: HolmesClassifyStructuredEffect;
}

export interface HolmesClassifyImpactParams {
  userIntentSummary: string;
  intendedReceivedEffect: string;
  predictedBehaviorChange: string;
  affectedSystems: string[];
  downstreamEffects: string[];
  contractChanges: string[];
  dataEffects: string[];
  safetySecurityEffects: string[];
  reversibility: "trivial" | "bounded" | "difficult" | "unknown";
  confidence: Confidence;
  assumptions: string[];
  unknowns: string[];
}

export interface HolmesClassifyIntentAlignmentParams {
  claimedAlignment: "aligned" | "partial" | "mismatch" | "unknown";
  explanation: string;
}

export interface HolmesClassifyHolmesParams {
  target?: string;
  now?: string;
  delta?: string;
  next?: string;
  fullLoop?: {
    hone?: string;
    observe?: string;
    ladder?: string;
    map?: string;
    establish?: string;
    synthesize?: string;
  };
  knownFacts?: string[];
  assumptions?: string[];
  unknowns?: string[];
  tradeoffs?: string[];
}

export interface HolmesClassifyParams {
  proposedTier: HolmesTier;
  target: {
    summary: string;
    files: string[];
    tools: string[];
    operationKind: OperationKind;
    expectedMutationCount?: number;
  };
  impact?: HolmesClassifyImpactParams;
  intentAlignment?: HolmesClassifyIntentAlignmentParams;
  reasoning: string;
  holmes?: HolmesClassifyHolmesParams;
  plannedActions: HolmesClassifyPlannedAction[];
}

export interface HolmesClassifyDetails {
  classificationId: string;
  nonce: string;
  proposedTier: HolmesTier;
  assessedTier: HolmesTier;
  tier: HolmesTier;
  impact: ImpactAssessment;
  proofDown: ImpactStepDownProof[];
  requirements: ClassificationRequirement[];
  scope: ScopeEnvelope;
  lease: MutationLease;
  llmAssessment?: LlmImpactAssessment;
  riskProsecutorAssessment?: RiskProsecutorAssessment;
  rationale: string;
  nextObligation: string;
}

export type LlmImpactAssessor = (args: {
  snapshot: ClassificationSnapshot;
  deterministic: ProveDownResult;
  signal: AbortSignal;
}) => Promise<LlmImpactAssessment>;

export type RiskProsecutorAssessor = (args: {
  snapshot: ClassificationSnapshot;
  params: HolmesClassifyParams;
  deterministic: ProveDownResult;
  signal: AbortSignal;
}) => Promise<RiskProsecutorAssessment>;

export interface HolmesStats {
  turnsStarted: number;
  toolCallsIntercepted: number;
  primitiveBurstsBlocked: number;
  reasoningReminders: number;
  verifyRemindersAppended: number;
  systemPromptAppends: number;
  visibleMarkersObserved: number;
  reasoningSoftViolations: number;
  delegationTaskCalls: number;
  delegationBlockedCalls: number;
  classificationsCreated: number;
  classificationGateBlocks: number;
  classificationRecordsInvalidated: number;
  llmAssessorAttempts: number;
  llmAssessorSuccesses: number;
  llmAssessorFailures: number;
}

export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "search",
  "find",
  "ast_grep",
  "web_search",
  HOLMES_CLASSIFY_TOOL,
]);

export const KNOWN_EFFECTFUL_TOOLS: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "ast_edit",
  "resolve",
  "bash",
  "eval",
  "task",
  "debug",
  "browser",
  "github",
  "generate_image",
]);

export const MUTATING_TOOLS: ReadonlySet<string> = KNOWN_EFFECTFUL_TOOLS;
export const VERIFY_TOOLS: ReadonlySet<string> = new Set([
  ...KNOWN_EFFECTFUL_TOOLS,
]);

export const PRIMITIVE_TOOLS: ReadonlySet<string> = new Set(["read", "search", "find"]);
export const EXEMPT_READ_AFTER: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "resolve",
  "ast_edit",
  "task",
  HOLMES_CLASSIFY_TOOL,
]);
export const TASK_TOOL_NAME = "task";
export const DEAD_HOLMES_AGENTS: ReadonlySet<string> = new Set([
  "holmes-researcher",
  "holmes-verifier",
]);

export const MAX_PRIMITIVE_BURST = 3;
export const MAX_SCAN_CHARS = 16_000;
export const MAX_CLASSIFIER_FILES = 8;
export const MAX_CLASSIFIER_FILE_BYTES = 24 * 1024;
export const MAX_CLASSIFIER_TOTAL_BYTES = 96 * 1024;
export const DEFAULT_CLASSIFIER_TIMEOUT_MS = 8_000;
export const DEFAULT_REPEATED_BLOCK_LIMIT = 2;

export const BASH_FILE_PRIMITIVE = /(^|[;&|()\s])(?:cat|head|tail|less|more|ls|grep|rg|ag|ack|find|fd)(?=\s|$)/;
export const URL_RESOURCE = /^(?:https?:\/\/|pr:\/\/|issue:\/\/|agent:\/\/|artifact:\/\/|memory:\/\/|skill:\/\/|rule:\/\/|local:\/\/|vault:\/\/|mcp:\/\/)/;
export const CLASSIFY_MARKER = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:HOLMES\s*:\s*Tier\s*([1234])|\[?\s*CLASSIFY\s*:\s*Tier\s*([1234])\s*\]?|\[\s*Tier\s*([1234])\s*\])/i;
export const LAYER0_TERMS = /\b(?:HALT|ENVISION|LOCATE|DELTA|CLASSIFY|TARGET|NOW|NEXT|Tier\s*[1234]|Hone|Observe|Ladder|Map|Establish|Synthesize)\b/i;

export function buildHolmesClassifyParamsSchema(Type: ExtensionAPI["typebox"]["Type"]) {
  const HolmesTierSchema = Type.Union([
    Type.Literal(1),
    Type.Literal(2),
    Type.Literal(3),
    Type.Literal(4),
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

  const StructuredEffectSchema = Type.Union([
    Type.Object(
      {
        kind: Type.Literal("edit"),
        path: Type.String({ minLength: 1, maxLength: 500 }),
        exactPatch: Type.String({ maxLength: 32_000 }),
        semanticClassClaim: Type.Optional(Type.String({ maxLength: 200 })),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal("write"),
        path: Type.String({ minLength: 1, maxLength: 500 }),
        exactContent: Type.String({ maxLength: 64_000 }),
        replacementClassClaim: Type.Optional(Type.String({ maxLength: 200 })),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        kind: Type.Literal("ast_edit"),
        paths: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 64 }),
        exactOps: Type.String({ maxLength: 32_000 }),
        expectedMatchCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 500 })),
      },
      { additionalProperties: false },
    ),
  ]);

  const PlannedActionSchema = Type.Object(
    {
      toolName: Type.String({ minLength: 1, maxLength: 80 }),
      paths: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 64 }),
      operationKind: OperationKindSchema,
      summary: Type.String({ minLength: 1, maxLength: 2_000 }),
      exactOpaqueInput: Type.Optional(Type.String({ maxLength: 16_000 })),
      structuredEffect: Type.Optional(StructuredEffectSchema),
    },
    { additionalProperties: false },
  );

  return Type.Object(
    {
      proposedTier: HolmesTierSchema,
      target: Type.Object(
        {
          summary: Type.String({ minLength: 1, maxLength: 4_000 }),
          files: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 64 }),
          tools: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 24 }),
          operationKind: OperationKindSchema,
          expectedMutationCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 50 })),
        },
        { additionalProperties: false },
      ),
      impact: Type.Optional(
        Type.Object(
          {
            userIntentSummary: Type.String({ maxLength: 2_000 }),
            intendedReceivedEffect: Type.String({ maxLength: 2_000 }),
            predictedBehaviorChange: Type.String({ maxLength: 2_000 }),
            affectedSystems: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 32 }),
            downstreamEffects: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 32 }),
            contractChanges: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 32 }),
            dataEffects: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 32 }),
            safetySecurityEffects: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 32 }),
            reversibility: Type.Union([
              Type.Literal("trivial"),
              Type.Literal("bounded"),
              Type.Literal("difficult"),
              Type.Literal("unknown"),
            ]),
            confidence: Type.Union([
              Type.Literal("high"),
              Type.Literal("medium"),
              Type.Literal("low"),
            ]),
            assumptions: Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 32 }),
            unknowns: Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 32 }),
          },
          { additionalProperties: false },
        ),
      ),
      intentAlignment: Type.Optional(
        Type.Object(
          {
            claimedAlignment: Type.Union([
              Type.Literal("aligned"),
              Type.Literal("partial"),
              Type.Literal("mismatch"),
              Type.Literal("unknown"),
            ]),
            explanation: Type.String({ maxLength: 2_000 }),
          },
          { additionalProperties: false },
        ),
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
            knownFacts: Type.Optional(Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 32 })),
            assumptions: Type.Optional(Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 32 })),
            unknowns: Type.Optional(Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 32 })),
            tradeoffs: Type.Optional(Type.Array(Type.String({ maxLength: 1_000 }), { maxItems: 32 })),
          },
          { additionalProperties: false },
        ),
      ),
      plannedActions: Type.Array(PlannedActionSchema, { maxItems: 50 }),
    },
    { additionalProperties: false },
  );
}

export function createObservationState(turnIndex = 0): MessageObservationState {
  return {
    turnIndex,
    visibleByIndex: new Map(),
    thinkingByIndex: new Map(),
    visibleText: "",
    thinkingText: "",
  };
}

export function createDelegationState(): DelegationState {
  return {
    researchDelegatedThisTurn: false,
    verificationDelegatedThisTurn: false,
    taskCallsThisTurn: 0,
    blockedTaskCalls: 0,
  };
}

export function createClassificationState(ruleVersion = HOLMES_RULE_VERSION): HolmesClassificationState {
  return {
    history: [],
    leases: new Map(),
    ledgerByRequest: new Map(),
    latestUserRequest: "",
    latestUserRequestDigest: "",
    turnId: 0,
    sequence: 0,
    ruleVersion,
    lastGateBlockByEffect: new Map(),
  };
}

export function createTurnMetadata(args: {
  turnId?: number;
  latestUserRequest?: string;
  latestUserRequestDigest?: string;
  startedAtMs?: number;
  isPrintMode?: boolean;
} = {}): HolmesTurnMetadata {
  return {
    turnId: args.turnId ?? 0,
    latestUserRequest: args.latestUserRequest ?? "",
    latestUserRequestDigest: args.latestUserRequestDigest ?? "",
    startedAtMs: args.startedAtMs ?? Date.now(),
    isPrintMode: args.isPrintMode,
  };
}

export function createToolCallLog(): HolmesToolCallLog {
  return {
    currentTurn: [],
    byUserRequestDigest: new Map(),
    repeatedBlockCount: 0,
  };
}

export function createStats(): HolmesStats {
  return {
    turnsStarted: 0,
    toolCallsIntercepted: 0,
    primitiveBurstsBlocked: 0,
    reasoningReminders: 0,
    verifyRemindersAppended: 0,
    systemPromptAppends: 0,
    visibleMarkersObserved: 0,
    reasoningSoftViolations: 0,
    delegationTaskCalls: 0,
    delegationBlockedCalls: 0,
    classificationsCreated: 0,
    classificationGateBlocks: 0,
    classificationRecordsInvalidated: 0,
    llmAssessorAttempts: 0,
    llmAssessorSuccesses: 0,
    llmAssessorFailures: 0,
  };
}
