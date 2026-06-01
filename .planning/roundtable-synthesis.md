# Roundtable Synthesis: Adversarial Agent for Hard-Floor Detection

## Panel Consensus (6/6)

**The panel unanimously rejected the naive version of your idea and unanimously endorsed a refined version of it.**

### What they rejected

> "Replace regex with a skeptical model that decides whether the change is safe."

Every panelist identified the same fatal flaw: if the adversarial model receives session-agent-authored text and can *lower* a tier, it becomes a second self-authorization surface. The session agent controls `reasoning`, `impact`, `plannedActions`, `unknowns`, and visible text. A model evaluating that prose has the same information asymmetry as the regex — it's just harder to predict which inputs fool it.

**RedTeam-slow**: *"Absence of an objection is not proof of safety."*

**Architect-plan**: *"For safety, unpredictability is not a substitute for authority separation. If the skeptical model can lower a floor based on prose, it becomes a second self-authorization surface."*

### What they endorsed

> "A **prosecutor model** over **extension-gathered ground truth**, with no authority to lower tiers or decide safety."

All six converged on the same three-layer architecture.

---

## The Converged Design

### Layer 1: Objective Deterministic Checks (KEEP, sharpen)

These are extension-observed facts, not prose interpretation. They **cannot** be overridden by any model:

| Signal | Source | Floor |
|---|---|---|
| Agent guardrail path | Path regex | Tier 3-4 |
| Opaque tool without exact input | Tool name + missing binding | Tier 3-4 |
| Deploy/migration/schema path | Path regex | Tier 3-4 |
| File-state drift | Preimage digest mismatch | Block |
| Scope/effect/fingerprint mismatch | Gate computation | Block |
| Prior verification failure | Ledger | Tier 4 |
| Mutation budget exceeded | Lease counter | Block |
| Test weakening (skip/only/delete) | Patch content regex | Tier 3 |

**What changes:** Regex keyword scanning over concatenated prose (`lowerEvidenceText`) is **demoted** from "hard floor" to "lexical risk signal." It no longer directly creates irreversible Tier 4 floors. It becomes input to the prosecutor or a weak hint for deterministic mapping.

### Layer 2: Verified Evidence Certificates (NEW)

The extension itself gathers checkable evidence and issues deterministic certificates. **This is where tier-lowering authority lives:**

| Certificate | How computed | Proves |
|---|---|---|
| `whitespace_only` | Normalize old/new text, compare non-whitespace | Tier 1 eligible |
| `comment_only` | Parse hunks, reject pragmas/directives | Tier 1 eligible |
| `docs_prose_only` | Path class + changed lines contain no executable/contract content | Tier 1 eligible |
| `blank_line_only` | Patch adds/removes only empty lines | Tier 1 eligible |
| `ast_equivalent` | Parse old/new, compare normalized AST | Tier 1-2 eligible |
| `exports_unchanged` | Diff export/public symbol table | Bounded impact |
| `references_bounded` | LSP/grep reference count for changed symbols | Bounded impact |
| `local_only` | No cross-file effects, single function scope | Tier 2 eligible |

**Key principle:** Tier lowering requires a deterministic certificate. No model can lower a tier by claiming something is safe. The extension must *verify* the claim.

### Layer 3: Risk Prosecutor (REPLACES existing LLM assessor)

**Not a new layer** — replaces `runLlmAssessor` with a different contract. One model call, same slot.

**Role:** Prosecutor, not judge. Perceives risks the deterministic layer missed. Cannot acquit, lower tiers, or decide safety.

**What it receives (extension-constructed, not session-authored):**
- User request (labeled as untrusted data)
- Exact planned tool input / normalized patch (extension-computed)
- Pre/post file snippets around changed hunks (extension-read)
- AST diff / export delta (extension-computed)
- Path class, file role, operation class (extension-derived)
- Deterministic certificates already issued
- Ledger state (prior blocks, verification failures, scope history)
- Session claims as a *quarantined `untrustedClaims` section* — each tagged as unverified

**What it does NOT receive:**
- Session's proposed tier (no anchoring)
- Session's hidden reasoning or chain-of-thought
- Raw session `reasoning` field as narrative context
- Authority to call tools, read arbitrary files, or access secrets
- Any previous model conclusion as authority

**Output schema (strict JSON, no prose):**
```json
{
  "risks": [{
    "kind": "export_contract_change",
    "severity": "high",
    "evidenceIds": ["astdiff:src/types.ts:42"],
    "explanation": "Exported type renamed without compatibility alias",
    "missingEvidence": ["reference graph for OldTypeName"],
    "confidence": "high"
  }],
  "unsupportedClaims": [{
    "claimId": "claim:no_public_api_impact",
    "reason": "Export diff shows public symbol changed",
    "neededEvidence": ["consumer audit or compatibility alias"]
  }],
  "requiredChecks": ["LSP references for renamed symbol"],
  "promptInjectionSeen": false
}
```

