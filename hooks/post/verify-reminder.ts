import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const VERIFY_TOOLS = new Set(["edit", "write", "resolve", "ast_edit"]);
const REMINDER = "Verify this change landed correctly: read the affected file and confirm the edit matches your intent.";

export default function (pi: HookAPI) {
  pi.on("tool_result", (event) => {
    if (!VERIFY_TOOLS.has(event.toolName)) return;

    const content = String(event.content ?? "");
    if (!content) return { content: REMINDER };

    return {
      content: content.endsWith("\n") ? `${content}${REMINDER}` : `${content}\n\n${REMINDER}`,
    };
  });
}
