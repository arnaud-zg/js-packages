---
"shiplane": minor
"@shiplane/github": minor
"@shiplane/npm": minor
---

`shiplane setup` writes a `ship.yml` that publishes npm packages: the test release channels, `live`,
a dry run and the permissions npm trusted publishing needs. `shiplane doctor` offers to add them to
one already there, and accepts a `ship.yml` calling shiplane's workflow in its own repository.
