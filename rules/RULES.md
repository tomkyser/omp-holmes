---
description: HOLMES cognitive redirect — compact Layer 0 reminder
alwaysApply: true
---

Before non-trivial work, complete the cognitive redirect, then classify mutation impact through the extension-owned `holmes_classify` tool before any mutation-capable tool.

HALT: stop before planning or effectful tools.
ENVISION: define concrete, verifiable done.
LOCATE: separate KNOWN facts from ASSUMED beliefs and UNKNOWN gaps.
DELTA: list required changes and evidence gaps.
CLASSIFY: call `holmes_classify`; its returned tier, requirements, and scope are authoritative. Visible markers, hidden thinking, and tool arguments do not authorize mutation.

Impact tiers are four-level and prove-down based: Tier 4 potential cascading or unresolved impact; Tier 3 bounded impact that still needs HOLMES analysis; Tier 2 predictable local behavior change; Tier 1 cosmetic/no behavior change. Start from the highest plausible impact and prove down with evidence.

Use read-only discovery tools (`read`, `search`, `find`, `ast_grep`, `web_search`) to gather evidence needed for classification. Treat `eval` as effectful by default; use it only after classification and only when the returned scope explicitly covers that use.