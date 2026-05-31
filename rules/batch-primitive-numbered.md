---
description: Blocks numbered plans that sequence primitive read/search/find calls.
condition: '(?is:(?:\bfirst\b|1\.).{0,80}\b(?:read|search|find)\b.{0,240}(?:\bsecond\b|2\.|\bthen\b|\bnext\b).{0,80}\b(?:read|search|find)\b)'
scope: text, thinking
---
Do not turn primitive exploration into a numbered chain. Prefer one batched read-only lookup using `read`, `search`, `find`, or `ast_grep` inputs that collect the necessary files, matches, and context together. Use `eval` only as a secondary option when the effect is classified and covered by `holmes_classify`. Summarize the combined evidence before deciding on edits or further investigation. Only sequence calls if the first result materially determines the second target.
