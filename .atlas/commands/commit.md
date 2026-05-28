---
name: commit
description: Create a well-formatted git commit for current changes
---

Create a git commit for the current staged/unstaged changes.

Process:
1. Run `git status` and `git diff` to understand what changed
2. Analyze the changes and determine:
   - Type: feat, fix, refactor, test, docs, chore
   - Scope: which module/component was changed
   - Impact: what behavior changed
3. Write a commit message following conventional commits format:
   `type(scope): short description`
   
   Body (if needed): explain WHY, not what
4. Stage relevant files (avoid staging unrelated files or secrets)
5. Create the commit

Ask the user to confirm the commit message before committing.
