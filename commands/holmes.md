---
description: "Invoke the HOLMES reasoning loop on the current task"
argument-hint: "<task description or context>"
---

Apply the full HOLMES reasoning procedure to this task context:

$ARGUMENTS

Before acting, show your structured reasoning transparently:

1. Complete Layer 0 cognitive redirect:
   - HALT: stop and restate the actual problem.
   - ENVISION: define the desired end state.
   - LOCATE: identify the current position and known facts.
   - DELTA: name the gap between current state and target state.
   - CLASSIFY: call `holmes_classify`; its returned tier, requirements, and scope are authoritative. Start at Tier 4 and prove down only with evidence.
2. Route by the returned tier:
   - Tier 4 or Tier 3: run the full HOLMES loop:
     - Hone the target and constraints.
     - Observe relevant evidence.
     - Ladder from facts to implications.
     - Map dependencies, risks, and decision points.
     - Establish the next concrete execution path.
     - Synthesize the final plan.
   - Tier 2: make one compact pass with TARGET, DELTA, needed evidence, verification, and the next executable step; then execute inside the returned scope.
   - Tier 1: act directly inside the returned scope without extra HOLMES ceremony.
3. Produce the Layer 4 execution packet before taking action: target, constraints, acceptance criteria, evidence needed, tool plan, risks, and first executable step.
4. Then execute according to the packet, preserving the classification and reasoning trail.