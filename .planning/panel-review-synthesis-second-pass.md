# Panel Review Synthesis — Second-Pass Behavioral Testing

**Date:** 2026-05-30
**Reviewers:** RedTeamSlow(74), StaffEngSlow(75), ArchitectSlow(76), RedTeamPlan(77), StaffEngPlan(78), ArchitectPlan(79)
**Subject:** `.planning/testing-results-second-pass.md` — Test 3 death spiral persists after Phase 1+2 fixes

## Verdict

**Unanimous: The three-layer architecture CAN work. The current implementation is broken at the interface boundaries.**

The blank-line certificate engine (`computeBlankLineOnlyCertificate`) would correctly certify a blank-line README edit if it received the exact hashline edit patch. It never receives one because:
1. The prompt/schema don't tell the agent to provide it
2. The schema still asks for model-supplied hashes instead of exact payloads
3. A prose-summary fallback creates "exact" leases the gate can never match
4. A keyword-regex verification check blocks certificate evaluation before it starts
5. Prior false-positive Tier 3 records stick and prevent recovery

These are **not the same bugs as first-pass Test 3**. The floor split, fingerprint fix, and scoped ledger changes from Phase 1 are correct. These are new bugs exposed by the architectural redesign.

---

## Kill Chain (Reconstructed from Transcript)

```
Agent reads README.md → obtains ¶README.md#9601, line 174
Agent calls holmes_classify:
  - proposedTier: 1
  - plannedActions: [{toolName: "edit", paths: ["README.md"], summary: "..."}]
  - reasoning: "Adding a trailing blank…" (no "verify"/"read-back" keyword)
  - NO exactOpaqueInput (or prose/hash value)

→ detectObjectiveImpactFloors: no floor for README.md (correct)
→ computeEvidenceCertificates:
  → buildCertificateChangeSets: returns undefined (no exactOpaqueInput) [BUG 2]
  → all certificates: undefined
→ proveBoundedImpact (4→3): passes
→ provePredictableImpact (3→2): FAILS
  → localVerificationPlanAvailable: false (no "verify" in reasoning) [BUG 4]
→ proveNullImpact: NEVER REACHED
→ finalTier = 3
→ plannedActionEffectFingerprint: falls back to stableHashJson({summary...}) [BUG 3]
→ chooseLeaseKind: "exact" (has fingerprint string)
→ Lease: exact, fingerprint = hash(summary JSON)

Agent calls edit with actual patch:
→ Gate: pendingEffectFingerprintForInput = effect:edit:README.md:<hash(actualPatch)>
→ Lease fingerprint ≠ gate fingerprint → effect_mismatch [BUG 3]

Agent retries classify (2 more times):
→ Prior Tier 3 record → maxTierFromOverlappingRecords = 3 [BUG 5]
→ Same failures repeat or compound
→ Agent gives up
```

---

## Bugs — Priority Order

### B1: Schema/prompt contract gap (CRITICAL — 6/6 agents)

**Root cause:** `src/prompts.ts:32-45` never tells agents to provide the exact edit patch in classification. `src/types.ts:582-615` still has `normalizedPatchHash`, `contentHash`, `patternHash`, `replacementHash` — model-supplied hashes that the extension cannot independently verify. `exactOpaqueInput` is optional, poorly named, and undocumented.

**Evidence:** The three-layer spec (`.planning/three-layer-spec.md:596-697`) explicitly says to replace hash fields with exact payloads. This was not done.

**Fix:** Replace hash fields with `exactPatch`/`exactContent`/`exactOps` in `HolmesClassifyStructuredEffect` types and schema. Update prompt to tell agents: "For edit, include the exact hashline patch you will send. For write, include the exact content."

**Risk:** Breaking schema change. All tests using hash fields must migrate.

---

### B2: Certificate engine returns undefined without exact payload (CRITICAL — 6/6 agents)

**Root cause:** `buildCertificateChangeSets` (line 1237) returns `undefined` if ANY planned action lacks `exactOpaqueInput` as a non-empty string (line 1242). Without change sets, ALL certificate functions return `undefined`. This is why the transcript shows "no deterministic null/cosmetic certificate exists."

**Evidence:** `computeBlankLineOnlyCertificate` → `buildCertificateChangeSets` → line 1242 returns undefined → no certificate → `proveNullImpact` fails.

