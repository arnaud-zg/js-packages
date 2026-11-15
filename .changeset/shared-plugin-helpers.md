---
"@shiplane/fly": patch
"@shiplane/cloudflare-pages": patch
"@shiplane/eas": patch
"@shiplane/git": patch
"@shiplane/github": patch
"@shiplane/npm": patch
---

The plugins read a failed command's error line, retry a dropped push or a rate-limited call and read
JSON through the shared `shiplane/plugin` helpers. Nothing changes in what they run or say.
