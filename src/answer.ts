import type { ExtensionAPI, ExtensionUIContext } from "@oh-my-pi/pi-coding-agent";
import {
  detectTier2Compliance,
  detectTier3SinglePassCompliance,
  extractEvidenceReferences,
  redactSelfClassification,
} from "./observation";
import { stableHashText } from "./classification";
import {
  ANSWER_HEAVY_CHARS,
  ANSWER_SUBSTANTIVE_CHARS,
  ANSWER_TOOLCALL_FULL,
  ANSWER_TOOLCALL_LIGHT,
  ANSWER_TRIVIAL_REQUEST_CHARS,
  HOLMES_CHECKPOINT_TOOL,
  MAX_ANSWER_RETRIES,
  MAX_GRADER_CALLS_PER_REQUEST,
  MAX_GRADER_HOLLOW_FLAGS,
  MAX_SCAN_CHARS,
  type AnswerTriageSignals,
  type AnswerCheckpointRecord,
  type AnswerEscalationFacts,
  type AnswerGatePhase,
  type AnswerGateState,
  type AnswerObligationLevel,
  type HolmesCheckpointParams,
  type HolmesStats,
  type HolmesToolCallLog,
  type MessageObservationState,
  type ReasoningGraderAssessment,
  type ReasoningGraderOutcome,
  type ToolCallSummary,
} from "./types";
import {
  assessReasoningWithCache,
  buildReasoningGraderPacket,
  mapGraderOutcomeToObligations,
  type ReasoningGraderAssessor,
  type ReasoningGraderRequestCache,
} from "./grader";
declare module "./types" {
  interface AnswerGateState {
    lastMissingAxes?: string[];
    satisfiedAtLevel?: AnswerObligationLevel;
  }

  interface ToolCallSummary {
    failed?: boolean;
  }
}

const REASONING_VERB = /\b(debug|design|architect|diagnose|trade-?off|root.cause|refactor|plan|investigate|review|compare|migrate)\b/gi;
const NUMBERED_LIST_MARKER = /^\s*\d+[.)]\s+/gm;
const AND_ALSO_MARKER = /\band\s+also\b/gi;
const SEMICOLON_IMPERATIVE = /;\s*(?:then\s+)?(?:debug|design|architect|diagnose|refactor|plan|investigate|review|compare|migrate|fix|add|remove|update|change|check|verify|explain|write|create|implement|test|document)\b/gi;
const COMPLETE_CODE_BLOCK = /```[\s\S]*?```/g;
const INTERNAL_URI = /^(?:agent|artifact|memory|skill|rule|local|vault|mcp|issue|pr):\/\//i;
const LINE_SELECTOR = /:\d+(?:[-+]\d+)?(?:,\d+(?:[-+]\d+)?)*$/u;
const HASH_SELECTOR = /#[0-9A-Fa-f]{2,}$/u;
const RAW_SELECTOR = /:(?:raw|conflicts)$/iu;
const TERMINAL_PHASE: Partial<Record<AnswerGatePhase, true>> = { satisfied: true, soft_accept: true };
const ANSWER_LEVEL_RANK: Record<AnswerObligationLevel, number> = { none: 0, light: 1, full: 2 };

type ComplianceDetails = {
  satisfied: boolean;
  missingAxes: string[];
  passText: string;
  verifiedEvidenceIds: string[];
  unverifiedMentions: string[];
};

export interface ReasoningGraderRuntime {
  cacheForDigest(requestDigest: string): ReasoningGraderRequestCache;
}

export function collectTriageSignals(requestText: string): AnswerTriageSignals {
  const scan = limitText(requestText);
  return {
    requestText: scan,
    requestChars: scan.length,
    questionCount: countMatches(scan, /\?/g),
    hasCodeFence: scan.includes("```"),
    reasoningVerbHits: countMatches(scan, REASONING_VERB),
    multiPartMarkers:
      countMatches(scan, NUMBERED_LIST_MARKER) +
      countMatches(scan, AND_ALSO_MARKER) +
      countMatches(scan, SEMICOLON_IMPERATIVE),
  };
}

