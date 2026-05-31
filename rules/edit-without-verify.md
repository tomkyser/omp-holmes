---
description: Blocks edit plans that do not include verification after mutation.
condition: '(?is:(?:\b(?:edit|write|patch|modify)\b(?:(?!\b(?:verify|verification|confirm|confirmation|check|read[- ]?back|re-read|inspect)\b).){0,260}\b(?:and\s+)?(?:we(?:''re|\s+are)\s+done|done|that\s+should|finish(?:ed)?|complete)\b|\bapply\s+the\s+change\b(?!.{0,260}\b(?:verify|verification|confirm|confirmation|check|read[- ]?back|re-read|inspect)\b)))'
scope: text, thinking
---
A mutation is not complete until its effect is verified. Add an explicit read-back or targeted check after the edit/write/apply step, and say what evidence will confirm the change. Prefer the smallest verification that exercises the changed behavior or file contents. Do not call the work done based only on the mutation succeeding.
