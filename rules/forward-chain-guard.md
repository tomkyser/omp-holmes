---
description: Blocks direct mutation plans before END/DELTA reasoning is established.
condition: '(?is:^(?!.{0,600}\b(?:ENVISION|DELTA|TARGET|END(?:\s+state)?|done\s+looks\s+like|success\s+(?:means|looks))\b).{0,700}\b(?:let\s+me|I(?:''ll|\s+will)|I\s+am\s+going\s+to)\s+(?:directly\s+|just\s+)?(?:edit|write|run|apply|execute)\b)'
scope: text, thinking
---
Stop before mutating anything. Complete the cognitive redirect first: state the END condition, identify the DELTA from current state to target state, and name the first observable checkpoint. Only then choose a tool call that closes that delta. If the END/DELTA is not known, locate the missing evidence before acting.