**Deterministic mapping of prosecutor output:**
- High-severity cited risk on auth/security/data/deploy/contract surface -> Tier 4 floor
- Medium-severity cited risk or missing evidence for boundedness -> Tier 3 floor
- Low-severity cited risk -> advisory only, no floor
- Unsupported claim -> proof obligation (not a floor, but blocks prove-down until evidence gathered)
- Uncited/fabricated risk -> logged, no floor effect
- Timeout/malformed/unavailable -> fail-closed at current deterministic tier (not Tier 4)

---

## How This Solves Each Problem

| Problem | Current | After |
|---|---|---|
| "No public API impact" -> Tier 4 | Regex matches `public api` + `unknown` | Words in prose don't matter. Extension checks export diff. If exports unchanged -> certificate. If changed -> prosecutor evaluates actual diff. |
| Keyword avoidance for dangerous change | Attacker skips `auth`/`security` in prose -> no floor | Extension inspects actual patch, path class, AST diff. Can't hide the patch from extension-owned evidence. |
| Sticky false-positive Tier 4 | Scalar `priorTierFloor` locks entire request | Prosecutor outputs are scoped, cited, and resolvable. Not stored as irreversible scalar. |
| Fingerprint chicken-and-egg | Agent must guess SHA-256 before editing | Extension computes fingerprint from raw planned patch |
| Operation class divergence | Two functions, different taxonomies | One canonical function over `{tool, paths, payload}` |

---

## What Gets Compromised

### Genuinely weaker
The system loses the ability to catch risk signals that are **only** present in session prose and **not** visible in the actual patch, path, AST, or file content. Example: a syntactically-local helper function used in an authorization check — the extension can't see that relationship from the diff alone.

**Mitigation:** The prosecutor receives full diff and surrounding code context. It can hypothesize "this function may be security-relevant" even without explicit keywords. But it's perception, not proof — a sophisticated adversary might still slip past.

### Not covered by any approach
- External consumers not in the repo
- Production data shape and rollback safety
- Dynamic dispatch / metaprogramming / reflection
- Runtime concurrency properties
- Business domain semantics when syntax looks local

### Unchanged
- Prove-down architecture (Tier 4 start)
- Extension owns classification authority
- Gate enforces scope/fingerprint/lease
- Session agent cannot self-authorize
- Opaque tools remain high-tier

### Strictly stronger
- False positives are recoverable
- Negation prose doesn't trigger floors
- Fingerprints are satisfiable
- Tier 1 actually works for cosmetic changes
- Model can't lower tiers (prosecutor, not judge)

---

## Implementation Sketch

```
assessImpactTier(snapshot, params):
  seed = buildImpactSeed(snapshot, params, priorRecords)
  
  // Layer 1: objective deterministic
  objectiveFloors = detectObjectiveFloors(seed)     // paths, tools, drift, ledger
  certificates = computeEvidenceCertificates(seed)   // Layer 2
  
  // Short-circuit: if objective Tier 4 floor, skip model
  if objectiveFloors has unoverridable Tier 4:
    return finalProveDown(objectiveFloors, certificates, noModelResult)
  
  // Layer 3: prosecutor for soft middle
  if needsProsecutorReview(seed, objectiveFloors, certificates):
    packet = buildTrustedPacket(seed, certificates, objectiveFloors)
    review = runRiskProsecutor(packet)  // replaces runLlmAssessor
    softFloors = mapProsecutorToFloors(review)
  else:
    softFloors = []
  
  return finalProveDown(objectiveFloors + softFloors, certificates)
```

---

## Raw Agent Reports

| Agent | Key contribution |
|---|---|
| `agent://61-RedTeamSlowRT` | "Absence of objection != proof of safety." Model must be upward-only over extension evidence. Detailed anti-gaming test proposals. |
| `agent://62-RedTeamPlanRT` | Traced exact code paths for each hard floor. Showed which can/can't be evaluated by a model vs regex. |
| `agent://63-StaffEngSlowRT` | Concrete integration point, floor split (objective vs soft), pipeline sketch, and prompt draft. |
| `agent://64-StaffEngPlanRT` | Latency analysis: replace assessor don't add second call. Model selection and caching strategy. |
| `agent://65-ArchitectSlowRT` | Trust hierarchy. Prosecutor-not-judge framing. Converged three-layer design. |
| `agent://66-ArchitectPlanRT` | Verified evidence as foundation. Prosecutor over ground truth only. Full attack vector analysis. |
