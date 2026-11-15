---
"shiplane": minor
---

A ship can run a job from its tag's commit in a temporary worktree (`Job.from`), and a `choose`
decision can name its kind, skip the final confirm and refuse when nobody can answer. A build may
start from a checkout detached at exactly the release's tag.
