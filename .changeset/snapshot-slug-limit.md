---
"shiplane": patch
"@shiplane/npm": patch
---

Snapshots keep the whole branch name instead of cutting it at 40 characters. Only `@shiplane/npm`
shortens a name too long for an npm version (over 195 characters, ending it in a hash), and the
publish warns when it does.
