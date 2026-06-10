# Execution Patterns

## Batch `eval()` operation

Use `[batch-eval]` when several small observations can be gathered deterministically in one VM pass.

```js
const targets = ["src/api/user.ts", "src/api/user.test.ts"];
const files = await Promise.all(
  targets.map(async (path) => ({ path, text: await read(path) })),
);

const facts = files.map(({ path, text }) => ({
  path,
  exportsUser: /export\s+function\s+user/.test(text),
  testCases: [...text.matchAll(/it\((['"`])([^'"`]+)\1/g)].map((m) => m[2]),
}));

display(facts);
return facts;
```

Keep the batch bounded: fixed file list or narrow `find` result, compact returned facts, no hidden mutation. `eval` is effectful by default, so use it only when `holmes_classify` has approved the exact batch scope or the step is explicitly a classified transform step.

## Execution tags in a plan

```markdown
1. [specialized-tool] Use AST search to find `parseRequest(...)` call shapes.
2. [batch-eval] Read the matched files and summarize argument contracts.
3. [delegate] Use Task with `agent: "explore"` and embed the researcher contract: read-only, no edits/builds/formatters, bounded factual question, file/line evidence, consumers, unknowns, and searches.
4. [direct-primitive] Edit the single parser branch once the contract is proven.
5. [delegate] Use Task with `agent: "oracle"` and embed the verifier contract: no edits, changed files plus acceptance criteria, targeted checks only, PASS/FAIL/BLOCKED with evidence.
```

Tags describe execution mechanics, not importance. Use them to prevent accidental primitive-call chains.

## Preflight checks

- Confirm exact acceptance criteria and non-goals.
- Confirm target files exist and read current relevant sections before editing.
- Check for generated files, protected files, or ownership boundaries.
- Search for direct callers, re-exports, tests, fixtures, schema declarations, and string-based references.
- Decide verification before transform: command, scenario, static invariant, or reviewer agent task.
- Capture current failing behavior when debugging.

## Verification patterns

- **Behavior fix**: reproduce failure, apply change, rerun the same targeted test or scenario.
- **API change**: search all imports/callers, update consumers, run affected unit tests or type checks when permitted.
- **Data contract**: validate parser and serializer paths, fixtures, migrations, and error branches.
- **Refactor**: prove old symbol/path has no remaining live references, then run tests covering the moved behavior.
- **No command available**: read changed files plus callers, check syntax-sensitive structure with AST tools when possible, and state the missing executable check explicitly.
