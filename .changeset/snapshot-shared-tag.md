---
"shiplane": patch
"@shiplane/npm": patch
---

A snapshot from `shiplane test-release` keeps no npm tag, where it used to get a tag named after its
branch, so testing a branch no longer leaves a dist-tag behind on every package. npm needs a tag to
publish, so it goes out under `snapshot` and `npm dist-tag rm` removes it right after. The pull
request comment offers no tag to follow for a snapshot, only for a numbered channel such as `@beta`.
