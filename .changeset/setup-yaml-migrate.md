---
"shiplane": minor
"@shiplane/git": minor
"@shiplane/github": minor
"@shiplane/changesets": minor
---

`shiplane setup --format yaml` writes `shiplane.yml` instead of `shiplane.config.ts`, and setup run
again adds new apps to the `shiplane.yml` there, its comments kept. `shiplane migrate` writes
`shiplane.yml` from `shiplane.config.ts`, loads it back, and removes the TS config only when both
release the same; what YAML cannot hold, such as a function, is listed with where it is and nothing
is written. An adapter or a feature can now say which options its factory was given (`options`), and
the first-party ones do, so migrate carries them over.
