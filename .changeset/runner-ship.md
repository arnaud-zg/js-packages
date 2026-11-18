---
"shiplane": minor
---

On a GitHub Actions runner, `shiplane ship` ships every unit even when one fails, groups each unit's
log, writes a plan and a result table to the run page, and exits 1 when any failed; the new
`prepare` config key runs a command before each unit ships from this machine; and
`shiplane doctor --ci [units…] --channel <env>` checks the units, the environment, each tool
(installing a missing one) and each secret a runner needs.
