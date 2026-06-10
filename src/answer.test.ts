import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
  buildCheckpointDemand,
  buildObligationContextNotice,
  collectTriageSignals,
  createAnswerGateState,
  escalateAnswerObligation,
  evaluateAnswerCompliance,
  executeHolmesCheckpoint,
  handleAgentEnd,
  processAnswerMessageEnd,
  triageAnswerObligation,
  type ReasoningGraderRuntime,
} from "./answer";
import {
  createReasoningGraderRequestCache,
  type ReasoningGraderAssessor,
  type ReasoningGraderRequestCache,
} from "./grader";
import {
  ANSWER_HEAVY_CHARS,
  ANSWER_SUBSTANTIVE_CHARS,
  ANSWER_TOOLCALL_FULL,
  ANSWER_TOOLCALL_LIGHT,
  ANSWER_TRIVIAL_REQUEST_CHARS,
  createObservationState,
  createStats,
  type AnswerEscalationFacts,
  type AnswerGatePhase,
  type AnswerGateState,
  type AnswerObligationLevel,
  type HolmesCheckpointParams,
  type HolmesStats,
  type HolmesToolCallLog,
  type MessageObservationState,
  type ToolCallSummary,
} from "./types";

const REQUEST_DIGEST = "request-digest";
const LEVEL_RANK: Record<AnswerObligationLevel, number> = { none: 0, light: 1, full: 2 };
const CLOSED_OR_QUIESCENT: Partial<Record<AnswerGatePhase, true>> = {
  idle: true,
  satisfied: true,
  soft_accept: true,
};

describe("answer obligation triage and escalation", () => {
  test("triages request signals at plan thresholds", () => {
    expect(triageAnswerObligation(collectTriageSignals("What changed?"))).toBe("none");
    expect(triageAnswerObligation(collectTriageSignals("x".repeat(ANSWER_TRIVIAL_REQUEST_CHARS - 1)))).toBe("none");
    expect(triageAnswerObligation(collectTriageSignals("x".repeat(ANSWER_TRIVIAL_REQUEST_CHARS)))).toBe("light");
    expect(triageAnswerObligation(collectTriageSignals("What? Why?"))).toBe("light");
    expect(triageAnswerObligation(collectTriageSignals("Show code:\n```ts\nconst x = 1;\n```"))).toBe("light");
    expect(triageAnswerObligation(collectTriageSignals("Please debug this:\n```ts\nthrow err;\n```"))).toBe("full");
    expect(triageAnswerObligation(collectTriageSignals("Debug and design the migration."))).toBe("full");
    expect(triageAnswerObligation(collectTriageSignals("Please plan this\n1. inspect\n2. implement"))).toBe("full");
  });

  test("escalates monotonically at answer and tool-call boundaries", () => {
    expect(escalateAnswerObligation("none", facts({ finalVisibleChars: ANSWER_SUBSTANTIVE_CHARS - 1 }))).toBe("none");
    expect(escalateAnswerObligation("none", facts({ finalVisibleChars: ANSWER_SUBSTANTIVE_CHARS }))).toBe("light");
    expect(escalateAnswerObligation("none", facts({ toolCallsThisRequest: ANSWER_TOOLCALL_LIGHT - 1 }))).toBe("none");
    expect(escalateAnswerObligation("none", facts({ toolCallsThisRequest: ANSWER_TOOLCALL_LIGHT }))).toBe("light");
    expect(escalateAnswerObligation("none", facts({ toolCallsThisRequest: ANSWER_TOOLCALL_FULL }))).toBe("full");
    expect(escalateAnswerObligation("light", facts({ finalVisibleChars: ANSWER_HEAVY_CHARS - 1, codeBlocksInAnswer: 2 }))).toBe("light");
    expect(escalateAnswerObligation("light", facts({ finalVisibleChars: ANSWER_HEAVY_CHARS, codeBlocksInAnswer: 2 }))).toBe("full");
    expect(escalateAnswerObligation("full", facts())).toBe("full");

    const levels: AnswerObligationLevel[] = ["none", "light", "full"];
    const factCases: AnswerEscalationFacts[] = [
      facts(),
      facts({ finalVisibleChars: ANSWER_SUBSTANTIVE_CHARS }),
      facts({ codeBlocksInAnswer: 1 }),
      facts({ toolCallsThisRequest: ANSWER_TOOLCALL_LIGHT }),
      facts({ toolCallsThisRequest: ANSWER_TOOLCALL_FULL }),
      facts({ finalVisibleChars: ANSWER_HEAVY_CHARS, codeBlocksInAnswer: 2 }),
      facts({ liveTier34Record: true }),
    ];

    for (const level of levels) {
      for (const factCase of factCases) {
        const escalated = escalateAnswerObligation(level, factCase);
        expect(LEVEL_RANK[escalated]).toBeGreaterThanOrEqual(LEVEL_RANK[level]);
      }
    }
  });
});

