export const HOLMES_CLASSIFY_TOOL = "holmes_classify" as const;
export const HOLMES_CHECKPOINT_TOOL = "holmes_checkpoint";
export const HOLMES_RULE_VERSION = "holmes-classify-v1" as const;

export type HolmesTier = 1 | 2 | 3 | 4;
export type Confidence = "high" | "medium" | "low";
export type LeaseKind = "exact" | "scope" | "scope_only" | "blocked";

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
  | "human_audience"
  | "reputation"
  | "factual_accuracy"
  | "coordination_graph"
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
  | "creative_writing"
  | "research_synthesis"
  | "coordination"
  | "session_artifact"
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
  | "session_scaffolding"
  | "creative_deliverable"
  | "research_output"
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

/** Answer-side obligation level (plan §3.2). */
export type AnswerObligationLevel = "none" | "light" | "full";

/** Answer gate state-machine phase (plan §3.5). */
export type AnswerGatePhase = "idle" | "obligated" | "awaiting_repair" | "satisfied" | "soft_accept";

/** Deterministic answer triage signals (plan §3.2). */
export interface AnswerTriageSignals {
  requestText: string;
  requestChars: number;
  questionCount: number;
  hasCodeFence: boolean;
  reasoningVerbHits: number;
  multiPartMarkers: number;
}

/** Deterministic answer escalation facts (plan §3.2). */
export interface AnswerEscalationFacts {
  toolCallsThisRequest: number;
  effectfulToolCalls: number;
  finalVisibleChars: number;
  codeBlocksInAnswer: number;
  liveTier34Record: boolean;
}

/** Answer gate state (plan §3.5). */
export interface AnswerGateState {
  phase: AnswerGatePhase;
  level: AnswerObligationLevel;
  requestDigest: string;
  createdAtSequence: number;
  retriesUsed: number;
  graderHollowFlags: number;
  checkpointRecords: AnswerCheckpointRecord[];
}

/** Answer checkpoint record (plan §3.4). */
export interface AnswerCheckpointRecord {
  id: string;
  requestDigest: string;
  createdAtSequence: number;
  level: AnswerObligationLevel;
  source: "visible_pass" | "checkpoint_tool";
  shapeOk: boolean;
  verifiedEvidenceIds: string[];
  unverifiedMentions: string[];
  grader?: ReasoningGraderOutcome;
}

/** Holmes checkpoint payload (plan §3.4). */
export interface HolmesCheckpointParams {
  target: string;
  chain: Array<{ step: string; evidence?: string[] }>;
  unknowns: Array<{ question: string; status: "open" | "closed"; closedBy?: string }>;
  plan: string[];
}

/** Reasoning grader packet (plan §4.3). */
export interface ReasoningGraderPacket {
  facts: {
    level: AnswerObligationLevel | "tier3_pass" | "tier4_pass";
    verifiedEvidenceIds: string[];
    unverifiedMentions: string[];
    sectionPresence: Record<string, boolean>;
    toolCallSummary: Array<{ tool: string; pathish: string[] }>;
    leasePaths?: string[];
  };
  untrustedClaims: {
    userRequestExcerpt: string;
    passText: string;
    checkpointParams?: HolmesCheckpointParams;
  };
}

/** Reasoning grader defect (plan §4.4). */
export interface GraderDefect {
  axis: "chain" | "closure" | "plan";
  severity: "high" | "medium" | "low";
  detail: string;
  citedEvidence: string[];
}

/** Reasoning grader assessment (plan §4.4). */
export interface ReasoningGraderAssessment {
  status: "succeeded" | "failed" | "skipped";
  verdict?: "coherent" | "hollow" | "incoherent";
  defects: GraderDefect[];
  requiredAdditions: string[];
}

