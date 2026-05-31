import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const PRIMITIVE = new Set(["read", "search", "find"]);
const EXEMPT_AFTER = new Set(["edit", "write", "resolve", "ast_edit", "task"]);
const MAX_BURST = 3;
const BASH_FILE_PRIMITIVE = /(^|[;&|()\s])(?:cat|head|tail|less|more|ls|grep|rg|ag|ack|find|fd)(?=\s|$)/;
const URL_RESOURCE = /^(?:https?:\/\/|pr:\/\/|issue:\/\/|agent:\/\/|artifact:\/\/|memory:\/\/|skill:\/\/)/;

export default function (pi: HookAPI) {
  let burst = 0;
  let lastTool: string | undefined;

  pi.on("turn_start", () => { burst = 0; lastTool = undefined; });

  pi.on("tool_call", (event) => {
    const isPrimitive = PRIMITIVE.has(event.toolName) ||
      (event.toolName === "bash" && BASH_FILE_PRIMITIVE.test(String(event.input.command ?? "")));

    if (!isPrimitive) { burst = 0; lastTool = event.toolName; return; }

    if (event.toolName === "read") {
      if (lastTool && EXEMPT_AFTER.has(lastTool)) { burst = 0; lastTool = event.toolName; return; }
      if (URL_RESOURCE.test(String(event.input.path ?? ""))) { burst = 0; lastTool = event.toolName; return; }
    }

    burst += 1;
    lastTool = event.toolName;
    if (burst <= MAX_BURST) return;

    return {
      block: true,
      reason: "Primitive exploration chain detected. Rewrite the remaining " +
        "investigation as one eval() cell that batches discovery and returns " +
        "only the facts needed for the next decision. Direct primitives are " +
        "for targeted one-shot lookups, anchor capture, or post-edit verification.",
    };
  });
}
