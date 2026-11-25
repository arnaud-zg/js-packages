---
"@shiplane/npm": patch
---

On a GitHub Actions runner with `id-token: write`, the sign-in check no longer runs `npm whoami`,
which fails with trusted publishing: test releases publish from a runner with no npm secret.