describe("answer gate state machine", () => {
  test("all phase and event combinations close or quiesce within two agent-end transitions", async () => {
    // RT: none-state escalation
    const phases: AnswerGatePhase[] = ["idle", "obligated", "awaiting_repair", "satisfied", "soft_accept"];
    const events: Array<{
      name: string;
      apply: (state: AnswerGateState, stats: HolmesStats, sendMessage: ExtensionAPI["sendMessage"]) => Promise<void> | void;
    }> = [
      {
        name: "compliant_message_end",
        apply: (state, stats) => processAnswerMessageEnd({
          state,
          observation: visible(lightPass()),
          toolLog: toolLogWithCalls(0, [], state.requestDigest),
          stats,
          sequence: state.createdAtSequence,
          liveTier34Record: false,
        }),
      },
      {
        name: "noncompliant_message_end",
        apply: (state, stats) => processAnswerMessageEnd({
          state,
          observation: visible("No structured answer."),
          toolLog: toolLogWithCalls(0, [], state.requestDigest),
          stats,
          sequence: state.createdAtSequence,
          liveTier34Record: false,
        }),
      },
      {
        name: "agent_end",
        apply: (state, stats, sendMessage) => handleAgentEnd({
          state,
          observation: visible("No structured answer."),
          hasUI: false,
          sendMessage,
          stats,
        }),
      },
    ];

    for (const phase of phases) {
      for (const event of events) {
        const state = createAnswerGateState(`${REQUEST_DIGEST}:${phase}:${event.name}`, "light", 1);
        state.phase = phase;
        const stats = createStats();
        const before = counterSnapshot(stats, state);
        const dispatches = { count: 0 };
        const sendMessage: ExtensionAPI["sendMessage"] = () => {
          dispatches.count++;
        };

        await event.apply(state, stats, sendMessage);
        for (let transition = 0; transition < 2 && !CLOSED_OR_QUIESCENT[state.phase]; transition++) {
          handleAgentEnd({
            state,
            observation: visible("No structured answer."),
            hasUI: false,
            sendMessage,
            stats,
          });
        }

        expect(CLOSED_OR_QUIESCENT[state.phase]).toBe(true);
        expect(dispatches.count).toBeLessThanOrEqual(1);
        expectCountersNeverDecrease(before, counterSnapshot(stats, state));
      }
    }
  });

  test("none-level obligations stay frictionless unless observed facts escalate", async () => {
    // RT: none-state escalation
    const state = createAnswerGateState("none-request", "none", 1);
    const stats = createStats();
    const before = counterSnapshot(stats, state);
    const dispatches = { count: 0 };
    const sendMessage: ExtensionAPI["sendMessage"] = () => {
      dispatches.count++;
    };

    expect(state.phase).toBe("obligated");
    expect(buildObligationContextNotice(state)).toBeUndefined();
    await processAnswerMessageEnd({
      state,
      observation: visible("Short answer."),
      toolLog: toolLogWithCalls(0, [], state.requestDigest),
      stats,
      sequence: 1,
      liveTier34Record: false,
    });
    expect(state.phase).toBe("obligated");
    handleAgentEnd({ state, observation: visible("Short answer."), hasUI: false, sendMessage, stats });
    expect(state.phase).toBe("satisfied");
    expect(dispatches.count).toBe(0);
    expect(counterSnapshot(stats, state)).toEqual(before);

    const promoted = createAnswerGateState("none-promoted", "none", 1);
    const promotedStats = createStats();
    const promotedDispatches = { count: 0 };
    const promotedSendMessage: ExtensionAPI["sendMessage"] = () => {
      promotedDispatches.count++;
    };
    await processAnswerMessageEnd({
      state: promoted,
      observation: visible("No structured answer."),
      toolLog: toolLogWithCalls(ANSWER_TOOLCALL_LIGHT, [], promoted.requestDigest),
      stats: promotedStats,
      sequence: 1,
      liveTier34Record: false,
    });
    expect(promoted.level).toBe("light");
    expect(promoted.phase).toBe("obligated");
    expect(promotedStats.answerObligationsCreated).toBe(1);
    expect(buildObligationContextNotice(promoted)).toContain("light");
    handleAgentEnd({ state: promoted, observation: visible("No structured answer."), hasUI: false, sendMessage: promotedSendMessage, stats: promotedStats });
    expect(promoted.phase).toBe("awaiting_repair");
    expect(promotedDispatches.count).toBe(1);
    expect(promotedStats.answerDemandsIssued).toBe(1);
  });

  test("checkpoint-first light satisfaction reopens when later facts require full", async () => {
    // RT: checkpoint-first bypass
    const state = createAnswerGateState("checkpoint-first-reopen", "light", 1);
    const stats = createStats();
    const checkpoint = await executeHolmesCheckpoint({
      params: checkpointParams(),
      state,
      observation: visible(""),
      toolLog: toolLogWithCalls(0, [], state.requestDigest),
      stats,
    });

    expect(checkpoint.content).toContain("satisfied");
    expect(state.phase).toBe("satisfied");
    expect(state.satisfiedAtLevel).toBe("light");

    const fullAttemptLog = toolLogWithCalls(ANSWER_TOOLCALL_FULL, ["src/answer.ts"], state.requestDigest);
    await processAnswerMessageEnd({
      state,
      observation: visible("No structured full pass."),
      toolLog: fullAttemptLog,
      stats,
      sequence: 1,
      liveTier34Record: true,
    });

    expect(state.level).toBe("full");
    expect(state.phase).toBe("obligated");
    expect(state.satisfiedAtLevel).toBe("light");

    const dispatches = { count: 0 };
    const sendMessage: ExtensionAPI["sendMessage"] = () => {
      dispatches.count++;
    };
    handleAgentEnd({ state, observation: visible("No structured full pass."), hasUI: false, sendMessage, stats });
    expect(state.phase).toBe("awaiting_repair");
    expect(state.retriesUsed).toBe(1);
    expect(dispatches.count).toBe(1);
    expect(stats.answerDemandsIssued).toBe(1);

    await processAnswerMessageEnd({
      state,
      observation: visible(fullPass("src/answer.ts")),
      toolLog: fullAttemptLog,
      stats,
      sequence: 1,
      liveTier34Record: true,
    });

    expect(state.phase).toBe("satisfied");
    expect(state.satisfiedAtLevel).toBe("full");
  });

  test("reopen bound preserves one demand across none to light to full", async () => {
    // RT: reopen bound
    const state = createAnswerGateState("bounded-reopen", "none", 1);
    const stats = createStats();
    const dispatches = { count: 0 };
    const sendMessage: ExtensionAPI["sendMessage"] = () => {
      dispatches.count++;
    };
    let reopens = 0;

    handleAgentEnd({ state, observation: visible("Short answer."), hasUI: false, sendMessage, stats });
    expect(state.phase).toBe("satisfied");
    expect(state.satisfiedAtLevel).toBe("none");

    const lightAttemptLog = toolLogWithCalls(ANSWER_TOOLCALL_LIGHT, [], state.requestDigest);
    await processAnswerMessageEnd({
      state,
      observation: visible("No structured light pass."),
      toolLog: lightAttemptLog,
      stats,
      sequence: 1,
      liveTier34Record: false,
    });
    if (state.phase === "obligated") reopens++;
    expect(state.level).toBe("light");
    expect(state.phase).toBe("obligated");
    expect(stats.answerObligationsCreated).toBe(1);

    handleAgentEnd({ state, observation: visible("No structured light pass."), hasUI: false, sendMessage, stats });
    expect(state.phase).toBe("awaiting_repair");
    expect(state.retriesUsed).toBe(1);
    expect(dispatches.count).toBe(1);

    await processAnswerMessageEnd({
      state,
      observation: visible(lightPass()),
      toolLog: lightAttemptLog,
      stats,
      sequence: 1,
      liveTier34Record: false,
    });
    expect(state.phase).toBe("satisfied");
    expect(state.satisfiedAtLevel).toBe("light");

    const fullAttemptLog = toolLogWithCalls(ANSWER_TOOLCALL_FULL, ["src/answer.ts"], state.requestDigest);
    await processAnswerMessageEnd({
      state,
      observation: visible("Still missing a full pass."),
      toolLog: fullAttemptLog,
      stats,
      sequence: 1,
      liveTier34Record: true,
    });
    if (state.phase === "obligated") reopens++;
    expect(state.level).toBe("full");
    expect(state.phase).toBe("obligated");
    expect(stats.answerObligationsCreated).toBe(1);

    handleAgentEnd({ state, observation: visible("Still missing a full pass."), hasUI: false, sendMessage, stats });
    expect(state.phase).toBe("soft_accept");
    expect(reopens).toBeLessThanOrEqual(2);
    expect(stats.answerDemandsIssued).toBeLessThanOrEqual(1);
    expect(dispatches.count).toBe(1);
    expect(state.retriesUsed).toBe(1);
  });

  test("terminal phases absorb repeated agent_end cycles without dispatch", () => {
    // RT: terminal guards
    for (const phase of ["satisfied", "soft_accept"] as const) {
      const state = createAnswerGateState(`${REQUEST_DIGEST}:${phase}`, "light", 1);
      state.phase = phase;
      const stats = createStats();
      const before = counterSnapshot(stats, state);
      const dispatches = { count: 0 };
      const sendMessage: ExtensionAPI["sendMessage"] = () => {
        dispatches.count++;
      };

      for (let index = 0; index < 10; index++) {
        handleAgentEnd({
          state,
          observation: visible("still done"),
          hasUI: false,
          sendMessage,
          stats,
        });
      }

      expect(state.phase).toBe(phase);
      expect(dispatches.count).toBe(0);
      expect(counterSnapshot(stats, state)).toEqual(before);
    }
  });

  test("soft_accept never reopens under later full escalation", async () => {
    // RT: soft_accept absorbing
    const state = createAnswerGateState("soft-accept-absorbing", "light", 1);
    state.phase = "soft_accept";
    state.satisfiedAtLevel = "light";
    const stats = createStats();
    const before = counterSnapshot(stats, state);

    await processAnswerMessageEnd({
      state,
      observation: visible(fullPass("src/answer.ts")),
      toolLog: toolLogWithCalls(ANSWER_TOOLCALL_FULL, ["src/answer.ts"], state.requestDigest),
      stats,
      sequence: 1,
      liveTier34Record: true,
    });

    expect(state.phase).toBe("soft_accept");
    expect(state.level).toBe("light");
    expect(state.satisfiedAtLevel).toBe("light");
    expect(counterSnapshot(stats, state)).toEqual(before);
  });

  test("context notice and demand name exits and dimensions", () => {
    // RT: none-state escalation
    const state = createAnswerGateState(REQUEST_DIGEST, "full", 1);
    expect(buildObligationContextNotice(state)).toContain("holmes_checkpoint");
    expect(buildObligationContextNotice(createAnswerGateState(`${REQUEST_DIGEST}:none`, "none", 1))).toBeUndefined();
    const demand = buildCheckpointDemand("full", ["verified_evidence"]);
    expect(demand).toContain("verified_evidence");
    expect(demand).toContain("This demand is issued once; it will not repeat.");
  });

  test("demand uses the last precise compliance axes", async () => {
    // RT: missing-axes precision
    const state = createAnswerGateState("missing-axis-request", "light", 1);
    const stats = createStats();
    let content = "";
    const sendMessage: ExtensionAPI["sendMessage"] = (message) => {
      content = typeof message.content === "string" ? message.content : "";
    };

    await processAnswerMessageEnd({
      state,
      observation: visible("TARGET: only the target is present"),
      toolLog: toolLogWithCalls(0, [], state.requestDigest),
      stats,
      sequence: 1,
      liveTier34Record: false,
    });
    handleAgentEnd({ state, observation: visible("TARGET: only the target is present"), hasUI: false, sendMessage, stats });

    expect(content).toContain("delta_section");
    expect(content).toContain("next_section");
    expect(content).not.toContain("target_section");
  });
});

