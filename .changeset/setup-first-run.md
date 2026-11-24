---
"shiplane": minor
"@shiplane/github-pages": patch
---

`setup` asks less and guesses better on a new repository: GitHub means GitHub Actions unless another
CI is there, what is proven is not asked again, a likely adapter is suggested first, a repository
named `x.github.io` is read whole, and changesets get your default branch. A `package.json` with no
version is said so. `doctor` asks for no `ship.yml` when `via` is `local`. `--help` and an unknown
flag no longer crash.
