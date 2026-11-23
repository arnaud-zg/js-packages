---
"shiplane": minor
"@shiplane/npm": minor
---

A package is built right before it publishes when its build is missing or older than its sources,
with the workspace packages it uses built first. A failed build publishes nothing. A config with a
`prepare` is unchanged: that command always runs instead.
