---
"shiplane": patch
---

A snapshot from `shiplane test-release` publishes under the one npm tag `snapshot`, not a tag named
after its branch, so testing a branch no longer leaves a dist-tag behind on every package. The
install lines, the dry run and the pull request comment give each snapshot's exact version, such as
`npm i shiplane@0.6.0-feat-x.ae08284`; numbered channels still install by their tag, such as
`@beta`.