export function triageAnswerObligation(signals: AnswerTriageSignals): AnswerObligationLevel {
  if (
    signals.requestChars < ANSWER_TRIVIAL_REQUEST_CHARS &&
    !signals.hasCodeFence &&
    signals.questionCount <= 1 &&
    signals.reasoningVerbHits === 0 &&
    signals.multiPartMarkers === 0
  ) {
    return "none";
  }

  if (
    signals.reasoningVerbHits >= 2 ||
    (signals.reasoningVerbHits >= 1 && (signals.hasCodeFence || signals.multiPartMarkers >= 2))
  ) {
    return "full";
  }

  return "light";
}

export function escalateAnswerObligation(
  level: AnswerObligationLevel,
  facts: AnswerEscalationFacts,
): AnswerObligationLevel {
  if (
    facts.toolCallsThisRequest >= ANSWER_TOOLCALL_FULL ||
    (facts.finalVisibleChars >= ANSWER_HEAVY_CHARS && facts.codeBlocksInAnswer >= 2) ||
    facts.liveTier34Record
  ) {
    return "full";
  }

  if (
    level === "none" &&
    (facts.finalVisibleChars >= ANSWER_SUBSTANTIVE_CHARS ||
      facts.codeBlocksInAnswer >= 1 ||
      facts.toolCallsThisRequest >= ANSWER_TOOLCALL_LIGHT)
  ) {
    return "light";
  }

  return level;
}

export function createAnswerGateState(
  requestDigest: string,
  level: AnswerObligationLevel,
  sequence: number,
): AnswerGateState {
  // The caller owns stats.answerObligationsCreated: this factory has no stats parameter.
  return {
    phase: "obligated",
    level,
    requestDigest,
    createdAtSequence: sequence,
    retriesUsed: 0,
    graderHollowFlags: 0,
    checkpointRecords: [],
  };
}

export function evaluateAnswerCompliance(args: {
  state: AnswerGateState;
  observation: MessageObservationState;
  toolLog: HolmesToolCallLog;
  sequence: number;
}): { satisfied: boolean; missingAxes: string[] } {
  const details = evaluateAnswerComplianceDetails(args);
  return { satisfied: details.satisfied, missingAxes: details.missingAxes };
}

export async function processAnswerMessageEnd(args: {
  state: AnswerGateState;
  observation: MessageObservationState;
  toolLog: HolmesToolCallLog;
  stats: HolmesStats;
  sequence: number;
  grader?: ReasoningGraderAssessor;
  graderRuntime?: ReasoningGraderRuntime;
  requestText?: string;
  liveTier34Record: boolean;
}): Promise<void> {
  if (args.state.phase === "idle") return;

  const previousLevel = args.state.level;
  const calls = toolCallAttemptsForRequest(args.toolLog, args.state.requestDigest);
  const nextLevel = escalateAnswerObligation(previousLevel, {
    toolCallsThisRequest: calls.length,
    effectfulToolCalls: calls.filter((call) => call.effectful).length,
    finalVisibleChars: args.observation.visibleText.length,
    codeBlocksInAnswer: countCodeBlocks(args.observation.visibleText),
    liveTier34Record: args.liveTier34Record,
  });
  if (args.state.phase === "soft_accept") return;
  if (previousLevel === "none" && nextLevel !== "none") {
    args.stats.answerObligationsCreated++;
  }
  args.state.level = nextLevel;

  if (args.state.phase === "satisfied" && !reopenSatisfiedAtHigherLevel(args.state, previousLevel, nextLevel)) {
    return;
  }
  if (args.state.level === "none") return;

  const details = evaluateAnswerComplianceDetails(args);
  if (!details.satisfied) return;

  const record = buildVisiblePassRecord(args.state, details);
  const grader = args.grader;
  if (shouldRunGrader(args.state, grader)) {
    const grade = await assessReasoning({
      state: args.state,
      observation: args.observation,
      toolLog: args.toolLog,
      grader,
      graderRuntime: args.graderRuntime,
      requestText: args.requestText ?? "",
      stats: args.stats,
    });
    record.grader = grade.outcome;
    args.state.checkpointRecords.push(record);
    if (grade.withholdSatisfaction) {
      consumeGraderHollowFlag(args.state, args.stats);
      return;
    }
    if (shouldSoftAcceptCappedGraderRejection(args.state, grade.outcome)) {
      softAccept(args.state, args.stats);
      return;
    }
    recordCappedGraderDowngrade(args.state, grade.outcome, args.stats);
    satisfyAnswerGate(args.state, args.stats);
    return;
  }

  args.state.checkpointRecords.push(record);
  satisfyAnswerGate(args.state, args.stats);
}

