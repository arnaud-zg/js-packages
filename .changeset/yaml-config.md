---
"shiplane": minor
"@shiplane/changesets": minor
---

`shiplane.yml` is read beside `shiplane.config.ts`: each port of the flow names its adapter
(`sourceControl: git`), each module the adapter it ships with, and an adapter with options takes
`use:` and `with:`. A local file exporting a `catalog` is named by its path. A problem in it carries
its line and the fix, and a repository holding both configs is told to keep one. The changesets
`line` and `thanks` options also take a ready-made template by name, such as `whatsChanged` or
`none`.
