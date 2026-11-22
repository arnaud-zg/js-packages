---
"shiplane": patch
"@shiplane/github": patch
---

A ship through GitHub Actions, or its retry, runs the default branch's `ship.yml` and checks out the
tag it ships: a fix to the workflow reaches tags cut before it, and what deploys is still the tag's
code. `ship.yml` takes a `ref` input for it; `shiplane doctor` adds it when it re-pins an older one,
and until then a ship runs on the tag as before.
