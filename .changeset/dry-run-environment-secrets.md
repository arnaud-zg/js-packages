---
"shiplane": patch
"@shiplane/github": patch
---

A dry run of `ship.yml` names the environment with `deployment: false`, so `doctor --ci` reads the
secrets kept in it instead of failing on them as missing. `shiplane doctor` offers to update a
`ship.yml` written before.
