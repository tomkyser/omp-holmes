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
   - CLASSIFY: classify the gap as Tier 1, Tier 2, or Tier 3.
2. If the task is Tier 2 or Tier 3, run the full HOLMES loop:
   - Hone the target and constraints.
   - Observe relevant evidence.
   - Ladder from facts to implications.
   - Map dependencies, risks, and decision points.
   - Establish the next concrete execution path.
   - Synthesize the final plan.
3. Produce the Layer 4 execution packet before taking action: target, constraints, acceptance criteria, evidence needed, tool plan, risks, and first executable step.
4. Then execute according to the packet, preserving the classification and reasoning trail.