describe("answer compliance evaluation", () => {
  test("light pass is visible-only and sequence-gated", () => {
    const state = createAnswerGateState(REQUEST_DIGEST, "light", 10);
    const observation = visible(lightPass());

    expect(evaluateAnswerCompliance({ state, observation, toolLog: toolLogWithCalls(), sequence: 9 })).toEqual({
      satisfied: false,
      missingAxes: ["answer_sequence"],
    });
    expect(evaluateAnswerCompliance({ state, observation, toolLog: toolLogWithCalls(), sequence: 10 })).toEqual({
      satisfied: true,
      missingAxes: [],
    });

    expect(evaluateAnswerCompliance({
      state,
      observation: thinkingOnly(lightPass()),
      toolLog: toolLogWithCalls(),
      sequence: 10,
    }).satisfied).toBe(false);
    expect(evaluateAnswerCompliance({
      state,
      observation: visible("HOLMES: Tier 2 TARGET: done DELTA: changed NEXT: stop"),
      toolLog: toolLogWithCalls(),
      sequence: 10,
    }).satisfied).toBe(false);
  });

  test("full visible pass requires verified evidence and zero-tool-call requests use checkpoint only", () => {
    const state = createAnswerGateState(REQUEST_DIGEST, "full", 1);
    const observation = visible(fullPass("src/answer.ts"));

    expect(evaluateAnswerCompliance({
      state,
      observation,
      toolLog: toolLogWithCalls(1, ["src/answer.ts"]),
      sequence: 1,
    })).toEqual({ satisfied: true, missingAxes: [] });
    expect(evaluateAnswerCompliance({
      state,
      observation,
      toolLog: toolLogWithCalls(1, ["src/other.ts"]),
      sequence: 1,
    })).toEqual({ satisfied: false, missingAxes: ["verified_evidence"] });
    expect(evaluateAnswerCompliance({
      state,
      observation,
      toolLog: toolLogWithCalls(),
      sequence: 1,
    })).toEqual({ satisfied: false, missingAxes: ["verified_evidence"] });
  });

  test("failed tool calls are not eligible evidence for full visible passes", () => {
    // RT: failed-evidence
    const state = createAnswerGateState("failed-evidence", "full", 1);
    const observation = visible(fullPass("src/answer.ts"));

    expect(evaluateAnswerCompliance({
      state,
      observation,
      toolLog: toolLogWithCalls(1, ["src/answer.ts"], state.requestDigest, true),
      sequence: 1,
    })).toEqual({ satisfied: false, missingAxes: ["verified_evidence"] });

    expect(evaluateAnswerCompliance({
      state,
      observation,
      toolLog: toolLogWithCalls(1, ["src/answer.ts"], state.requestDigest),
      sequence: 1,
    })).toEqual({ satisfied: true, missingAxes: [] });
  });

  test("full grader can withhold once, then the cap lets deterministic satisfaction stand", async () => {
    // RT: capped-hollow telemetry
    const state = createAnswerGateState("grader-request", "full", 1);
    const stats = createStats();
    const observation = visible(fullPass("src/answer.ts"));
    const toolLog = toolLogWithCalls(1, ["src/answer.ts"], state.requestDigest);
    const hollowGrader: ReasoningGraderAssessor = async () => ({
      status: "succeeded",
      verdict: "hollow",
      defects: [{ axis: "chain", severity: "high", detail: "chain is hollow", citedEvidence: ["src/answer.ts"] }],
      requiredAdditions: ["chain"],
    });
    const graderRuntime = testGraderRuntime();

    await processAnswerMessageEnd({
      state,
      observation,
      toolLog,
      stats,
      sequence: 1,
      grader: hollowGrader,
      graderRuntime,
      liveTier34Record: false,
    });
    expect(state.phase).toBe("obligated");
    expect(state.graderHollowFlags).toBe(1);
    expect(stats.graderHollowFlags).toBe(1);

    await processAnswerMessageEnd({
      state,
      observation,
      toolLog,
      stats,
      sequence: 1,
      grader: hollowGrader,
      graderRuntime,
      liveTier34Record: false,
    });
    expect(state.phase).toBe("satisfied");
    expect(stats.answerCheckpointsSatisfied).toBe(1);
    expect(stats.reasoningSoftViolations).toBe(1);
    expect(stats.graderCacheHits).toBe(1);
  });
});