**Fix:** After B1 schema migration, read exact payloads from `structuredEffect.exactPatch`/`exactContent`. Surface diagnostic failure reasons in classify output: "edit exact patch missing" rather than generic "no certificate."

**Risk:** More classifications fail closed until agents provide exact payloads. This is the intended behavior.

---

### B3: Phantom exact leases from summary fallback (CRITICAL — 6/6 agents)

**Root cause:** `plannedActionEffectFingerprint` (line 3684) ALWAYS returns a string — falling back to `stableHashJson({toolName, paths, operationKind, summary})` at line 3705 when no exact payload exists. `chooseLeaseKind` (line 3563-3572) treats ANY fingerprint string as `exactAvailable = true` and creates exact leases. The gate then computes `effect:edit:README.md:<hash(actualPatch)>` which can never equal a summary JSON hash.

**Evidence:** Transcript shows `effect_mismatch` with matching scope ("Approved scope: README.md. Attempted: README.md.") — proving the mismatch is fingerprint, not path.

**Fix:** Return `undefined` from `plannedActionEffectFingerprint` when no gate-comparable exact payload exists. `chooseLeaseKind` treats undefined fingerprints as `exactAvailable = false`. Tier 1 without exact payload → blocked lease. Tier 2/3 without exact payload → scope-only lease.

**Risk:** Some existing exact leases from incomplete actions become scope leases. Correct fail-closed behavior.

---

### B4: Verification-plan keyword blocks certificate evaluation (HIGH — 6/6 agents)

**Root cause:** `provePredictableImpact` (line 1578-1603) requires `localVerificationPlanAvailable` (line 3806-3811) which regex-scans ONLY `params.reasoning`, `params.holmes.next`, and `params.holmes.delta` for words like `verify|test|read-back`. If this fails, `proveNullImpact` is NEVER REACHED — certificates are useless even when they would prove Tier 1.

**Evidence:** Transcript rounds 1 and 3 fail with "no local verification route is present in classification." Round 2 passes verification but fails certificates.

**Fix:** Two options:
- **(A)** When a Tier 1 null-impact certificate covers all planned actions, no objective floor ≥ 2 exists, and no opaque tools are used: bypass the verification-keyword obligation in 3→2. The certificate IS the verification.
- **(B)** Add explicit `verificationPlan` field to schema, require it in prompt.

Option (A) is minimal and architecturally correct. Option (B) is additive and can layer on top.

**Risk:** (A) could reduce post-mutation verification discipline. Mitigate: keep the separate verify-reminder in message observation. The change only affects prove-down evaluation, not post-mutation reminders.

---

### B5: Prior false-positive Tier 3 is sticky (HIGH — 4/6 agents)

**Root cause:** `maxTierFromOverlappingRecords` (line 3948-3965) uses `record.tier` as a floor. `historyRecordTierStillApplies` (line 2067-2075) returns `true` when a record has NO scoped floors. A transient Tier 3 from missing verification keywords becomes a permanent floor for the same paths.

**Evidence:** After the first Tier 3 classification for README.md, all subsequent classifications start at floor 3 regardless of better evidence. This recreates the death spiral in a less visible form than the first-pass Tier 4.

**Fix:** Don't treat raw prior classification tier as a floor when the record has no active scoped floors and no mutation occurred under that record. Use only scoped-floor entries, unresolved verification failures, and gate-discovered floors from `maxTierFromOverlappingRecords`.

**Risk:** Weakens anti-slicing if too broad. Preserve objective scoped floors and gate-discovered floors; remove only no-floor/no-mutation prior-tier stickiness.

---

### B6: Legacy ceilings violate certificate-only authority (HIGH — 5/6 agents)

**Root cause:** `detectHardImpactCeilings` (line 946-982) still exists. `proveNullImpact` (line 1619) allows ceilings to satisfy null-impact when no certificate exists: `!hasTierOneCertificate && (certificates.length > 0 || ceilings.length === 0)`. This means a legacy ceiling can authorize Tier 1 without any EvidenceCertificate.

**Evidence:** Architecture says "certificates are the only tier-lowering authority." Current code has two parallel authorities.

**Fix:** Make `proveNullImpact` require `hasTierOneCertificate` unconditionally. Convert `detectHardImpactCeilings` to diagnostics-only or convert its logic into proper certificate computations.

**Risk:** Some tests that pass via ceilings without certificates will fail. Correct behavior — update tests.

---

### B7: `changesContractualDocs` is prose-based (MEDIUM — 3/6 agents)

