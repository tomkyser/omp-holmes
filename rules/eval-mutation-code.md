---
description: Catch filesystem mutation code inside eval tool calls
condition: '(?is:(?:^|[^a-z_])(?:write|append)\s*\()'
scope: tool:eval
---
This eval cell contains filesystem mutation code (`write()` or `append()`).
`eval` is effectful by default and is not a classification bypass. Before any
mutation-capable tool, including effectful eval, call `holmes_classify` and obey
the returned tier, requirements, and scope. Use `write`, `edit`, or `bash` for
file mutations unless the classification lease explicitly covers eval.
