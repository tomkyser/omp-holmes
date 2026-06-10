import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
  DEFAULT_GRADER_TIMEOUT_MS,
  DEFAULT_REPEATED_BLOCK_LIMIT,
  HOLMES_CHECKPOINT_TOOL,
  HOLMES_CLASSIFY_TOOL,
  MAX_SCAN_CHARS,
  createClassificationState,
  createDelegationState,
  createObservationState,
  createStats,
  createToolCallLog,
  createTurnMetadata,
} from "./types";
import type {
  AnswerCheckpointRecord,
  AnswerGateState,
  HolmesCheckpointParams,
  HolmesStats,
  PrimitiveBurstState,
  HolmesConfig,
  HolmesToolCallLog,
  MessageObservationState,
  ReasoningGraderAssessment,
} from "./types";
import {
  hasVisibleClassification,
  reconcileObservation,
  updateObservation,
} from "./observation";
import {
  expireRecordsForReason,
  registerHolmesClassifyTool,
  resetRequestLedger,
  stableHashText,
  updateClassificationComplianceFromObservation,
  updateToolResultLog,
  updateVerificationOutcome,
} from "./classification";
import {
  buildHolmesCheckpointParamsSchema,
  buildObligationContextNotice,
  collectTriageSignals,
  createAnswerGateState,
  executeHolmesCheckpoint,
  handleAgentEnd,
  processAnswerMessageEnd,
  triageAnswerObligation,
} from "./answer";
import type { ReasoningGraderRuntime } from "./answer";
import {
  createExtensionOwnedReasoningGrader,
  createReasoningGraderRequestCache,
} from "./grader";
import type { ReasoningGraderAssessor, ReasoningGraderRequestCache } from "./grader";
import type {
  HolmesToolCallEvent,
  HolmesToolResultEvent,
} from "./guards";
import {
  appendVerifyReminder,
  handleClassificationGate,
  handleDelegationGuard,
  handlePrimitiveBurst,
  resetDelegation,
  resetPrimitiveBurst,
} from "./guards";
import {
  buildHolmesGoalPrompt,
  buildHolmesPrompt,
  HOLMES_SYSTEM_PROMPT,
  VERIFY_REMINDER,
} from "./prompts";