**Root cause:** `changesContractualDocs` (line 3907-3911) scans `lowerEvidenceText` — untrusted agent prose — for words like `contract`, `config`, `prompt`. If the agent mentions "no contract impact," the regex fires and blocks Tier 1.

**Fix:** Base on certificate changed lines, not prose. A `blank_line_only` certificate should satisfy the non-contractual-docs obligation.

---

### B8: Classify-side and gate-side fingerprints use different implementations (MEDIUM — 4/6 agents)

**Root cause:** `plannedActionEffectFingerprint` (line 3684) and `pendingEffectFingerprintForInput` (line 3135) are separate functions that compute the same format string differently. Path extraction diverges: classify uses `action.paths[0]` or `structuredEffect.path`, gate uses `extractEditPatchPaths(patch)`.

**Fix:** Extract shared helper `editEffectFingerprint(patch, declaredPaths)` used by both. After B1 migration, planned and gate use identical code paths.

---

## Confirmed Non-Bugs

| Component | Status | Why |
|---|---|---|
| `detectObjectiveImpactFloors` for README.md | Correct | No floor for doc-only path; correct per design |
| `parseCertificateEditPatch` blank-line parsing | Correct | `+` → `['']` → `trim().length === 0` → certificate passes |
| `parseCertificateHunkHeader` format support | Correct | Supports `insert after N:`, `insert tail:`, etc. |
| Operation class for README.md | Correct | Both planned and gate return `prose_edit` |
| `certificateSnapshotText` README preimage | Correct | README < 24KB, snapshot available |

---

## Fix Priority and Sequencing

### Phase 3A: Minimum viable Test 3 fix (all required, tightly coupled)

1. **B3** — Stop phantom exact leases: `plannedActionEffectFingerprint` returns undefined without exact payload; `chooseLeaseKind` respects undefined.
2. **B4** — Certificate bypass for verification keyword: when Tier 1 certificate covers all planned actions with no objective floor, skip verification-keyword check in 3→2.
3. **B5** — Remove no-floor prior-tier stickiness from `maxTierFromOverlappingRecords`.

These three changes make the current codebase work for Test 3 even WITHOUT schema migration: if the agent happens to provide `exactOpaqueInput` with the exact patch text, certificates fire, prove-down reaches Tier 1, lease matches gate, and the edit succeeds. Without exact payload, classification correctly returns a blocked/scope lease instead of an unmatchable exact lease.

### Phase 3B: Schema/prompt migration (required for reliable Tier 1)

4. **B1** — Replace hash fields with exact payload fields in types/schema.
5. **B2** — `buildCertificateChangeSets` reads from structured exact payload fields.
6. **B8** — Shared fingerprint helper for planned and gate.
7. Prompt/tool-description update to instruct agents on exact payload contract.
8. Test migration from hash fields to exact payloads.

### Phase 3C: Architecture alignment (clean-up)

9. **B6** — Remove legacy ceilings from Tier 1 authority.
10. **B7** — Replace prose-based `changesContractualDocs` with certificate evidence.

---

## Exact Sequence That SHOULD Happen for Test 3

```
1. Agent reads README.md → obtains ¶README.md#9601, line 174
2. Agent calls holmes_classify:
   - proposedTier: 1
   - plannedActions: [{
       toolName: "edit",
       paths: ["README.md"],
       operationKind: "mechanical_text",
       exactOpaqueInput: "¶README.md#9601\ninsert tail:\n+"
     }]
   - reasoning: "...will verify by read-back..."
3. detectObjectiveImpactFloors: no floor for README.md
4. computeEvidenceCertificates:
   - buildCertificateChangeSets: parses exactOpaqueInput as edit patch
   - parseCertificateEditPatch: insert tail → newLines: ['']
   - computeBlankLineOnlyCertificate: sawBlankChange = true → blank_line_only [1]
5. proveBoundedImpact (4→3): passes
6. provePredictableImpact (3→2): passes (certificate bypass OR verification keyword)
7. proveNullImpact (2→1): hasTierOneCertificate = true, no floors ≥ 2 → passes
8. finalTier = 1
9. plannedActionEffectFingerprint: effect:edit:README.md:<hash(normalizePatchText(exactPatch))>
10. Lease: exact, fingerprint matches because same patch
11. Agent calls edit with identical patch
12. Gate: pendingEffectFingerprintForInput = same hash → coverage passes
13. Edit succeeds
14. Agent reads back README.md tail
```
