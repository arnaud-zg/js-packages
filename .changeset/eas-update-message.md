---
"@shiplane/eas": patch
---

An over-the-air update ships on a runner: `eas update` gets the tag as its message
(`-- --message mobile@1.0.0`), which it needs off a terminal. A script that already has `--message`,
`-m` or `--auto` runs as written.
