---
"shiplane": minor
---

The ship workflow now receives only the secrets your configured adapters read, passed by name in the
`ship.yml` setup writes, and only its check and ship steps see them; `shiplane doctor` offers to fix
a `ship.yml` that passes `secrets: inherit` or misses one.
