import type {
  DelegationState,
  HolmesClassificationState,
  HolmesToolCallLog,
  HolmesTurnMetadata,
  MessageObservationState,
  PrimitiveBurstState,
} from "./types";
import {
  DEAD_HOLMES_AGENTS,
  EXEMPT_READ_AFTER,
  HOLMES_CLASSIFY_TOOL,
  MAX_PRIMITIVE_BURST,
  PRIMITIVE_TOOLS,
  TASK_TOOL_NAME,
  URL_RESOURCE,
  VERIFY_TOOLS,
} from "./types";
import {
  handleClassificationGate as evaluateClassificationGate,
} from "./classification";

export interface HolmesToolCallEvent {
  type?: "tool_call";
  toolCallId?: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface HolmesToolResultEvent {
  type?: "tool_result";
  toolCallId?: string;
  toolName: string;
  input: Record<string, unknown>;
  content: Array<{ type: "text"; text: string } | { type: "image"; [key: string]: unknown }>;
  isError: boolean;
  details?: unknown;
}

type ToolCallGateResult = { block?: boolean; reason?: string };
type ToolResultGateResult = { content?: HolmesToolResultEvent["content"]; details?: unknown; isError?: boolean };

const VERIFY_REMINDER =
  "Verify this change landed correctly: read the affected file and confirm the edit matches your intent.";

export function resetPrimitiveBurst(state: PrimitiveBurstState): void {
  state.burst = 0;
  state.lastTool = undefined;
}

export function resetDelegation(state: DelegationState): void {
  state.researchDelegatedThisTurn = false;
  state.verificationDelegatedThisTurn = false;
  state.taskCallsThisTurn = 0;
  state.blockedTaskCalls = 0;
}

export function handleClassificationGate(args: {
  event: HolmesToolCallEvent;
  classification: HolmesClassificationState;
  observation: MessageObservationState;
  turn: HolmesTurnMetadata;
  toolLog: HolmesToolCallLog;
  delegation: DelegationState;
  repeatedBlockLimit?: number;
}): ToolCallGateResult | undefined {
  void args.repeatedBlockLimit;
  return evaluateClassificationGate(args);
}

export function handlePrimitiveBurst(
  event: Pick<HolmesToolCallEvent, "toolName" | "input">,
  state: PrimitiveBurstState,
): ToolCallGateResult | undefined {
  const isPrimitive = PRIMITIVE_TOOLS.has(event.toolName);

  if (!isPrimitive) {
    state.burst = 0;
    state.lastTool = event.toolName;
    return undefined;
  }

  if (event.toolName === "read") {
    if (state.lastTool && EXEMPT_READ_AFTER.has(state.lastTool)) {
      state.burst = 0;
      state.lastTool = event.toolName;
      return undefined;
    }
    if (
      URL_RESOURCE.test(
        String((event.input as Record<string, unknown>).path ?? ""),
      )
    ) {
      state.burst = 0;
      state.lastTool = event.toolName;
      return undefined;
    }
  }

  state.burst += 1;
  state.lastTool = event.toolName;
  if (state.burst <= MAX_PRIMITIVE_BURST) return undefined;

  return {
    block: true,
    reason:
      "[HOLMES primitive-burst gate] Primitive exploration chain detected (" +
      state.burst +
      " consecutive). " +
      "Replace this primitive lookup chain with one read-only eval() cell that calls " +
      "read/search/find/ast_grep together, or narrow the investigation before continuing. " +
      "Direct primitives are for targeted one-shot lookups, anchor capture, or post-edit verification.",
  };
}

export function handleDelegationGuard(
  event: Pick<HolmesToolCallEvent, "toolName" | "input">,
  delegation: DelegationState,
): ToolCallGateResult | undefined {
  if (event.toolName !== TASK_TOOL_NAME) return undefined;

  delegation.taskCallsThisTurn++;

  const input = event.input as Record<string, unknown>;
  const agent = typeof input.agent === "string" ? input.agent : "";

  if (DEAD_HOLMES_AGENTS.has(agent)) {
    delegation.blockedTaskCalls++;
    const replacement = agent === "holmes-researcher" ? "explore" : "oracle";
    const role = agent === "holmes-researcher" ? "researcher" : "verifier";
    return {
      block: true,
      reason:
        `[HOLMES delegation gate] \`${agent}\` is not available as a Task agent. ` +
        `Retry with \`agent: "${replacement}"\` and include the HOLMES ${role} contract in the assignment.`,
    };
  }

  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const assignmentText = tasks
    .map((task) =>
      typeof (task as { assignment?: unknown })?.assignment === "string"
        ? String((task as { assignment: string }).assignment)
        : "",
    )
    .join("\n");
  if (agent === "explore" && /HOLMES researcher/i.test(assignmentText)) {
    delegation.researchDelegatedThisTurn = true;
  }
  if (
    (agent === "oracle" || agent === "task") &&
    /HOLMES verifier/i.test(assignmentText)
  ) {
    delegation.verificationDelegatedThisTurn = true;
  }

  return undefined;
}

export function appendVerifyReminder(
  event: HolmesToolResultEvent,
): ToolResultGateResult | undefined {
  if (event.toolName === HOLMES_CLASSIFY_TOOL) return undefined;
  if (!VERIFY_TOOLS.has(event.toolName)) return undefined;
  if (event.isError) return undefined;

  const reminder = {
    type: "text" as const,
    text: `[HOLMES] ${VERIFY_REMINDER}`,
  };
  const content = Array.isArray(event.content) ? event.content : [];
  if (content.length === 0) return { content: [reminder] };

  const last = content[content.length - 1];
  if (last?.type !== "text") {
    return { content: [...content, reminder] };
  }

  const suffix = last.text.endsWith("\n")
    ? `[HOLMES] ${VERIFY_REMINDER}`
    : `\n\n[HOLMES] ${VERIFY_REMINDER}`;
  return {
    content: [
      ...content.slice(0, -1),
      { ...last, text: `${last.text}${suffix}` },
    ],
  };
}
