# Panel Review Synthesis — HOLMES Behavioral Testing (Tests 1–3)

## Panel Composition
| Role | Model | Agent ID |
|---|---|---|
| Red Team | slow | 55-RedTeamSlow |
| Red Team | plan | 56-RedTeamPlan |
| Staff Engineer | slow | 57-StaffEngSlow |
| Staff Engineer | plan | 58-StaffEngPlan |
| Architect | slow | 59-ArchitectSlow |
| Architect | plan | 60-ArchitectPlan |

## Test Results Summary

**Test 1: Extension loads** — PASS (minor: duplicate `/holmes` in command list)
**Test 2: Read-only tools ungated** — PASS
**Test 3: Mutation gate + classify + retry** — **CATASTROPHIC FAILURE** — agent permanently stuck

---

## Consensus Findings (6/6 agree)

### 1. CRITICAL: Hard-floor regex treats safety-negation prose as positive risk evidence

All six agents identified this as the root trigger for the Test 3 failure.

**What happens:** `detectHardImpactFloors` concatenates user request, visible assistant text, reasoning, impact JSON, planned-action summaries, and paths into one `allText` blob, then applies bag-of-words regexes. When the agent writes reasoning like "no public API impact" or the impact JSON contains `"unknowns": []`, the words `public`, `api`, and `unknown` satisfy the Tier 4 condition at `classification.ts:725`:
```
if (API_WORDS.test(allText) && /unknown|public|external|downstream|consumer/i.test(allText))
  add(4, "public API/protocol compatibility is unknown", "effect");
```

The regex cannot distinguish "no public API impact" from "public API compatibility is unknown." The system prompt *asks* agents to declare unknowns and downstream effects, creating a structural paradox: providing the requested proof of safety triggers the Tier 4 floor.

**Panel consensus fix:** Hard floors must be scoped to structured effect fields, not free-text prose. Changed payload, path class, and explicit `contractChanges`/`unknowns` arrays should be the floor signal — not keyword co-occurrence in reassurance text.

### 2. CRITICAL: Cumulative ledger makes false-positive Tier 4 irrecoverable within a request

All six agents identified this as the mechanism that turns a single false positive into a permanent block.

**What happens:** Once any Tier 4 classification commits, `ledger.priorTierFloor` is set to 4 and never decreases within the same user request (`classification.ts:1003-1005`). Later classifications inherit this floor (`classification.ts:738`), and `ledgerShowsExpansion` returns true for `priorTierFloor >= 4` (`classification.ts:2234-2236`), blocking the 4→3 prove-down step.

The block message tells the agent to reclassify, but reclassification is strictly harder: each failed attempt adds blocked effects to the ledger, compounding the floor. The only escape is a new user request (different digest), which resets the ledger via `main.ts:143-154`.

**Panel consensus fix:** Replace scalar `priorTierFloor` with scoped floor entries keyed by `{path, effect, reason}`. Allow a later same-scope classification to supersede a prior false-positive record when no mutation has occurred. Preserve anti-slicing by tracking unresolved parts of the original request, not by globally maxing all tiers.

### 3. CRITICAL: Exact effect fingerprinting is unsatisfiable by real agents

All six agents identified this as a design-level blocker for the Tier 1 path.

**What happens:** The `holmes_classify` schema requires `structuredEffect.normalizedPatchHash` — a SHA-256 of the exact normalized edit patch. But the agent doesn't have the patch yet (it hasn't made the edit). The extension exposes no read-only hash helper, and `bash`/`eval` are mutation-capable tools that themselves require classification.

If the agent uses `exactOpaqueInput` instead, the planned fingerprint format becomes `opaque:edit:<hash>`, while the gate computes `effect:edit:<path>:<hash>` — a format mismatch that always produces `effect_mismatch`.

**Panel consensus fix:** Accept raw planned patch text in classify (e.g., `exactPatch` field) and compute fingerprints extension-side using the same `normalizePatchText` + `stableHashText` pipeline used at gate time. Never require model-supplied cryptographic hashes.

### 4. HIGH: Planned vs actual operation class diverges for the same edit

5/6 agents identified this (all except one red team agent who focused elsewhere).

