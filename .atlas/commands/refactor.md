---
name: refactor
description: Suggest and apply code refactoring improvements
---

Analyze the code and suggest refactoring improvements.

Focus on:
1. **Duplication** — extract repeated logic into functions
2. **Naming** — improve variable/function names for clarity
3. **Complexity** — simplify nested conditions, long functions
4. **Separation of concerns** — split mixed responsibilities
5. **Dead code** — remove unused code

Process:
1. Read the code thoroughly
2. List specific improvements with rationale
3. Wait for user approval before making changes
4. Apply changes incrementally, one concern at a time
5. Verify nothing is broken after each change

Don't change behavior — only structure.
