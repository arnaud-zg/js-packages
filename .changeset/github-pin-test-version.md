---
"@shiplane/github": patch
---

`shiplane setup` and `shiplane doctor` write ship.yml on a test version too: it pins
`shiplane-ship.yml` to the commit the version's short sha names, where it used to ask to pin it by
hand.
