---
"shiplane": minor
"@shiplane/npm": patch
"@shiplane/changesets": patch
"@shiplane/github": patch
---

`shiplane/plugin` exports `registryDecision`, the rule a package registry ships by (production needs
preview first, a publish needs the tagged code), and `previousTag`. The npm adapter only reads the
facts it asks for, the commits versioning keeps its Conventional Commits rule in one file, and the
GitHub adapters share their `gh` requirement. Nothing changes in what they run or say.
