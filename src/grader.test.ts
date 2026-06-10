import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
  assessReasoningWithCache,
  buildReasoningGraderPacket,
  createExtensionOwnedReasoningGrader,
  createReasoningGraderRequestCache,
  mapGraderOutcomeToObligations,
  parseReasoningGraderAssessment,
  type ReasoningGraderParsedDefect,
} from "./grader";
import {
  createObservationState,
  createStats,
  MAX_GRADER_CALLS_PER_REQUEST,
  type AnswerGateState,
  type HolmesStats,
  type HolmesToolCallLog,
  type ReasoningGraderAssessment,
  type ReasoningGraderPacket,
} from "./types";

const EMPTY_MAPPING = { withholdSatisfaction: false, advisories: [], obligations: [] };

function answerState(overrides: Partial<AnswerGateState> = {}): AnswerGateState {
  return {
    phase: "obligated",
    level: "full",
    requestDigest: "request-digest",
    createdAtSequence: 1,
    retriesUsed: 0,
    graderHollowFlags: 0,
    checkpointRecords: [],
    ...overrides,
  };
}

function packet(label = "one"): ReasoningGraderPacket {
  const path = `src/${label}.ts`;
  return {
    facts: {
      level: "full",
      verifiedEvidenceIds: [path],
      unverifiedMentions: [],
      sectionPresence: {
        target: true,
        delta: true,
        next: true,
        hone: true,
        observe: true,
        ladder: true,
        map: true,
        establish: true,
        synthesize: true,
      },
      toolCallSummary: [{ tool: "read", pathish: [path] }],
    },
    untrustedClaims: {
      userRequestExcerpt: "Investigate the request.",
      passText: `TARGET: done\nDELTA: checked ${path}\nNEXT: report`,
    },
  };
}

function toolLog(path = "src/one.ts"): HolmesToolCallLog {
  return {
    currentTurn: [{
      toolCallId: "read-1",
      toolName: "read",
      inputDigest: "input-digest",
      inputFingerprint: "read:input-digest",
      affectedPaths: [path],
      operationClass: "unknown",
      effectful: false,
      inspectable: true,
      timestampMs: 1,
    }],
    byUserRequestDigest: new Map<string, HolmesToolCallLog["currentTurn"]>(),
    repeatedBlockCount: 0,
  };
}

function fakeContext(callModel: (request: unknown) => Promise<unknown> | unknown): ExtensionContext {
  return {
    cwd: process.cwd(),
    hasUI: false,
    model: undefined,
    modelRegistry: { getApiKey: async () => undefined },
    sessionManager: {},
    ui: { notify: () => undefined },
    getContextUsage: () => undefined,
    callModel,
  } as unknown as ExtensionContext;
}

function expectNoObligationChange(assessment: ReasoningGraderAssessment): void {
  expect(mapGraderOutcomeToObligations(assessment, answerState())).toEqual(EMPTY_MAPPING);
}

function coherentRaw(): string {
  return JSON.stringify({ status: "succeeded", verdict: "coherent", defects: [], requiredAdditions: [] });
}
function emptyAssessment(status: "failed" | "skipped"): ReasoningGraderAssessment {
  return { status, defects: [], requiredAdditions: [] };
}

function coherentAssessment(): ReasoningGraderAssessment {
  return { status: "succeeded", verdict: "coherent", defects: [], requiredAdditions: [] };
}


describe("reasoning grader parser", () => {
  test("malformed missing and authority-shaped outputs fail closed with no obligations", () => {
    const evidenceIds = new Set(["src/one.ts"]);
    const malformed = parseReasoningGraderAssessment("not json", evidenceIds);
    const missing = parseReasoningGraderAssessment(JSON.stringify({ status: "succeeded", verdict: "coherent" }), evidenceIds);
    const authority = parseReasoningGraderAssessment(JSON.stringify({
      status: "succeeded",
      verdict: "hollow",
      defects: [],
      requiredAdditions: [],
      tier: 1,
    }), evidenceIds);

    for (const assessment of [malformed, missing, authority]) {
      expect(assessment.status).toBe("failed");
      expect(assessment.defects).toHaveLength(0);
      expectNoObligationChange(assessment);
    }
  });

  test("accepts prose-wrapped JSON and marks invalid citations advisory-only", () => {
    const assessment = parseReasoningGraderAssessment(`Here is the assessment: ${JSON.stringify({
      status: "succeeded",
      verdict: "hollow",
      defects: [{
        axis: "closure",
        severity: "high",
        detail: "Closed unknown cites one bad ref and one verified ref.",
        citedEvidence: ["bogus-ref", "src/one.ts"],
      }],
      requiredAdditions: ["closure"],
    })}`, new Set(["src/one.ts"]));

    expect(assessment.status).toBe("succeeded");
    expect(assessment.defects).toHaveLength(1);
    expect(assessment.defects[0].citedEvidence).toEqual(["src/one.ts"]);
    const parsed = assessment.defects[0] as ReasoningGraderParsedDefect;
    expect(parsed.invalidCitedEvidence).toEqual(["bogus-ref"]);

    const invalidOnly = parseReasoningGraderAssessment(JSON.stringify({
      status: "succeeded",
      verdict: "incoherent",
      defects: [{ axis: "chain", severity: "high", detail: "Bad citation only.", citedEvidence: ["bogus-ref"] }],
      requiredAdditions: ["chain"],
    }), new Set(["src/one.ts"]));
    const mapped = mapGraderOutcomeToObligations(invalidOnly, answerState());
    expect(mapped.withholdSatisfaction).toBe(false);
    expect(mapped.obligations).toEqual([]);
    expect(mapped.advisories.length).toBeGreaterThan(0);
  });
});