/** Reasoning grader outcome cache result (plan §7). */
export interface ReasoningGraderOutcome {
  verdict?: "coherent" | "hollow" | "incoherent";
  defectAxes: string[];
  cached: boolean;
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
  | "local_only"
  | "source_material_read"
  | "factual_cross_reference"
  | "coordination_plan_bounded"
  | "session_scoped_only";

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
  chargedMutations?: number;
  chargedPaths?: string[];
  effectFingerprints: string[];
  exactOpaqueInputs: Record<string, string[]>;
  fileStateFingerprints: Record<string, string>;
  expiresOn: InvalidationReason[];
}

export interface OpenUnknown {
  id: string;
  text: string;
  source: "classifier" | "model_params" | "tool_log" | "user_request";
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
  graderObligations?: string[];
  graderHollowFlags?: number;
  grader?: ReasoningGraderOutcome;
}

export type ProcessState = ClassificationProcessState;


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
  riskProsecutorAssessment?: RiskProsecutorAssessment;
  impactRationale: string;
  proofBlocker?: string;
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

export interface VerificationFailureEntry {
  key: string;
  toolName: string;
  paths: string[];
  resolvedBy?: string;
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
  verificationFailureEntries?: VerificationFailureEntry[];
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

/** Extension configuration options (plan §7). */
export interface HolmesConfig {
  /** Grade mutation passes with the reasoning grader; default false. */
  gradeMutationPasses?: boolean;
  graderTimeoutMs?: number;
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
  riskProsecutorAssessment?: RiskProsecutorAssessment;
  impactRationale: string;
  proofBlocker?: string;
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
  riskProsecutorAssessment?: RiskProsecutorAssessment;
  impactRationale: string;
  proofBlocker?: string;
  rationale: string;
  nextObligation: string;
}


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
  verifyRemindersAppended: number;
  systemPromptAppends: number;
  visibleMarkersObserved: number;
  reasoningSoftViolations: number;
  answerObligationsCreated: number;
  answerCheckpointsSatisfied: number;
  answerDemandsIssued: number;
  answerSoftAccepts: number;
  graderCalls: number;
  graderCacheHits: number;
  graderHollowFlags: number;
  delegationTaskCalls: number;
  delegationBlockedCalls: number;
  classificationsCreated: number;
  classificationGateBlocks: number;
  classificationRecordsInvalidated: number;
}

export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "search",
  "find",
  "ast_grep",
  "web_search",
  HOLMES_CLASSIFY_TOOL,
  HOLMES_CHECKPOINT_TOOL,
]);

export const SESSION_TOOLS: ReadonlySet<string> = new Set([
  "todo_write",
  "ask",
  "lsp",
  "report_tool_issue",
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
  HOLMES_CHECKPOINT_TOOL,
]);
export const TASK_TOOL_NAME = "task";
export const DEAD_HOLMES_AGENTS: ReadonlySet<string> = new Set([
  "holmes-researcher",
  "holmes-verifier",
]);

export const MAX_PRIMITIVE_BURST = 3;
export const MAX_ANSWER_RETRIES = 1;
export const MAX_GRADER_HOLLOW_FLAGS = 1;
export const MAX_GRADER_CALLS_PER_REQUEST = 2;
export const DEFAULT_GRADER_TIMEOUT_MS = 5_000;
export const ANSWER_TRIVIAL_REQUEST_CHARS = 200;
export const ANSWER_SUBSTANTIVE_CHARS = 600;
export const ANSWER_HEAVY_CHARS = 3_000;
export const ANSWER_TOOLCALL_LIGHT = 4;
export const ANSWER_TOOLCALL_FULL = 8;
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
    verifyRemindersAppended: 0,
    systemPromptAppends: 0,
    visibleMarkersObserved: 0,
    reasoningSoftViolations: 0,
    answerObligationsCreated: 0,
    answerCheckpointsSatisfied: 0,
    answerDemandsIssued: 0,
    answerSoftAccepts: 0,
    graderCalls: 0,
    graderCacheHits: 0,
    graderHollowFlags: 0,
    delegationTaskCalls: 0,
    delegationBlockedCalls: 0,
    classificationsCreated: 0,
    classificationGateBlocks: 0,
    classificationRecordsInvalidated: 0,
  };
}
