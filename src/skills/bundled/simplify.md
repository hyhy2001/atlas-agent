---
name: simplify
description: Review recent code changes for unnecessary complexity and apply simplifications
---
When invoked or when reviewing code, look for:

- Unnecessary abstractions or wrapper functions
- Duplicated logic that can be extracted
- Overly defensive error handling for cases that can't happen
- Functions longer than 50 lines that mix concerns
- Premature generalization (only one caller)

Use git_diff to see recent changes and edit_file to apply fixes.
Report what you changed and why. Don't change semantics — only structure.