describe("holmes_checkpoint executor", () => {
  test("rejects malformed checkpoint shapes", async () => {
    // RT: stats required
    const malformed: HolmesCheckpointParams[] = [
      checkpointParams({ target: "" }),
      checkpointParams({ chain: [] }),
      checkpointParams({ unknowns: [{ question: "what proves it?", status: "closed" }] }),
    ];

    for (let index = 0; index < malformed.length; index++) {
      const state = createAnswerGateState(`bad-checkpoint:${index}`, "full", 1);
      const result = await executeHolmesCheckpoint({
        params: malformed[index],
        state,
        observation: visible(""),
        toolLog: toolLogWithCalls(0, [], state.requestDigest),
        stats: createStats(),
      });
      expect(result.record.shapeOk).toBe(false);
      expect(result.content).toContain("failed dimension");
      expect(state.phase).toBe("obligated");
      expect(state.checkpointRecords).toHaveLength(1);
    }
  });

  test("verified closedBy closes, prose-only closedBy remains unverified", async () => {
    // RT: checkpoint evidence floor
    const verifiedState = createAnswerGateState("checkpoint-verified", "full", 1);
    const verified = await executeHolmesCheckpoint({
      params: checkpointParams({
        chain: [{ step: "TARGET follows from the read file.", evidence: ["src/answer.ts"] }],
        unknowns: [{ question: "which file proves it?", status: "closed", closedBy: "src/answer.ts" }],
      }),
      state: verifiedState,
      observation: visible(""),
      toolLog: toolLogWithCalls(1, ["src/answer.ts"], verifiedState.requestDigest),
      stats: createStats(),
    });

    expect(verified.record.verifiedEvidenceIds).toContain("src/answer.ts");
    expect(verifiedState.phase).toBe("satisfied");
    expect(verified.content).toContain("satisfied");

    const proseOnlyState = createAnswerGateState("checkpoint-prose-only", "full", 1);
    const proseOnly = await executeHolmesCheckpoint({
      params: checkpointParams({
        chain: [{ step: "TARGET follows from a prose claim.", evidence: ["src/answer.ts"] }],
        unknowns: [{ question: "which file proves it?", status: "closed", closedBy: "src/answer.ts" }],
      }),
      state: proseOnlyState,
      observation: visible(""),
      toolLog: toolLogWithCalls(0, [], proseOnlyState.requestDigest),
      stats: createStats(),
    });

    expect(proseOnly.record.unverifiedMentions).toContain("src/answer.ts");
    expect(proseOnlyState.phase).toBe("obligated");
    expect(proseOnly.content).toContain("verified_closure");
  });

  test("full checkpoint with tool calls requires verified evidence", async () => {
    // RT: checkpoint evidence floor
    const state = createAnswerGateState("checkpoint-evidence-floor", "full", 1);
    const result = await executeHolmesCheckpoint({
      params: checkpointParams({ unknowns: [{ question: "what external fact remains?", status: "open" }] }),
      state,
      observation: visible(""),
      toolLog: toolLogWithCalls(1, ["src/answer.ts"], state.requestDigest),
      stats: createStats(),
    });

    expect(result.record.shapeOk).toBe(true);
    expect(result.record.verifiedEvidenceIds).toEqual([]);
    expect(result.content).toContain("verified_evidence");
    expect(result.content).toContain("verified_evidence_required");
    expect(state.phase).toBe("obligated");
  });

  test("full zero-tool-call checkpoint can satisfy with open unknowns", async () => {
    // RT: checkpoint evidence floor
    const state = createAnswerGateState("checkpoint-open", "full", 1);
    const result = await executeHolmesCheckpoint({
      params: checkpointParams({ unknowns: [{ question: "what external fact remains?", status: "open" }] }),
      state,
      observation: visible(""),
      toolLog: toolLogWithCalls(0, [], state.requestDigest),
      stats: createStats(),
    });

    expect(result.record.shapeOk).toBe(true);
    expect(result.record.verifiedEvidenceIds).toEqual([]);
    expect(state.phase).toBe("satisfied");
  });

  test("terminal checkpoint calls are named no-ops", async () => {
    // RT: terminal guards
    for (const phase of ["satisfied", "soft_accept"] as const) {
      const state = createAnswerGateState(`terminal-checkpoint:${phase}`, "full", 1);
      state.phase = phase;
      const stats = createStats();
      const before = counterSnapshot(stats, state);
      const result = await executeHolmesCheckpoint({
        params: checkpointParams({ chain: [{ step: "TARGET follows from evidence.", evidence: ["src/answer.ts"] }] }),
        state,
        observation: visible(fullPass("src/answer.ts")),
        toolLog: toolLogWithCalls(1, ["src/answer.ts"], state.requestDigest),
        grader: async () => ({ status: "succeeded", verdict: "hollow", defects: [], requiredAdditions: [] }),
        stats,
      });

      expect(result.content).toBe(`request already closed (${phase})`);
      expect(state.phase).toBe(phase);
      expect(state.checkpointRecords).toHaveLength(0);
      expect(counterSnapshot(stats, state)).toEqual(before);
    }
  });
});

