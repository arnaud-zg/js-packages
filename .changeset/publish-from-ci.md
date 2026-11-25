---
"shiplane": minor
"@shiplane/github": minor
"@shiplane/git": minor
---

Publish npm packages from GitHub Actions: `ship.yml` takes a test release channel (snapshot,
nightly, beta…) or `latest` as its environment, with a `dry-run` input. Every test release and
package release asks CI or this machine unless `via` is set, and `test-release` takes package names.