export function handleAgentEnd(args: {
  state: AnswerGateState;
  observation: MessageObservationState;
  hasUI: boolean;
  sendMessage: ExtensionAPI["sendMessage"];
  ui?: ExtensionUIContext;
  stats: HolmesStats;
}): void {
  if (args.state.phase === "idle" || TERMINAL_PHASE[args.state.phase]) {
    return;
  }

  if (args.state.level === "none") {
    args.state.phase = "satisfied";
    args.state.satisfiedAtLevel = "none";
    delete args.state.lastMissingAxes;
    return;
  }

  if (args.state.phase === "obligated" && args.state.retriesUsed < MAX_ANSWER_RETRIES) {
    args.state.retriesUsed++;
    args.state.phase = "awaiting_repair";
    const demand = buildCheckpointDemand(args.state.level, demandAxes(args.state));
    try {
      args.sendMessage(
        {
          customType: "holmes_answer_checkpoint",
          content: demand,
          display: true,
        },
        { deliverAs: "nextTurn", triggerTurn: true },
      );
      args.stats.answerDemandsIssued++;
    } catch {
      softAccept(args.state, args.stats);
      return;
    }

    if (args.hasUI && args.ui) {
      args.ui.notify("HOLMES answer checkpoint scheduled for the next turn.", "warning");
      args.ui.setStatus("holmes-answer", "Answer checkpoint pending");
    }
    return;
  }

  softAccept(args.state, args.stats);
}

export function buildCheckpointDemand(
  level: AnswerObligationLevel,
  missingAxes: string[],
): string {
  const axes = uniqueStrings(missingAxes.length > 0 ? missingAxes : defaultMissingAxes(level));
  return [
    "HOLMES ANSWER CHECKPOINT — your previous answer stands, but it was delivered without an observed reasoning pass " +
      `at level \`${level}\`. Before this request is considered closed, do exactly one of: ` +
      `(a) emit the visible pass for this level (${sectionNames(level)}), or ` +
      `(b) call \`${HOLMES_CHECKPOINT_TOOL}\` with your backward chain.`,
    `Missing dimension(s): ${axes.join(", ")}.`,
    "This demand is issued once; it will not repeat.",
  ].join("\n");
}

export function buildObligationContextNotice(state: AnswerGateState): string | undefined {
  if ((state.phase !== "obligated" && state.phase !== "awaiting_repair") || state.level === "none") {
    return undefined;
  }
  return `HOLMES answer obligation active (${state.level}): close with visible ${sectionNames(state.level)} reasoning or ${HOLMES_CHECKPOINT_TOOL}; the checkpoint demand can be issued at most once.`;
}

