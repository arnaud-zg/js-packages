---
"@shiplane/npm": minor
"shiplane": patch
---

`npmPackageRegistry({ staged: true })` uploads a release with `npm stage publish`: it is public only
once a maintainer approves it with 2FA on npm. Off by default, recommended. Shipping again while a
version waits uploads nothing, and test releases still publish at once.
