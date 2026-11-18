---
"shiplane": patch
"@shiplane/npm": patch
---

A snapshot from `shiplane test-release` keeps no npm tag, where it used to get a tag named after its
branch, so testing a branch no longer leaves a dist-tag behind on every package. npm needs a tag to
publish, so it goes out under `snapshot` and `npm dist-tag rm` removes it right after. The install
lines, the dry run and the pull request comment give each snapshot's exact version, such as
`npm i shiplane@0.6.0-feat-x.ae08284`; numbered channels still install by their tag, such as
`@beta`.
