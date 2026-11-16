---
"shiplane": minor
---

`shiplane branch` publishes a test version from any branch, pull request or not, and from the
default branch (what the next release ships, as `x.y.z-main.<sha>` on npm tag `main`). The pull
request comment takes a template: `defineRelease({ testComment })` with `comments.table` (the
default), `comments.compact`, or your own text.
