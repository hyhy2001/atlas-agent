---
name: remember
description: Save a fact to project memory — usage /remember <fact>
args: [fact]
---
When the user invokes /remember:

1. Take the user's input as the fact to save.
2. Generate a short kebab-case key from the fact (e.g. "uses 9router proxy" → "uses-9router").
3. Call memory_save with the key and content.
4. Confirm what was saved with the key name.
