---
"shiplane": minor
---

Say once how your apps ship: `via: "github"` or `via: "local"` in `shiplane.config.ts` stops the
"GitHub Actions or this machine?" question on every ship, also without a terminal. `--via` still
wins for one run, and a way that cannot ship an app still takes the other.
