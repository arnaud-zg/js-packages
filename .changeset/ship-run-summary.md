---
"shiplane": patch
"@shiplane/github": patch
---

A ship run has a short title, `Ship to nightly`, and the packages are on its run page: a test
release writes each one with its version before it publishes, and its result after, even when it
fails. An existing `ship.yml` keeps its title until you change its `run-name`.
