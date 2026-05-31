---
description: Blocks unverified planning assumptions from being treated as facts.
condition: '(?is:\b(?:this\s+should\s+work|I\s+believe\s+(?:this|that|it)|probably|I\s+think\s+(?:this|that|it)\s+will|most\s+likely)\b.{0,160}\b(?:so\s+(?:I(?:''ll|\s+will)|let\s+me)|therefore|which\s+means\s+(?:I(?:''ll|\s+will)|let\s+me))\b)'
scope: text, thinking
---
Do not convert a guess into a plan. Name the assumption explicitly, say what would prove or disprove it, and verify that evidence before proceeding. If verification is cheap, do it now; if it is not, narrow the next step to evidence-gathering only. Resume action only after the claim is grounded.