describe("reasoning grader upward-only mapping", () => {
  test("fuzzed assessments expose only withhold advisories and obligation axes", () => {
    const statuses: ReasoningGraderAssessment["status"][] = ["succeeded", "failed", "skipped"];
    const verdicts: Array<ReasoningGraderAssessment["verdict"]> = [undefined, "coherent", "hollow", "incoherent"];
    const axes = ["chain", "closure", "plan"] as const;
    const severities = ["high", "medium", "low"] as const;

    for (const status of statuses) {
      for (const verdict of verdicts) {
        for (const axis of axes) {
          for (const severity of severities) {
            const assessment: ReasoningGraderAssessment = {
              status,
              ...(verdict ? { verdict } : {}),
              defects: [{ axis, severity, detail: `${axis}:${severity}`, citedEvidence: ["src/one.ts"] }],
              requiredAdditions: ["lower tier to 1", "mint a certificate", "mark answer satisfied"],
            };
            const mapped = mapGraderOutcomeToObligations(assessment, answerState());
            const exactShape: { withholdSatisfaction: boolean; advisories: string[]; obligations: string[] } = mapped;
            expect(Object.keys(exactShape).sort()).toEqual(["advisories", "obligations", "withholdSatisfaction"]);
            const runtime = exactShape as unknown as Record<string, unknown>;
            expect(runtime.tier).toBeUndefined();
            expect(runtime.certificate).toBeUndefined();
            expect(runtime.satisfied).toBeUndefined();
            expect(runtime.floor).toBeUndefined();
            expect(runtime.closureSatisfied).toBeUndefined();
            expect(runtime.mutation_ready).toBeUndefined();
          }
        }
      }
    }

    const coherentAdversarial: ReasoningGraderAssessment = {
      status: "succeeded",
      verdict: "coherent",
      defects: [],
      requiredAdditions: ["lower tier to 1"],
    };
    expect(mapGraderOutcomeToObligations(coherentAdversarial, answerState())).toEqual(EMPTY_MAPPING);
  });
});

describe("reasoning grader cache", () => {
  test("identical packets hit cache and max calls are enforced per request cache", async () => {
    let modelCalls = 0;
    const ctx = fakeContext(() => {
      modelCalls += 1;
      return coherentRaw();
    });
    const assessor = createExtensionOwnedReasoningGrader({ ctx, timeoutMs: 100 });
    const cache = createReasoningGraderRequestCache();
    const stats: HolmesStats = createStats();

    const first = await assessReasoningWithCache({ packet: packet("one"), assessor, cache, stats });
    const second = await assessReasoningWithCache({ packet: packet("one"), assessor, cache, stats });
    const third = await assessReasoningWithCache({ packet: packet("two"), assessor, cache, stats });
    const fourth = await assessReasoningWithCache({ packet: packet("three"), assessor, cache, stats });

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(third.cached).toBe(false);
    expect(fourth.skippedForLimit).toBe(true);
    expect(fourth.assessment.status).toBe("skipped");
    expect(modelCalls).toBe(MAX_GRADER_CALLS_PER_REQUEST);
    expect(stats.graderCalls).toBe(MAX_GRADER_CALLS_PER_REQUEST);
    expect(stats.graderCacheHits).toBe(1);
  });
  test("failed and skipped assessments are not cached", async () => {
    const failedCache = createReasoningGraderRequestCache();
    let failedCalls = 0;
    const failedThenSucceeded = async (): Promise<ReasoningGraderAssessment> => {
      failedCalls += 1;
      return failedCalls === 1 ? emptyAssessment("failed") : coherentAssessment();
    };

    const failedFirst = await assessReasoningWithCache({ packet: packet("failed"), assessor: failedThenSucceeded, cache: failedCache });
    const failedSecond = await assessReasoningWithCache({ packet: packet("failed"), assessor: failedThenSucceeded, cache: failedCache });

    expect(failedFirst.assessment.status).toBe("failed");
    expect(failedFirst.cached).toBe(false);
    expect(failedSecond.assessment.status).toBe("succeeded");
    expect(failedSecond.cached).toBe(false);
    expect(failedCalls).toBe(2);

    const skippedCache = createReasoningGraderRequestCache();
    let skippedCalls = 0;
    const skippedThenSucceeded = async (): Promise<ReasoningGraderAssessment> => {
      skippedCalls += 1;
      return skippedCalls === 1 ? emptyAssessment("skipped") : coherentAssessment();
    };

    const skippedFirst = await assessReasoningWithCache({ packet: packet("skipped"), assessor: skippedThenSucceeded, cache: skippedCache });
    const skippedSecond = await assessReasoningWithCache({ packet: packet("skipped"), assessor: skippedThenSucceeded, cache: skippedCache });

    expect(skippedFirst.assessment.status).toBe("skipped");
    expect(skippedFirst.cached).toBe(false);
    expect(skippedSecond.assessment.status).toBe("succeeded");
    expect(skippedSecond.cached).toBe(false);
    expect(skippedCalls).toBe(2);
  });
});


