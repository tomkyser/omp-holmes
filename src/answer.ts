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
  createReasoningGraderRequestCache,
  mapGraderOutcomeToObligations,
  type ReasoningGraderAssessor,
  type ReasoningGraderRequestCache,
} from "./grader";

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


type ComplianceDetails = {
  satisfied: boolean;
  missingAxes: string[];
  passText: string;
  verifiedEvidenceIds: string[];
  unverifiedMentions: string[];
};

const graderCachesByRequest = new Map<string, ReasoningGraderRequestCache>();

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
    phase: level === "none" ? "satisfied" : "obligated",
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
  liveTier34Record: boolean;
}): Promise<void> {
  if (args.state.phase === "idle" || TERMINAL_PHASE[args.state.phase]) return;

  const calls = toolCallsForRequest(args.toolLog, args.state.requestDigest);
  const nextLevel = escalateAnswerObligation(args.state.level, {
    toolCallsThisRequest: calls.length,
    effectfulToolCalls: calls.filter((call) => call.effectful).length,
    finalVisibleChars: args.observation.visibleText.length,
    codeBlocksInAnswer: countCodeBlocks(args.observation.visibleText),
    liveTier34Record: args.liveTier34Record,
  });
  args.state.level = nextLevel;

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
  if (
    args.state.phase === "idle" ||
    args.state.phase === "satisfied" ||
    args.state.phase === "soft_accept" ||
    args.state.level === "none"
  ) {
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
  stats?: HolmesStats;
}): Promise<{ content: string; record: AnswerCheckpointRecord }> {
  const shapeFailures = checkpointShapeFailures(args.params);
  const mentions = checkpointEvidenceMentions(args.params);
  const evidence = crossCheckEvidence(mentions, args.toolLog, args.state.requestDigest);
  const unverifiedClosedUnknowns = args.params.unknowns.filter(
    (unknown) => unknown.status === "closed" && !referenceIsVerified(unknown.closedBy ?? "", args.toolLog, args.state.requestDigest),
  );
  const shapeOk = shapeFailures.length === 0;
  const fullClosureOk = args.state.level !== "full" || unverifiedClosedUnknowns.length === 0;
  const deterministicSatisfied = shapeOk && fullClosureOk;
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
    args.state.checkpointRecords.push(record);
    return {
      content: checkpointVerdict(false, shapeFailures.length > 0 ? shapeFailures : ["verified_closure"], "repair_with_visible_pass_or_checkpoint"),
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
      stats: args.stats,
    });
    record.grader = grade.outcome;
    args.state.checkpointRecords.push(record);
    if (grade.withholdSatisfaction) {
      if (args.stats) consumeGraderHollowFlag(args.state, args.stats);
      else args.state.graderHollowFlags++;
      return {
        content: checkpointVerdict(false, grade.outcome.defectAxes, "bounded_grader_repair"),
        record,
      };
    }
    if (shouldSoftAcceptCappedGraderRejection(args.state, grade.outcome)) {
      if (args.stats) softAccept(args.state, args.stats);
      else args.state.phase = "soft_accept";
      return { content: checkpointVerdict(false, grade.outcome.defectAxes, "bounded_grader_advisory"), record };
    }
    if (args.stats) satisfyAnswerGate(args.state, args.stats);
    else args.state.phase = "satisfied";
    return { content: checkpointVerdict(true, [], "satisfied"), record };
  }

  args.state.checkpointRecords.push(record);
  if (args.stats) satisfyAnswerGate(args.state, args.stats);
  else args.state.phase = "satisfied";
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
  if (args.state.phase === "satisfied" || args.state.level === "none") {
    return emptyCompliance(true);
  }

  const passText = redactSelfClassification(args.observation.visibleText);
  if (args.sequence < args.state.createdAtSequence) {
    return {
      ...emptyCompliance(false),
      passText,
      missingAxes: ["answer_sequence"],
    };
  }

  if (args.state.level === "light") {
    const sections = detectTier2Compliance(passText);
    const missing = [
      ...(sections.target ? [] : ["target_section"]),
      ...(sections.delta ? [] : ["delta_section"]),
      ...(sections.next ? [] : ["next_section"]),
    ];
    return {
      satisfied: missing.length === 0,
      missingAxes: missing,
      passText,
      verifiedEvidenceIds: [],
      unverifiedMentions: [],
    };
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

  return {
    satisfied: missingAxes.length === 0,
    missingAxes,
    passText,
    verifiedEvidenceIds: evidence.verifiedEvidenceIds,
    unverifiedMentions: evidence.unverifiedMentions,
  };
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
  stats?: HolmesStats;
}): Promise<{ outcome: ReasoningGraderOutcome; withholdSatisfaction: boolean }> {
  const { packet } = buildReasoningGraderPacket({
    level: args.state.level,
    observation: args.observation,
    toolLog: args.toolLog,
    checkpointParams: args.checkpointParams,
  });
  let cached = false;
  let assessment: ReasoningGraderAssessment;
  if (args.stats) {
    const cache = reasoningCacheForRequest(args.state.requestDigest);
    try {
      const result = await assessReasoningWithCache({
        packet,
        assessor: args.grader,
        cache,
        stats: args.stats,
      });
      assessment = result.assessment;
      cached = result.cached;
    } catch {
      assessment = { status: "failed", defects: [], requiredAdditions: ["grader_unavailable"] };
    }
  } else {
    assessment = await callGrader(args.grader, packet, undefined);
  }

  const mapped = mapGraderOutcomeToObligations(assessment, args.state);
  const outcome = graderOutcome(assessment, mapped.obligations, cached);
  return {
    outcome,
    withholdSatisfaction: mapped.withholdSatisfaction,
  };
}

async function callGrader(
  grader: ReasoningGraderAssessor,
  packet: Parameters<ReasoningGraderAssessor>[0],
  stats: HolmesStats | undefined,
): Promise<ReasoningGraderAssessment> {
  if (stats) stats.graderCalls++;
  try {
    return await grader(packet);
  } catch {
    return { status: "failed", defects: [], requiredAdditions: ["grader_unavailable"] };
  }
}

function reasoningCacheForRequest(requestDigest: string): ReasoningGraderRequestCache {
  const existing = graderCachesByRequest.get(requestDigest);
  if (existing) return existing;
  const created = createReasoningGraderRequestCache();
  graderCachesByRequest.set(requestDigest, created);
  return created;
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
  return (
    state.phase === "awaiting_repair" &&
    state.graderHollowFlags >= MAX_GRADER_HOLLOW_FLAGS &&
    (outcome.verdict === "hollow" || outcome.verdict === "incoherent")
  );
}

function consumeGraderHollowFlag(state: AnswerGateState, stats: HolmesStats): void {
  if (state.graderHollowFlags >= MAX_GRADER_HOLLOW_FLAGS) return;
  state.graderHollowFlags++;
  stats.graderHollowFlags++;
}

function satisfyAnswerGate(state: AnswerGateState, stats: HolmesStats): void {
  if (state.phase === "satisfied") return;
  state.phase = "satisfied";
  stats.answerCheckpointsSatisfied++;
}

function softAccept(state: AnswerGateState, stats: HolmesStats): void {
  if (state.phase === "soft_accept") return;
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

function toolCallsForRequest(toolLog: HolmesToolCallLog, requestDigest: string): ToolCallSummary[] {
  const calls: ToolCallSummary[] = [];
  const seen = new Set<string>();
  for (const call of [...(toolLog.byUserRequestDigest.get(requestDigest) ?? []), ...toolLog.currentTurn]) {
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