export async function executeHolmesCheckpoint(args: {
  params: HolmesCheckpointParams;
  state: AnswerGateState;
  observation: MessageObservationState;
  toolLog: HolmesToolCallLog;
  grader?: ReasoningGraderAssessor;
  graderRuntime?: ReasoningGraderRuntime;
  requestText?: string;
  signal?: AbortSignal;
  stats: HolmesStats;
}): Promise<{ content: string; record: AnswerCheckpointRecord }> {
  if (TERMINAL_PHASE[args.state.phase]) {
    return {
      content: `request already closed (${args.state.phase})`,
      record: emptyCheckpointRecord(args.state, args.params, true),
    };
  }

  const shapeFailures = checkpointShapeFailures(args.params);
  const mentions = checkpointEvidenceMentions(args.params);
  const evidence = crossCheckEvidence(mentions, args.toolLog, args.state.requestDigest);
  const toolCallAttempts = toolCallAttemptsForRequest(args.toolLog, args.state.requestDigest);
  const unverifiedClosedUnknowns = args.params.unknowns.filter(
    (unknown) => unknown.status === "closed" && !referenceIsVerified(unknown.closedBy ?? "", args.toolLog, args.state.requestDigest),
  );
  const shapeOk = shapeFailures.length === 0;
  const fullClosureOk = args.state.level !== "full" || unverifiedClosedUnknowns.length === 0;
  const verifiedEvidenceOk = args.state.level !== "full" || toolCallAttempts.length === 0 || evidence.verifiedEvidenceIds.length > 0;
  const deterministicSatisfied = shapeOk && fullClosureOk && verifiedEvidenceOk;
  const record: AnswerCheckpointRecord = {
    id: checkpointRecordId(args.state, args.params),
    requestDigest: args.state.requestDigest,
    createdAtSequence: args.state.createdAtSequence,
    level: args.state.level,
    source: "checkpoint_tool",
    shapeOk,
    verifiedEvidenceIds: evidence.verifiedEvidenceIds,
    unverifiedMentions: evidence.unverifiedMentions,
  };

  if (!deterministicSatisfied) {
    const axes = [
      ...shapeFailures,
      ...(!fullClosureOk ? ["verified_closure"] : []),
      ...(!verifiedEvidenceOk ? ["verified_evidence"] : []),
    ];
    args.state.lastMissingAxes = uniqueStrings(axes);
    args.state.checkpointRecords.push(record);
    return {
      content: checkpointVerdict(
        false,
        axes,
        verifiedEvidenceOk ? "repair_with_visible_pass_or_checkpoint" : "verified_evidence_required",
      ),
      record,
    };
  }

  const grader = args.grader;
  if (shouldRunGrader(args.state, grader)) {
    const grade = await assessReasoning({
      state: args.state,
      observation: args.observation,
      toolLog: args.toolLog,
      checkpointParams: args.params,
      grader,
      graderRuntime: args.graderRuntime,
      requestText: args.requestText ?? "",
      signal: args.signal,
      stats: args.stats,
    });
    record.grader = grade.outcome;
    args.state.checkpointRecords.push(record);
    if (grade.withholdSatisfaction) {
      consumeGraderHollowFlag(args.state, args.stats);
      return {
        content: checkpointVerdict(false, grade.outcome.defectAxes, "bounded_grader_repair"),
        record,
      };
    }
    if (shouldSoftAcceptCappedGraderRejection(args.state, grade.outcome)) {
      softAccept(args.state, args.stats);
      return { content: checkpointVerdict(false, grade.outcome.defectAxes, "bounded_grader_advisory"), record };
    }
    recordCappedGraderDowngrade(args.state, grade.outcome, args.stats);
    satisfyAnswerGate(args.state, args.stats);
    return { content: checkpointVerdict(true, [], "satisfied"), record };
  }

  args.state.checkpointRecords.push(record);
  satisfyAnswerGate(args.state, args.stats);
  return { content: checkpointVerdict(true, [], "satisfied"), record };
}

export function buildHolmesCheckpointParamsSchema(Type: ExtensionAPI["typebox"]["Type"]) {
  const UnknownStatusSchema = Type.Union([Type.Literal("open"), Type.Literal("closed")]);
  const ChainStepSchema = Type.Object(
    {
      step: Type.String({ minLength: 1, maxLength: 4_000 }),
      evidence: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 64 })),
    },
    { additionalProperties: false },
  );
  const UnknownSchema = Type.Object(
    {
      question: Type.String({ minLength: 1, maxLength: 2_000 }),
      status: UnknownStatusSchema,
      closedBy: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    },
    { additionalProperties: false },
  );

  return Type.Object(
    {
      target: Type.String({ minLength: 1, maxLength: 4_000 }),
      chain: Type.Array(ChainStepSchema, { minItems: 1, maxItems: 64 }),
      unknowns: Type.Array(UnknownSchema, { maxItems: 64 }),
      plan: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: 64 }),
    },
    { additionalProperties: false },
  );
}

