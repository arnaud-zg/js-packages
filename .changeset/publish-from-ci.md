---
"shiplane": minor
"@shiplane/github": minor
"@shiplane/git": minor
---

Publish npm packages from GitHub Actions: `shiplane-ship.yml` takes a test release channel
(snapshot, nightly, beta…) or `live` as its environment, with `dry-run` and `build` inputs. Every
test release and package release asks CI or this machine unless `via` is set, and `test-release`
takes package names.
