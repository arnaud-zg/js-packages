---
"shiplane": minor
---

`shiplane setup` writes `.github/workflows/ship.yml`, which ships through shiplane's own workflow
pinned to the installed release, and `shiplane doctor` offers to write it, replace it or re-pin it.
When the repository has a JSON Renovate config, setup adds the
`github>arnaud-zg/js-packages//renovate/shiplane` preset to its `extends` so Renovate keeps that pin
current.
