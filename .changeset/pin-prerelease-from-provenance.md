---
"@shiplane/github": patch
---

`shiplane doctor` re-pins `ship.yml` to a pre-release such as `0.6.0-nightly.17` on its own: with no
release tag, it pins the commit the version's npm provenance names, instead of asking to pin by
hand.