function evaluateAnswerComplianceDetails(args: {
  state: AnswerGateState;
  observation: MessageObservationState;
  toolLog: HolmesToolCallLog;
  sequence: number;
}): ComplianceDetails {
  if (TERMINAL_PHASE[args.state.phase] || args.state.level === "none") {
    return rememberCompliance(args.state, emptyCompliance(true));
  }

  const passText = redactSelfClassification(args.observation.visibleText);
  if (args.sequence < args.state.createdAtSequence) {
    return rememberCompliance(args.state, {
      ...emptyCompliance(false),
      passText,
      missingAxes: ["answer_sequence"],
    });
  }

  if (args.state.level === "light") {
    const sections = detectTier2Compliance(passText);
    const missing = [
      ...(sections.target ? [] : ["target_section"]),
      ...(sections.delta ? [] : ["delta_section"]),
      ...(sections.next ? [] : ["next_section"]),
    ];
    return rememberCompliance(args.state, {
      satisfied: missing.length === 0,
      missingAxes: missing,
      passText,
      verifiedEvidenceIds: [],
      unverifiedMentions: [],
    });
  }

  const sections = detectTier3SinglePassCompliance(passText);
  const sectionMissing = !(
    sections.hone &&
    sections.observe &&
    sections.ladder &&
    sections.map &&
    sections.establish &&
    sections.synthesize
  );
  const refs = extractEvidenceReferences(passText);
  const evidence = crossCheckEvidence(refs, args.toolLog, args.state.requestDigest);
  const toolCalls = toolCallsForRequest(args.toolLog, args.state.requestDigest);
  const missingAxes = [
    ...(sectionMissing ? ["backward_chain_sections"] : []),
    ...(toolCalls.length === 0 || evidence.verifiedEvidenceIds.length === 0 ? ["verified_evidence"] : []),
  ];

  return rememberCompliance(args.state, {
    satisfied: missingAxes.length === 0,
    missingAxes,
    passText,
    verifiedEvidenceIds: evidence.verifiedEvidenceIds,
    unverifiedMentions: evidence.unverifiedMentions,
  });
}

function shouldRunGrader(
  state: AnswerGateState,
  grader: ReasoningGraderAssessor | undefined,
): grader is ReasoningGraderAssessor {
  return (
    state.level === "full" &&
    state.phase !== "satisfied" &&
    state.phase !== "soft_accept" &&
    countGraderCalls(state) < MAX_GRADER_CALLS_PER_REQUEST &&
    grader !== undefined
  );
}

async function assessReasoning(args: {
  state: AnswerGateState;
  observation: MessageObservationState;
  toolLog: HolmesToolCallLog;
  checkpointParams?: HolmesCheckpointParams;
  grader: ReasoningGraderAssessor;
  graderRuntime?: ReasoningGraderRuntime;
  requestText: string;
  signal?: AbortSignal;
  stats: HolmesStats;
}): Promise<{ outcome: ReasoningGraderOutcome; withholdSatisfaction: boolean }> {
  const packetArgs = {
    level: args.state.level,
    observation: args.observation,
    toolLog: args.toolLog,
    checkpointParams: args.checkpointParams,
    requestDigest: args.state.requestDigest,
    requestText: args.requestText,
  };
  const { packet } = buildReasoningGraderPacket(packetArgs);
  const scopedToolCalls = toolCallsForRequest(args.toolLog, args.state.requestDigest);
  let cached = false;
  let assessment: ReasoningGraderAssessment;

  if (args.signal?.aborted) {
    assessment = failedGraderAssessment();
  } else if (args.graderRuntime) {
    try {
      const result = await assessReasoningWithCache({
        packet,
        assessor: graderWithAbortSignal(args.grader, args.signal),
        cache: args.graderRuntime.cacheForDigest(args.state.requestDigest),
        stats: args.stats,
      });
      assessment = result.assessment;
      cached = result.cached;
    } catch {
      assessment = failedGraderAssessment();
    }
  } else {
    assessment = await callGrader(args.grader, packet, args.stats, args.signal);
  }

  const mapped = mapGraderOutcomeToObligations(assessment, args.state);
  const missingEvidenceWithhold = shouldWithholdMissingEvidenceGrade({
    assessment,
    state: args.state,
    verifiedEvidenceIds: packet.facts.verifiedEvidenceIds,
    scopedToolCalls,
  });
  const obligations = missingEvidenceWithhold ? uniqueStrings([...mapped.obligations, "closure"]) : mapped.obligations;
  const outcome = graderOutcome(assessment, obligations, cached);
  return {
    outcome,
    withholdSatisfaction: mapped.withholdSatisfaction || missingEvidenceWithhold,
  };
}

function graderWithAbortSignal(
  grader: ReasoningGraderAssessor,
  signal: AbortSignal | undefined,
): ReasoningGraderAssessor {
  if (!signal) return grader;
  return (packet) => callGrader(grader, packet, undefined, signal);
}

async function callGrader(
  grader: ReasoningGraderAssessor,
  packet: Parameters<ReasoningGraderAssessor>[0],
  stats: HolmesStats | undefined,
  signal?: AbortSignal,
): Promise<ReasoningGraderAssessment> {
  if (stats) stats.graderCalls++;
  if (signal?.aborted) return failedGraderAssessment();
  try {
    return await withAbortSignal(grader(packet), signal);
  } catch {
    return failedGraderAssessment();
  }
}

