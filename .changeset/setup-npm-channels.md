---
"shiplane": minor
"@shiplane/github": minor
"@shiplane/npm": minor
---

**Breaking:** an npm package with one dist-tag skips preview and publishes on production, like every
other target: beside apps, it publishes when you promote. A repository of packages only still
releases in one command. `ship.yml`'s `options` are the only list of environments, yours to edit;
setup and doctor derive the permissions from it.
