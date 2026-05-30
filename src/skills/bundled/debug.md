---
name: debug
description: Start a structured debug session — usage /debug <problem>
args: [problem]
---
Debug systematically:

1. **Symptoms**: What's actually happening? Get the exact error message, command, or behavior.
2. **Hypothesis**: List 2-3 plausible causes from most to least likely.
3. **Test**: For each hypothesis, identify 1-2 minimal tools/commands to confirm or rule out. Use bash, read_file, lsp diagnostics as appropriate.
4. **Root cause**: State what's wrong and why.
5. **Fix**: Apply the smallest change that addresses the root cause.
6. **Verify**: Re-run the failing command to confirm the fix.

Don't guess. Don't apply fixes before testing hypotheses.
