---
"shiplane": minor
"@shiplane/github": minor
"@shiplane/github-pages": minor
---

GitHub Pages sites ship from GitHub Actions too, through shiplane's workflow. `variables` in the
unit file names what the build reads: from your shell, or from GitHub's repository or environment
variables. A requirement can ask for `permissions` and `variables`; setup writes them in `ship.yml`,
and doctor adds the missing ones.
