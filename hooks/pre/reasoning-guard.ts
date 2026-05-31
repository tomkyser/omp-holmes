import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const MUTATING = new Set(["edit", "write", "bash"]);
const REDIRECT_EVIDENCE = /\b(?:HALT|ENVISION|TARGET|DELTA|CLASSIFY|Tier\s*[123]|Hone|Observe|Ladder|Map|Establish|Synthesize)\b/i;
const MAX_SCAN_CHARS = 16_000;

function hasRedirectEvidence(value: unknown): boolean {
  let text: string;

  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? "";
    } catch {
      return false;
    }
  }

  return REDIRECT_EVIDENCE.test(text.slice(0, MAX_SCAN_CHARS));
}

export default function (pi: HookAPI) {
  let hasReasoned = false;
  let reminded = false;

  pi.on("turn_start", () => {
    hasReasoned = false;
    reminded = false;
  });

  pi.on("tool_result", (event) => {
    if (!hasReasoned && hasRedirectEvidence(event)) {
      hasReasoned = true;
    }
  });

  pi.on("tool_call", (event) => {
    if (!hasReasoned && hasRedirectEvidence(event.input)) {
      hasReasoned = true;
    }

    if (!MUTATING.has(event.toolName) || hasReasoned || reminded) return;

    reminded = true;
    return {
      block: true,
      reason: "Reasoning guard reminder: no ENVISION/TARGET/DELTA evidence has " +
        "been observed this turn before a mutating tool. If this is a trivial " +
        "Tier 1 operation, proceed; otherwise complete HALT/ENVISION/LOCATE/DELTA " +
        "first, then retry the tool call.",
    };
  });
}