function facts(overrides: Partial<AnswerEscalationFacts> = {}): AnswerEscalationFacts {
  return {
    toolCallsThisRequest: 0,
    effectfulToolCalls: 0,
    finalVisibleChars: 0,
    codeBlocksInAnswer: 0,
    liveTier34Record: false,
    ...overrides,
  };
}

function visible(visibleText: string): MessageObservationState {
  const observation = createObservationState(1);
  observation.visibleByIndex.set(0, visibleText);
  observation.visibleText = visibleText;
  return observation;
}

function thinkingOnly(thinkingText: string): MessageObservationState {
  const observation = createObservationState(1);
  observation.thinkingByIndex.set(0, thinkingText);
  observation.thinkingText = thinkingText;
  return observation;
}

function lightPass(): string {
  return [
    "TARGET: close the requested change",
    "DELTA: describe the exact difference",
    "NEXT: verify the result",
  ].join("\n");
}

function fullPass(ref: string): string {
  return [
    "Hone: The target is the requested answer.",
    `Observe: Evidence was observed in ${ref}.`,
    `Ladder: ${ref} connects the target to the current state.`,
    "Map: The plan follows the ladder.",
    "Establish: Unknowns are either closed by cited evidence or left open.",
    "Synthesize: The final answer follows from the chain.",
  ].join("\n");
}

