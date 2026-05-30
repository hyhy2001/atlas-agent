---
name: loop
description: Schedule a recurring prompt — usage /loop [interval] <prompt>
args: [interval, prompt]
---
When the user invokes /loop:

1. Parse input as `[interval] <prompt>`. Interval format: `Ns/Nm/Nh/Nd`.
2. Convert interval to a cron expression:
   - Nm where N<=59 → `*/N * * * *`
   - Nh where N<=23 → `0 */N * * *`
   - Nd → `0 0 */N * *`
3. Call cron_create with the cron expression, the prompt, recurring=true.
4. Show the job id and nextFireAt.
5. If no interval is given, default to 10m.
6. If the prompt is empty after parsing, show usage and stop.
