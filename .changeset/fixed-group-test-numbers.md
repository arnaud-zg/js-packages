---
"shiplane": patch
"@shiplane/changesets": patch
---

A numbered test release gives the packages of a changesets `fixed` group one number, the highest any
of them needs, so `shiplane` and `@shiplane/*` all publish `0.6.0-nightly.3`. The changesets and
commits versioning read the groups with changesets' own `readConfig`.