**What happens:** Lease operation classes are built from `operationClassFromPlannedAction`, which uses the agent's declared `operationKind` and free-text `semanticClassClaim`. The gate computes classes from `inferOperationClass`, which uses path patterns and raw patch text. For a README blank-line edit:

- Planned: `mechanical_text` + claim "whitespace" → `whitespace_format`
- Actual: docs path → `prose_edit`

The gate requires exact class membership (`classification.ts:1738-1740`), so this blocks with `operation_mismatch` even when the file and tool match.

**Panel consensus fix:** Unify operation classification behind one canonical function that takes `{toolName, paths, payload}`. Both lease construction and gate checking should call the same function. Alternatively, if exact fingerprints match, operation class should not separately block.

---

## Additional Findings (not unanimous but significant)

### 5. HIGH: Tier 1 path is architecturally dead for normal agent usage (4/6)

The Tier 1 null-impact proof requires `concreteTier1Effect` to find non-empty changed lines in `exactOpaqueInput` (`classification.ts:2285-2295`). For a blank-line insertion, the added payload is empty (`+` with no content). The extractor drops it and falls back to patch metadata lines, which are not real prose. The `docs_prose_only` ceiling requires actual changed lines; the `whitespace_only` ceiling requires both removed and added lines. A trailing blank-line edit satisfies neither.

**Fix:** Add a first-class `blank_line_only` or `structural_whitespace` ceiling for inserts/deletes of empty lines.

### 6. HIGH: Gate block messages lack actionable diagnostics (4/6)

The `effect_mismatch` and `operation_mismatch` messages report lease ID, approved paths, and attempted paths — but not the expected vs actual fingerprint or operation class. The agent is left guessing, as observed in the Test 3 transcript where the agent tried three different classify shapes.

**Fix:** Include `expectedOperationClasses`, `actualOperationClass`, truncated fingerprint comparison, and corrective instructions in block messages.

### 7. HIGH: Testing guide expects agent behavior the system prompt discourages (3/6)

Test 3 expects the agent to attempt `edit` first (get `no_covering_lease` block), then classify. But the injected system prompt tells agents to classify *before* mutation. A prompt-compliant agent will never produce the expected Test 3 sequence.

**Fix:** Split Test 3 into a gate-level test (intentionally skip classification) and an agent-level test (proactive classification → successful edit).

### 8. MEDIUM: Three specifications disagree — prompt, guide, and code (3/6)

The system prompt promises Tier 1 for cosmetic changes. The testing guide expects Tier 1 for README edits. The code escalates README edits to Tier 4. There is no canonical behavioral contract from which the other two are derived.

**Fix:** Create a versioned HOLMES behavioral contract as the single source of truth; derive prompt text, testing guide, and validation code from it.

---

## Priority-Ordered Fix Plan

| # | Severity | Finding | Scope | Dependency |
|---|---|---|---|---|
| 1 | CRITICAL | Hard-floor regex false positives on negation prose | `classification.ts:713-768` | None |
| 2 | CRITICAL | Exact fingerprint unsatisfiable — compute extension-side | `classification.ts:2176-2182`, `types.ts` schema | None |
| 3 | CRITICAL | Cumulative ledger — scoped floors, supersession path | `classification.ts:738,1003,2234`, `types.ts:395-410` | None |
| 4 | HIGH | Unify operation class computation | `classification.ts:2185-2215` | Pairs with #2 |
| 5 | HIGH | Blank-line ceiling for Tier 1 proof | `classification.ts:786-807,2297-2329` | After #1 |
| 6 | HIGH | Gate block message diagnostics | `classification.ts:1884-1910` | After #4 |
| 7 | HIGH | Split Test 3 in guide | `.planning/behavioral-testing-guide.md` | After fixes land |
| 8 | MEDIUM | Canonical behavioral contract | New doc | After #1-6 |

---

## Raw Agent Reports

Full reports are available at:
- `agent://55-RedTeamSlow`
- `agent://56-RedTeamPlan`
- `agent://57-StaffEngSlow`
- `agent://58-StaffEngPlan`
- `agent://59-ArchitectSlow`
- `agent://60-ArchitectPlan`