function checkpointParams(overrides: Partial<HolmesCheckpointParams> = {}): HolmesCheckpointParams {
  return {
    target: "Answer the user request with a grounded conclusion.",
    chain: [{ step: "TARGET traces to NOW.", evidence: [] }],
    unknowns: [],
    plan: ["Use the chain to answer."],
    ...overrides,
  };
}

function toolLogWithCalls(
  count = 0,
  paths: string[] = [],
  digest = REQUEST_DIGEST,
  failed: boolean | ((index: number) => boolean) = false,
): HolmesToolCallLog {
  const calls: ToolCallSummary[] = [];
  for (let index = 0; index < count; index++) {
    const isFailed = typeof failed === "function" ? failed(index) : failed;
    calls.push(toolCallSummary(index, paths[index % Math.max(paths.length, 1)], isFailed));
  }
  return {
    currentTurn: calls,
    byUserRequestDigest: new Map([[digest, calls]]),
    repeatedBlockCount: 0,
  };
}

function toolCallSummary(index: number, path: string | undefined, failed = false): ToolCallSummary {
  const call: ToolCallSummary = {
    toolCallId: `tool-${index}`,
    toolName: path ? "read" : "bash",
    inputDigest: `input-${index}`,
    inputFingerprint: `fingerprint-${index}`,
    effectFingerprint: `effect-${index}`,
    affectedPaths: path ? [path] : [],
    operationClass: "unknown",
    effectful: false,
    inspectable: Boolean(path),
    allowed: true,
    timestampMs: index,
  };
  if (failed) call.failed = true;
  return call;
}

