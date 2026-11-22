---
"shiplane": patch
---

`consumerRepository` from `shiplane/testing` leaves the repository a git hook runs in alone: it
drops the variables that point git at a repository, such as the GIT_DIR a pre-push hook sets.
Before, tests run from a hook in a linked worktree turned that repository bare.
