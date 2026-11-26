---
"shiplane": patch
"@shiplane/npm": patch
---

On a GitHub Actions runner, a ship asks npm whether it trusts the workflow for each package before
it writes, tags or publishes anything. When npm does not, it stops and prints the `npm trust`
command of each package, instead of npm's bare `ENEEDAUTH` midway.