function shouldWithholdMissingEvidenceGrade(args: {
  assessment: ReasoningGraderAssessment;
  state: AnswerGateState;
  verifiedEvidenceIds: readonly string[];
  scopedToolCalls: readonly ToolCallSummary[];
}): boolean {
  return (
    args.state.level === "full" &&
    args.state.graderHollowFlags < MAX_GRADER_HOLLOW_FLAGS &&
    args.scopedToolCalls.length > 0 &&
    args.verifiedEvidenceIds.length === 0 &&
    args.assessment.status === "succeeded" &&
    (args.assessment.verdict === "hollow" || args.assessment.verdict === "incoherent")
  );
}

function failedGraderAssessment(): ReasoningGraderAssessment {
  return { status: "failed", defects: [], requiredAdditions: ["grader_unavailable"] };
}

async function withAbortSignal<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) throw new Error("reasoning grader aborted");
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("reasoning grader aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}


function graderOutcome(
  assessment: ReasoningGraderAssessment,
  obligations: string[],
  cached: boolean,
): ReasoningGraderOutcome {
  return {
    ...(assessment.verdict ? { verdict: assessment.verdict } : {}),
    defectAxes: uniqueStrings(obligations),
    cached,
  };
}

function shouldSoftAcceptCappedGraderRejection(state: AnswerGateState, outcome: ReasoningGraderOutcome): boolean {
  return state.phase === "awaiting_repair" && isCappedGraderRejection(state, outcome);
}

function recordCappedGraderDowngrade(state: AnswerGateState, outcome: ReasoningGraderOutcome, stats: HolmesStats): void {
  if (state.phase !== "awaiting_repair" && isCappedGraderRejection(state, outcome)) {
    stats.reasoningSoftViolations++;
  }
}

function isCappedGraderRejection(state: AnswerGateState, outcome: ReasoningGraderOutcome): boolean {
  return (
    state.graderHollowFlags >= MAX_GRADER_HOLLOW_FLAGS &&
    (outcome.verdict === "hollow" || outcome.verdict === "incoherent")
  );
}

function consumeGraderHollowFlag(state: AnswerGateState, stats: HolmesStats): void {
  if (state.graderHollowFlags >= MAX_GRADER_HOLLOW_FLAGS) return;
  state.graderHollowFlags++;
  stats.graderHollowFlags++;
}

function reopenSatisfiedAtHigherLevel(
  state: AnswerGateState,
  previousLevel: AnswerObligationLevel,
  nextLevel: AnswerObligationLevel,
): boolean {
  const satisfiedAtLevel = state.satisfiedAtLevel ?? previousLevel;
  if (!isHigherAnswerLevel(nextLevel, satisfiedAtLevel)) return false;
  // Reopen is bounded: escalation is monotone over none < light < full, so a satisfied request
  // can reopen only once per higher level (≤2 total); retriesUsed is preserved, keeping the
  // one-demand cap across the original obligation and every reopen.
  state.phase = "obligated";
  delete state.lastMissingAxes;
  return true;
}

function isHigherAnswerLevel(left: AnswerObligationLevel, right: AnswerObligationLevel): boolean {
  return ANSWER_LEVEL_RANK[left] > ANSWER_LEVEL_RANK[right];
}

function satisfyAnswerGate(state: AnswerGateState, stats: HolmesStats): void {
  if (TERMINAL_PHASE[state.phase]) return;
  state.phase = "satisfied";
  state.satisfiedAtLevel = state.level;
  delete state.lastMissingAxes;
  stats.answerCheckpointsSatisfied++;
}

function softAccept(state: AnswerGateState, stats: HolmesStats): void {
  if (TERMINAL_PHASE[state.phase]) return;
  state.phase = "soft_accept";
  stats.answerSoftAccepts++;
  stats.reasoningSoftViolations++;
}

function buildVisiblePassRecord(state: AnswerGateState, details: ComplianceDetails): AnswerCheckpointRecord {
  return {
    id: `av_${stableHashText(`${state.requestDigest}:${state.checkpointRecords.length}:${details.passText}`).slice(0, 16)}`,
    requestDigest: state.requestDigest,
    createdAtSequence: state.createdAtSequence,
    level: state.level,
    source: "visible_pass",
    shapeOk: details.satisfied,
    verifiedEvidenceIds: details.verifiedEvidenceIds,
    unverifiedMentions: details.unverifiedMentions,
  };
}

function emptyCheckpointRecord(
  state: AnswerGateState,
  params: HolmesCheckpointParams,
  shapeOk: boolean,
): AnswerCheckpointRecord {
  return {
    id: checkpointRecordId(state, params),
    requestDigest: state.requestDigest,
    createdAtSequence: state.createdAtSequence,
    level: state.level,
    source: "checkpoint_tool",
    shapeOk,
    verifiedEvidenceIds: [],
    unverifiedMentions: [],
  };
}

function checkpointRecordId(state: AnswerGateState, params: HolmesCheckpointParams): string {
  return `ac_${stableHashText(`${state.requestDigest}:${state.checkpointRecords.length}:${JSON.stringify(params)}`).slice(0, 16)}`;
}

function checkpointShapeFailures(params: HolmesCheckpointParams): string[] {
  const failures: string[] = [];
  if (params.target.trim().length === 0) failures.push("target");
  if (params.chain.length === 0 || params.chain.every((entry) => entry.step.trim().length === 0)) {
    failures.push("chain");
  }
  if (params.unknowns.some((unknown) => unknown.status === "closed" && (unknown.closedBy ?? "").trim().length === 0)) {
    failures.push("closure_evidence");
  }
  return failures;
}

function checkpointEvidenceMentions(params: HolmesCheckpointParams): string[] {
  const mentions: string[] = [];
  for (const entry of params.chain) {
    if (!entry.evidence) continue;
    mentions.push(...entry.evidence);
  }
  for (const unknown of params.unknowns) {
    if (unknown.status === "closed" && unknown.closedBy) mentions.push(unknown.closedBy);
  }
  return uniqueStrings(mentions);
}

function checkpointVerdict(satisfied: boolean, axes: string[], exit: string): string {
  if (satisfied) return "satisfied — checkpoint_tool";
  const renderedAxes = uniqueStrings(axes.length > 0 ? axes : ["reasoning_pass"]).join(", ");
  return `failed dimension(s): ${renderedAxes}; exit: ${exit}`;
}

function demandAxes(state: AnswerGateState): string[] {
  for (let index = state.checkpointRecords.length - 1; index >= 0; index--) {
    const record = state.checkpointRecords[index];
    if (record.requestDigest !== state.requestDigest) continue;
    if (record.grader && record.grader.defectAxes.length > 0) return record.grader.defectAxes;
    if (!record.shapeOk) return ["checkpoint_shape"];
    if (record.unverifiedMentions.length > 0) return ["verified_evidence"];
  }
  if (state.lastMissingAxes && state.lastMissingAxes.length > 0) return state.lastMissingAxes;
  return defaultMissingAxes(state.level);
}

function defaultMissingAxes(level: AnswerObligationLevel): string[] {
  if (level === "light") return ["target_section", "delta_section", "next_section"];
  if (level === "full") return ["backward_chain_sections", "verified_evidence"];
  return ["reasoning_pass"];
}

function sectionNames(level: AnswerObligationLevel): string {
  if (level === "light") return "TARGET / DELTA / NEXT";
  if (level === "full") return "Hone / Observe / Ladder / Map / Establish / Synthesize with verified evidence";
  return "no visible pass required";
}

function countGraderCalls(state: AnswerGateState): number {
  return state.checkpointRecords.filter((record) => record.grader && !record.grader.cached).length;
}

function emptyCompliance(satisfied: boolean): ComplianceDetails {
  return {
    satisfied,
    missingAxes: satisfied ? [] : ["reasoning_pass"],
    passText: "",
    verifiedEvidenceIds: [],
    unverifiedMentions: [],
  };
}

function rememberCompliance(state: AnswerGateState, details: ComplianceDetails): ComplianceDetails {
  if (details.satisfied) {
    delete state.lastMissingAxes;
  } else {
    state.lastMissingAxes = uniqueStrings(details.missingAxes);
  }
  return details;
}

function crossCheckEvidence(
  mentions: readonly string[],
  toolLog: HolmesToolCallLog,
  requestDigest: string,
): { verifiedEvidenceIds: string[]; unverifiedMentions: string[] } {
  const paths = toolEvidencePaths(toolLog, requestDigest);
  const verifiedEvidenceIds: string[] = [];
  const unverifiedMentions: string[] = [];

  for (const mention of mentions) {
    const normalized = normalizeReference(mention);
    if (normalized.length === 0) continue;
    if (paths.some((path) => referencesSameResource(normalized, path))) {
      pushUnique(verifiedEvidenceIds, normalized);
    } else {
      pushUnique(unverifiedMentions, normalized);
    }
  }

  return { verifiedEvidenceIds, unverifiedMentions };
}

function referenceIsVerified(
  mention: string,
  toolLog: HolmesToolCallLog,
  requestDigest: string,
): boolean {
  const normalized = normalizeReference(mention);
  if (normalized.length === 0) return false;
  return toolEvidencePaths(toolLog, requestDigest).some((path) => referencesSameResource(normalized, path));
}

function toolEvidencePaths(toolLog: HolmesToolCallLog, requestDigest: string): string[] {
  const paths: string[] = [];
  for (const call of toolCallsForRequest(toolLog, requestDigest)) {
    for (const path of call.affectedPaths) {
      const normalized = normalizeReference(path);
      if (normalized.length > 0) pushUnique(paths, normalized);
    }
  }
  return paths;
}

export function toolCallsForRequest(toolLog: HolmesToolCallLog, requestDigest: string): ToolCallSummary[] {
  return collectToolCallsForRequest(toolLog, requestDigest, false);
}

function toolCallAttemptsForRequest(toolLog: HolmesToolCallLog, requestDigest: string): ToolCallSummary[] {
  return collectToolCallsForRequest(toolLog, requestDigest, true);
}

function collectToolCallsForRequest(
  toolLog: HolmesToolCallLog,
  requestDigest: string,
  includeFailed: boolean,
): ToolCallSummary[] {
  const calls: ToolCallSummary[] = [];
  const seen = new Set<string>();
  for (const call of [...(toolLog.byUserRequestDigest.get(requestDigest) ?? []), ...toolLog.currentTurn]) {
    if (!includeFailed && call.failed === true) continue;
    const key = call.toolCallId || call.inputFingerprint;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push(call);
  }
  return calls;
}

function referencesSameResource(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.startsWith(`${right}:`) || left.startsWith(`${right}#`)) return true;
  if (right.startsWith(`${left}:`) || right.startsWith(`${left}#`)) return true;

  const leftBase = stripReferenceSelectors(left);
  const rightBase = stripReferenceSelectors(right);
  if (leftBase === rightBase) return true;
  if (INTERNAL_URI.test(leftBase) || INTERNAL_URI.test(rightBase)) {
    return leftBase.startsWith(`${rightBase}/`) || rightBase.startsWith(`${leftBase}/`);
  }
  return false;
}

