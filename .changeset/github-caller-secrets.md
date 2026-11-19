---
"@shiplane/github": patch
---

The `ship.yml` it writes passes each secret by name instead of `secrets: inherit`, and asks to write
to issues and pull requests only when the release comments on them.
