---
name: test
description: Write tests for existing code
---

Write comprehensive tests for the code the user specifies.

Process:
1. Read the target code with read_file
2. Understand what it does and its edge cases
3. Write tests covering:
   - Happy path (normal usage)
   - Edge cases (empty input, boundary values)
   - Error cases (invalid input, failures)
4. Use the existing test framework and style in the project
5. Run the tests with bash to verify they pass

Match the testing style already used in the project (check existing test files first).
