---
"@shiplane/npm": patch
"shiplane": patch
---

A numbered test release skips the numbers of versions published then unpublished: npm refuses to
take them again, so `0.6.0-nightly.0` no longer fails with "Cannot publish over previously published
version".
