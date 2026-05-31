---
description: Catch intent to use eval as a mutation bypass
condition: '(?is:(?:eval|eval\s*\().{0,120}(?:write|append|create|modify|bypass).{0,80}(?:gate|guard|block|instead|around))'
scope: text, thinking
---
Stop. `eval` is effectful by default and cannot bypass classification. Before
any mutation-capable tool, including effectful eval, call `holmes_classify`; the
extension-owned classification record is the authority, not visible markers or
tool arguments. Use `write`, `edit`, or `bash` for file mutations unless the
returned scope explicitly covers eval.
