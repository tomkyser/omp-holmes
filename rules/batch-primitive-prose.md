---
description: Blocks prose plans that chain primitive read/search/find calls sequentially.
condition: '(?is:\b(?:I(?:''ll|\s+will)|let\s+me)\b.{0,120}\b(?:read|search|find)\b.{0,180}\b(?:then|next|after(?:ward)?|from\s+there)\b.{0,120}\b(?:read|search|find)\b)'
scope: text, thinking
---
Do not serialize primitive exploration in prose. Collapse the read/search/find sequence into one planned read-only batch with `read`, `search`, `find`, or `ast_grep` where possible, gathering the needed evidence together. Use `eval` only as a secondary option when the effect is classified and covered by `holmes_classify`. Return with the summarized evidence and the next decision point, not a chain of tiny exploratory steps. If the work cannot be batched, state the dependency that forces sequencing.