describe("reasoning grader timeout", () => {
  test("hanging model resolves failed within the configured cap and changes no obligations", async () => {
    const ctx = fakeContext(() => new Promise<unknown>(() => undefined));
    const assessor = createExtensionOwnedReasoningGrader({ ctx, timeoutMs: 25 });
    const startedAt = Date.now();
    const assessment = await assessor(packet("one"));
    const elapsedMs = Date.now() - startedAt;

    expect(assessment.status).toBe("failed");
    expect(assessment.defects).toHaveLength(0);
    expect(elapsedMs).toBeLessThan(500);
    expectNoObligationChange(assessment);
  });
  test("callModel requests JSON response format", async () => {
    let captured: Record<string, unknown> | undefined;
    const ctx = fakeContext((request) => {
      captured = request as Record<string, unknown>;
      return coherentRaw();
    });
    const assessor = createExtensionOwnedReasoningGrader({ ctx, timeoutMs: 100 });
    const assessment = await assessor(packet("one"));

    expect(assessment.status).toBe("succeeded");
    expect(captured?.responseFormat).toEqual({ type: "json_object" });
  });
});


describe("reasoning grader packet", () => {
  test("splits verified evidence from tool-log-matched refs", () => {
    const observation = createObservationState(1);
    observation.visibleText = "TARGET: answer\nDELTA: read src/one.ts:10-12 and bogus.ts\nNEXT: cite checked path";
    const built = buildReasoningGraderPacket({
      level: "full",
      observation,
      toolLog: toolLog("src/one.ts"),
      requestDigest: "request-digest",
      requestText: "Investigate the request.",
    });

    expect(built.packet.facts.verifiedEvidenceIds).toEqual(["src/one.ts:10-12"]);
    expect(built.packet.facts.unverifiedMentions).toContain("bogus.ts");
    expect(built.evidenceIds.has("src/one.ts:10-12")).toBe(true);
  });
  test("uses request-scoped prior-turn tool calls for evidence and summaries", () => {
    const observation = createObservationState(1);
    observation.visibleText = "TARGET: answer\nDELTA: read src/prior.ts:10-12 and missing.ts\nNEXT: cite checked path";
    const log = toolLog("src/current.ts");
    log.currentTurn[0] = {
      ...log.currentTurn[0],
      toolCallId: "current-read",
      inputDigest: "current-input",
      inputFingerprint: "read:current-input",
      affectedPaths: ["src/current.ts"],
      timestampMs: 2,
    };
    log.byUserRequestDigest.set("request-digest", [{
      ...log.currentTurn[0],
      toolCallId: "prior-read",
      inputDigest: "prior-input",
      inputFingerprint: "read:prior-input",
      affectedPaths: ["src/prior.ts"],
      timestampMs: 1,
    }]);

    const built = buildReasoningGraderPacket({
      level: "full",
      observation,
      toolLog: log,
      requestDigest: "request-digest",
      requestText: "Investigate the prior turn.",
    });

    expect(built.packet.facts.verifiedEvidenceIds).toEqual(["src/prior.ts:10-12"]);
    expect(built.packet.facts.unverifiedMentions).toContain("missing.ts");
    expect(built.packet.facts.toolCallSummary).toEqual([
      { tool: "read", pathish: ["src/prior.ts"] },
      { tool: "read", pathish: ["src/current.ts"] },
    ]);
  });

  test("keeps user request excerpt separate from checkpoint target", () => {
    const observation = createObservationState(1);
    observation.visibleText = "TARGET: answer\nDELTA: checked src/one.ts\nNEXT: report";
    const checkpointParams = {
      target: "Checkpoint target must stay quarantined.",
      chain: [],
      unknowns: [],
      plan: [],
    };

    const built = buildReasoningGraderPacket({
      level: "full",
      observation,
      toolLog: toolLog("src/one.ts"),
      requestDigest: "request-digest",
      requestText: "Actual user request text.",
      checkpointParams,
    });

    expect(built.packet.untrustedClaims.userRequestExcerpt).toBe("Actual user request text.");
    expect(built.packet.untrustedClaims.userRequestExcerpt).not.toContain("Checkpoint target");
    expect(built.packet.untrustedClaims.checkpointParams?.target).toBe("Checkpoint target must stay quarantined.");
  });

});
