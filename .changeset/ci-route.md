---
"shiplane": minor
"@shiplane/github": patch
---

The core names the way an app ships by its port, never its provider: `--via ci` ships through the
flow's CI pipeline, whatever plugin fills it. `--via github` still works and says it is now
`--via ci`. What a person reads, such as "GitHub Actions", the workflow file a ref must hold and the
command a dry run prints, now come from the CI pipeline adapter: `CiPipelinePort` gains optional
`label`, `workflowFile` and `dispatchLine`, so an adapter that leaves them out still works.