function normalizeReference(value: string): string {
  let ref = value.trim().replace(/^¶/u, "");
  while (ref.length > 0 && "`'\"([{<".includes(ref.charAt(0))) ref = ref.slice(1);
  while (ref.length > 0 && "`'\".,;!?)\\]}>".includes(ref.charAt(ref.length - 1))) ref = ref.slice(0, -1);
  if (ref.length === 0) return "";
  if (INTERNAL_URI.test(ref)) return ref;
  return normalizePath(stripReferenceSelectors(ref));
}

function stripReferenceSelectors(value: string): string {
  return value.replace(HASH_SELECTOR, "").replace(RAW_SELECTOR, "").replace(LINE_SELECTOR, "");
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const trailingSlash = path.endsWith("/");
  const segments: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part.length === 0 || part === ".") continue;
    if (part === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
      else if (!absolute) segments.push(part);
      continue;
    }
    segments.push(part);
  }
  const normalized = `${absolute ? "/" : ""}${segments.join("/")}`;
  return trailingSlash && normalized.length > 0 ? `${normalized}/` : normalized;
}

function countCodeBlocks(text: string): number {
  const complete = countMatches(text, COMPLETE_CODE_BLOCK);
  if (complete > 0) return complete;
  return text.includes("```") ? 1 : 0;
}

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(text) !== null) {
    count++;
    if (pattern.lastIndex === 0) break;
  }
  return count;
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (value.length > 0) pushUnique(result, value);
  }
  return result;
}

function limitText(text: string): string {
  return text.length <= MAX_SCAN_CHARS ? text : text.slice(0, MAX_SCAN_CHARS);
}