export default function holmes(pi: ExtensionAPI): void {
  registerHolmesConfigFlags(pi);
  const resolveRuntimeConfig = (): HolmesConfig => resolveHolmesConfig(pi);
  const primitiveState: PrimitiveBurstState = { burst: 0 };
  const classificationState = createClassificationState();
  const turn = createTurnMetadata();
  const toolLog = createToolCallLog();
  let observationState: MessageObservationState = createObservationState();
  let visibleMarkerCountedForRequest = false;
  const delegationState = createDelegationState();
  const stats: HolmesStats = createStats();
  const sendMessage = pi.sendMessage.bind(pi) as ExtensionAPI["sendMessage"];
  let grader: ReasoningGraderAssessor | undefined;
  const ensureReasoningGrader = (ctx: ExtensionContext): ReasoningGraderAssessor | undefined => {
    const config = resolveRuntimeConfig();
    grader ??= createExtensionOwnedReasoningGrader({
      pi,
      ctx,
      timeoutMs: config.graderTimeoutMs,
    });
    return grader;
  };
  const hasLiveTier34ClassificationRecord = (requestDigest: string): boolean =>
    classificationState.history.some((record) =>
      record.valid &&
      record.userRequestDigest === requestDigest &&
      record.tier >= 3
    );
  const answerGraderCachesByRequest = new Map<string, ReasoningGraderRequestCache>();
  const mutationPassGraderCache = new Map<string, ReasoningGraderAssessment>();
  const graderCallsByRequestDigest = new Map<string, number>();
  const answerGraderCacheForRequest = (requestDigest: string): ReasoningGraderRequestCache => {
    const existing = answerGraderCachesByRequest.get(requestDigest);
    if (existing) return existing;
    const created = createReasoningGraderRequestCache();
    answerGraderCachesByRequest.set(requestDigest, created);
    return created;
  };
  const graderRuntime: ReasoningGraderRuntime = { cacheForDigest: answerGraderCacheForRequest };
  const pruneGraderStateForRequest = (requestDigest: string): void => {
    for (const key of answerGraderCachesByRequest.keys()) {
      if (key !== requestDigest) answerGraderCachesByRequest.delete(key);
    }
    const cacheKeyPrefix = `${requestDigest}\0`;
    for (const key of mutationPassGraderCache.keys()) {
      if (!key.startsWith(cacheKeyPrefix)) mutationPassGraderCache.delete(key);
    }
    for (const key of graderCallsByRequestDigest.keys()) {
      if (key !== requestDigest) graderCallsByRequestDigest.delete(key);
    }
  };
  // OMP can deliver agent_end while message_end is still awaiting the answer grader
  // (P1 race finding), so terminal handling must wait for in-flight answer work.
  let pendingAnswerWork: Promise<void> | undefined;
  const pendingAnswerWorks = new Set<Promise<void>>();
  const refreshPendingAnswerWork = (): void => {
    pendingAnswerWork = pendingAnswerWorks.size === 0
      ? undefined
      : Promise.all(pendingAnswerWorks).then(() => undefined);
  };
  const trackPendingAnswerWork = <T>(work: Promise<T>): Promise<T> => {
    const pending = work.then(() => undefined, () => undefined);
    pendingAnswerWorks.add(pending);
    refreshPendingAnswerWork();
    return work.finally(() => {
      pendingAnswerWorks.delete(pending);
      refreshPendingAnswerWork();
    });
  };


  pi.setLabel("HOLMES");

  registerHolmesClassifyTool({
    pi,
    classification: classificationState,
    observation: () => observationState,
    turn,
    toolLog,
    stats,
  });
  let answerState: AnswerGateState = createAnswerGateState(
    classificationState.latestUserRequestDigest,
    "none",
    classificationState.sequence,
  );

  const checkpointParameters = buildHolmesCheckpointParamsSchema(pi.typebox.Type);
  pi.registerTool<typeof checkpointParameters, AnswerCheckpointRecord>({
    name: HOLMES_CHECKPOINT_TOOL,
    label: "HOLMES checkpoint",
    description: "Submit an extension-owned HOLMES answer checkpoint for the current request.",
    parameters: checkpointParameters,
    hidden: false,
    defaultInactive: false,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await trackPendingAnswerWork(executeHolmesCheckpoint({
        params: params as HolmesCheckpointParams,
        state: answerState,
        observation: observationState,
        toolLog,
        stats,
        grader: ensureReasoningGrader(ctx),
        graderRuntime,
        requestText: classificationState.latestUserRequest,
        signal: _signal,
      }));
      return {
        content: [{ type: "text" as const, text: result.content }],
        details: result.record,
      };
    },
  });

  pi.registerCommand("holmes", {
    description: "Invoke the HOLMES impact classification loop on the current task",
    handler: async (args) => {
      pi.sendUserMessage(buildHolmesPrompt(args), { deliverAs: "followUp" });
    },
  });

  pi.registerCommand("holmes-goal", {
    description: "Structure a task as a HOLMES-informed /goal objective",
    handler: async (args) => {
      pi.sendUserMessage(buildHolmesGoalPrompt(args), {
        deliverAs: "followUp",
      });
    },
  });

  pi.registerCommand("holmes-status", {
    description: "Show HOLMES extension status and runtime counters",
    handler: async (_args, ctx) => {
      const activeRecord = classificationState.activeProcess;
      const activeLease = classificationState.activeLease;
      const openBlockers =
        activeRecord?.process.openUnknowns.filter((unknown) => unknown.blocking)
          .length ?? 0;
      const lines = [
        "HOLMES extension is active.",
        "",
        "Registered surfaces:",
        "  Commands:       /holmes, /holmes-goal, /holmes-status",
        "  Tools:          holmes_classify, holmes_checkpoint",
        "  Events:         context, turn_start, before_agent_start, message_update, message_end, agent_end, tool_call, tool_result",
        "  System prompt:  HOLMES classification checkpoint appended on every agent start",
        `  Verify reminder: ${VERIFY_REMINDER.length > 0 ? "configured" : "disabled"}`,
        "",
        "Classification state:",
        `  Request digest:            ${prefix(classificationState.latestUserRequestDigest)}`,
        `  Active tier:               ${activeRecord ? `Tier ${activeRecord.tier}` : "none"}`,
        `  Active process:            ${activeRecord?.process.status ?? "none"}`,
        `  Active lease:              ${activeLease ? `${activeLease.leaseId} (${activeLease.tools.join(", ")} ${activeLease.paths.join(", ") || "opaque"})` : "none"}`,
        `  Classification records:    ${classificationState.history.length}`,
        `  Tier 4 pass count:         ${activeRecord?.tier === 4 ? activeRecord.process.passCountAfterClassification : 0}`,
        `  Open blockers:             ${openBlockers}`,
        `  Last gate block:           ${String((classificationState as { lastGateBlockReason?: string }).lastGateBlockReason ?? "none")}`,
        `  Repeated block count:      ${toolLog.repeatedBlockCount}`,
        "",
        "Runtime counters (this session):",
        `  Turns started:               ${stats.turnsStarted}`,
        `  Tool calls intercepted:      ${stats.toolCallsIntercepted}`,
        `  Primitive bursts blocked:    ${stats.primitiveBurstsBlocked}`,
        `  Classification gate blocks:  ${stats.classificationGateBlocks}`,
        `  Classifications created:     ${stats.classificationsCreated}`,
        `  Records invalidated:         ${stats.classificationRecordsInvalidated}`,
        `  Verify reminders appended:   ${stats.verifyRemindersAppended}`,
        `  System prompt appends:       ${stats.systemPromptAppends}`,
        `  Visible markers observed:    ${stats.visibleMarkersObserved}`,
        `  Answer obligations created:  ${stats.answerObligationsCreated}`,
        `  Answer demands issued:       ${stats.answerDemandsIssued}`,
        `  Answer checkpoints satisfied: ${stats.answerCheckpointsSatisfied}`,
        `  Answer soft accepts:         ${stats.answerSoftAccepts}`,
        `  Grader calls:                ${stats.graderCalls}`,
        `  Grader cache hits:           ${stats.graderCacheHits}`,
        `  Grader hollow flags:         ${stats.graderHollowFlags}`,
        `  Reasoning soft violations:   ${stats.reasoningSoftViolations}`,
        `  Delegation task calls:       ${stats.delegationTaskCalls}`,
        `  Delegation blocked calls:    ${stats.delegationBlockedCalls}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.on("context", (event) => {
    const latestUserRequest = extractLatestUserRequest(event.messages);
    const digest = stableHashText(latestUserRequest);

    if (digest !== classificationState.latestUserRequestDigest) {
      const invalidated = classificationState.history.filter((record) => record.valid).length;
      if (invalidated > 0) {
        expireRecordsForReason(classificationState, "new_user_request");
        stats.classificationRecordsInvalidated += invalidated;
      }
      classificationState.latestUserRequest = latestUserRequest;
      classificationState.latestUserRequestDigest = digest;
      classificationState.turnId++;
      classificationState.sequence++;
      classificationState.lastGateBlockByEffect.clear();
      resetRequestLedger(classificationState, digest);
      pruneGraderStateForRequest(digest);

      turn.latestUserRequest = latestUserRequest;
      turn.latestUserRequestDigest = digest;
      turn.turnId = classificationState.turnId;
      turn.startedAtMs = Date.now();

      resetToolLogForNewRequest(toolLog, digest);
      observationState = createObservationState(classificationState.turnId);
      visibleMarkerCountedForRequest = false;
      resetDelegation(delegationState);

      const signals = collectTriageSignals(latestUserRequest);
      const level = triageAnswerObligation(signals);
      answerState = createAnswerGateState(
        digest,
        level,
        classificationState.sequence,
      );
      if (level !== "none") stats.answerObligationsCreated++;
    }

    const notice = buildObligationContextNotice(answerState);
    if (notice) {
      return {
        messages: [
          ...event.messages,
          {
            role: "user" as const,
            content: notice,
            synthetic: true,
            timestamp: Date.now(),
          },
        ],
      };
    }
    return undefined;
  });

  pi.on("turn_start", () => {
    stats.turnsStarted++;
    resetPrimitiveBurst(primitiveState);
    resetDelegation(delegationState);
    toolLog.currentTurn = [];
  });

  pi.on("before_agent_start", (event) => {
    stats.systemPromptAppends++;
    return { systemPrompt: [...event.systemPrompt, HOLMES_SYSTEM_PROMPT] };
  });

  pi.on("message_update", (event) => {
    updateObservation(observationState, event);
    if (!visibleMarkerCountedForRequest && hasVisibleClassification(observationState)) {
      visibleMarkerCountedForRequest = true;
      stats.visibleMarkersObserved++;
    }
  });

  pi.on("message_end", async (event, ctx) => {
    await trackPendingAnswerWork((async () => {
      reconcileObservation(observationState, event);
      classificationState.sequence++;
      if (!visibleMarkerCountedForRequest && hasVisibleClassification(observationState)) {
        visibleMarkerCountedForRequest = true;
        stats.visibleMarkersObserved++;
      }
      const config = resolveRuntimeConfig();
      const reasoningGrader = ensureReasoningGrader(ctx);
      await updateClassificationComplianceFromObservation({
        classification: classificationState,
        observation: observationState,
        sequence: classificationState.sequence,
        delegation: delegationState,
        toolLog,
        config,
        stats,
        grader: reasoningGrader,
        graderCache: mutationPassGraderCache,
        graderCallsByRequestDigest,
      });
      await processAnswerMessageEnd({
        state: answerState,
        observation: observationState,
        toolLog,
        stats,
        sequence: classificationState.sequence,
        grader: reasoningGrader,
        graderRuntime,
        requestText: classificationState.latestUserRequest,
        liveTier34Record: hasLiveTier34ClassificationRecord(answerState.requestDigest),
      });
    })());
  });

  pi.on("agent_end", async (_event, ctx) => {
    for (;;) {
      const pending = pendingAnswerWork;
      if (!pending) break;
      try {
        await pending;
      } catch {
        // message_end/checkpoint owns reporting; agent_end only needs the settled state.
      }
      if (pendingAnswerWork === pending) break;
    }
    handleAgentEnd({
      state: answerState,
      observation: observationState,
      hasUI: ctx.hasUI,
      sendMessage,
      ui: ctx.ui,
      stats,
    });
  });

  pi.on("tool_call", (event) => {
    stats.toolCallsIntercepted++;
    if (event.toolName === HOLMES_CLASSIFY_TOOL || event.toolName === HOLMES_CHECKPOINT_TOOL) return undefined;

    const primitiveResult = handlePrimitiveBurst(
      event as HolmesToolCallEvent,
      primitiveState,
    );
    if (primitiveResult?.block) {
      stats.primitiveBurstsBlocked++;
      return primitiveResult;
    }

    const delegationResult = handleDelegationGuard(
      event as HolmesToolCallEvent,
      delegationState,
    );
    if (delegationResult?.block) {
      stats.delegationBlockedCalls++;
      return delegationResult;
    }

    const classificationResult = handleClassificationGate({
      event: event as HolmesToolCallEvent,
      classification: classificationState,
      observation: observationState,
      turn,
      toolLog,
      delegation: delegationState,
      repeatedBlockLimit: DEFAULT_REPEATED_BLOCK_LIMIT,
    });
    if (classificationResult?.block) {
      stats.classificationGateBlocks++;
      return classificationResult;
    }

    if (event.toolName === "task") stats.delegationTaskCalls++;
    return undefined;
  });

  pi.on("tool_result", (event) => {
    classificationState.sequence++;
    updateToolResultLog(toolLog, event as HolmesToolResultEvent);
    updateVerificationOutcome(classificationState, event as HolmesToolResultEvent);

    if (event.toolName === HOLMES_CLASSIFY_TOOL) return undefined;

    const result = appendVerifyReminder(event);
    if (result) stats.verifyRemindersAppended++;
    return result;
  });

  pi.on("session_start", (_event, ctx) => {
    const allTools = safeToolList(() => pi.getAllTools());
    const activeTools = safeToolList(() => pi.getActiveTools());
    const toolStatus = allTools.includes(HOLMES_CLASSIFY_TOOL)
      ? activeTools.length === 0 || activeTools.includes(HOLMES_CLASSIFY_TOOL)
        ? "active"
        : "registered but inactive"
      : "not registered";
    ctx.ui.notify(`HOLMES classification checkpoint active (${toolStatus})`, "info");
  });
}

function extractLatestUserRequest(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as { role?: unknown; content?: unknown };
    if (message?.role !== "user") continue;
    return limitText(contentToText(message.content));
  }
  return "";
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function safeToolList(readTools: () => string[]): string[] {
  try {
    return readTools();
  } catch {
    return [];
  }
}

function prefix(value: string): string {
  return value.length <= 12 ? value || "none" : value.slice(0, 12);
}

function limitText(value: string): string {
  return value.length <= MAX_SCAN_CHARS ? value : value.slice(0, MAX_SCAN_CHARS);
}

export const HOLMES_GRADE_MUTATION_PASSES_FLAG = "holmes-grade-mutation-passes";
export const HOLMES_GRADER_TIMEOUT_MS_FLAG = "holmes-grader-timeout-ms";

const MIN_HOLMES_GRADER_TIMEOUT_MS = 1;
const MAX_HOLMES_GRADER_TIMEOUT_MS = 8_000;

export interface HolmesConfigFlagReader {
  getFlag(name: string): boolean | string | undefined;
}

function registerHolmesConfigFlags(pi: Pick<ExtensionAPI, "registerFlag">): void {
  // Extension-owned config uses registered CLI flags: ExtensionAPI.registerFlag/getFlag
  // are the real extension surface in @oh-my-pi/pi-coding-agent 15.10.12
  // (dist/types/extensibility/extensions/types.d.ts:616-625). ExtensionContext
  // itself only exposes UI/session/model/cwd/memory (same file:176-205), not
  // ctx.config/ctx.settings.
  pi.registerFlag(HOLMES_GRADE_MUTATION_PASSES_FLAG, {
    description: "Enable HOLMES mutation-pass reasoning grading.",
    type: "boolean",
    default: false,
  });
  pi.registerFlag(HOLMES_GRADER_TIMEOUT_MS_FLAG, {
    description: "HOLMES reasoning grader timeout in milliseconds (1..8000).",
    type: "string",
    default: String(DEFAULT_GRADER_TIMEOUT_MS),
  });
}

export function resolveHolmesConfig(flags: HolmesConfigFlagReader): HolmesConfig {
  return {
    gradeMutationPasses: parseHolmesBooleanFlag(
      flags.getFlag(HOLMES_GRADE_MUTATION_PASSES_FLAG),
    ),
    graderTimeoutMs: parseHolmesTimeoutFlag(flags.getFlag(HOLMES_GRADER_TIMEOUT_MS_FLAG)),
  };
}

function resetToolLogForNewRequest(toolLog: HolmesToolCallLog, requestDigest: string): void {
  toolLog.currentTurn = [];
  // Fresh request state keeps only the incoming digest bucket. Clearing every old
  // bucket mirrors grader-cache pruning and prevents repeated text/digest
  // collisions from inheriting stale attempts.
  toolLog.byUserRequestDigest.clear();
  toolLog.byUserRequestDigest.set(requestDigest, []);
  toolLog.repeatedBlockCount = 0;
}

function parseHolmesBooleanFlag(value: boolean | string | undefined): boolean {
  if (value === true) return true;
  if (value !== false && typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true";
  }
  return false;
}

function parseHolmesTimeoutFlag(value: boolean | string | undefined): number {
  if (typeof value !== "string") return DEFAULT_GRADER_TIMEOUT_MS;
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) return DEFAULT_GRADER_TIMEOUT_MS;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return DEFAULT_GRADER_TIMEOUT_MS;
  return Math.min(MAX_HOLMES_GRADER_TIMEOUT_MS, Math.max(MIN_HOLMES_GRADER_TIMEOUT_MS, parsed));
}