function testGraderRuntime(): ReasoningGraderRuntime {
  const caches = new Map<string, ReasoningGraderRequestCache>();
  return {
    cacheForDigest(requestDigest) {
      const existing = caches.get(requestDigest);
      if (existing) return existing;
      const created = createReasoningGraderRequestCache();
      caches.set(requestDigest, created);
      return created;
    },
  };
}

function counterSnapshot(stats: HolmesStats, state: AnswerGateState): Record<string, number> {
  return {
    retriesUsed: state.retriesUsed,
    graderHollowFlags: state.graderHollowFlags,
    answerObligationsCreated: stats.answerObligationsCreated,
    answerCheckpointsSatisfied: stats.answerCheckpointsSatisfied,
    answerDemandsIssued: stats.answerDemandsIssued,
    answerSoftAccepts: stats.answerSoftAccepts,
    reasoningSoftViolations: stats.reasoningSoftViolations,
    graderCalls: stats.graderCalls,
    graderCacheHits: stats.graderCacheHits,
    statsGraderHollowFlags: stats.graderHollowFlags,
  };
}

function expectCountersNeverDecrease(before: Record<string, number>, after: Record<string, number>): void {
  for (const key of Object.keys(before)) {
    expect(after[key]).toBeGreaterThanOrEqual(before[key]);
  }
}
