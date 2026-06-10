import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  DEFAULT_REPEATED_BLOCK_LIMIT,
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
  HolmesStats,
  MessageObservationState,
  PrimitiveBurstState,
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
  const primitiveState: PrimitiveBurstState = { burst: 0 };
  const classificationState = createClassificationState();
  const turn = createTurnMetadata();
  const toolLog = createToolCallLog();
  let observationState: MessageObservationState = createObservationState();
  let visibleMarkerCountedForRequest = false;
  const delegationState = createDelegationState();
  const stats: HolmesStats = createStats();

  pi.setLabel("HOLMES");

  registerHolmesClassifyTool({
    pi,
    classification: classificationState,
    observation: () => observationState,
    turn,
    toolLog,
    stats,
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
        "  Tool:           holmes_classify",
        "  Events:         context, turn_start, before_agent_start, message_update, message_end, tool_call, tool_result",
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

      turn.latestUserRequest = latestUserRequest;
      turn.latestUserRequestDigest = digest;
      turn.turnId = classificationState.turnId;
      turn.startedAtMs = Date.now();

      toolLog.currentTurn = [];
      toolLog.repeatedBlockCount = 0;
      observationState = createObservationState(classificationState.turnId);
      visibleMarkerCountedForRequest = false;
      resetDelegation(delegationState);
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

  pi.on("message_end", (event) => {
    reconcileObservation(observationState, event);
    classificationState.sequence++;
    if (!visibleMarkerCountedForRequest && hasVisibleClassification(observationState)) {
      visibleMarkerCountedForRequest = true;
      stats.visibleMarkersObserved++;
    }
    updateClassificationComplianceFromObservation({
      classification: classificationState,
      observation: observationState,
      sequence: classificationState.sequence,
      delegation: delegationState,
      toolLog,
    });
  });

  pi.on("tool_call", (event) => {
    stats.toolCallsIntercepted++;

    const primitiveResult = handlePrimitiveBurst(
      event as HolmesToolCallEvent,
      primitiveState,
    );
    if (primitiveResult?.block) {
      stats.primitiveBurstsBlocked++;
      return primitiveResult;
    }

    if (event.toolName === HOLMES_CLASSIFY_TOOL) return undefined;

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
