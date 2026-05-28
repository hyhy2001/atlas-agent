---
name: fix
description: Find and fix a bug or error
---

Investigate and fix the issue described by the user.

Process:
1. Read the relevant files to understand the code
2. Identify the root cause (not just the symptom)
3. Propose a fix with explanation
4. Apply the fix using edit_file
5. Verify the fix makes sense (run tests if available with bash)

Be surgical — change only what's necessary. Don't refactor surrounding code unless it's directly causing the bug.
Respond in the same language the user used.
