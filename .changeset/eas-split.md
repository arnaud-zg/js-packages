---
"@shiplane/eas": patch
---

The EAS adapter is split by purpose: preview, production and retry decisions, jobs, the version
file, verdicts and wording each live in their own file, and every eas command is built in one place.
Nothing changes in what it decides, runs or says.
