---
"@shiplane/eas": patch
---

An over-the-air update on a runner publishes again: the tag reaches `eas update` as
`--message mobile@1.0.0`, with no `--` before it, which pnpm passed on and eas rejected as
unexpected arguments.
