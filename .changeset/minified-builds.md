---
"agent-context-budget": patch
"expo-native-guard": patch
"expo-pnpm-catalog": patch
"shiplane": patch
"@shiplane/changesets": patch
"@shiplane/cloudflare-pages": patch
"@shiplane/eas": patch
"@shiplane/fly": patch
"@shiplane/git": patch
"@shiplane/github": patch
"@shiplane/npm": patch
"vite-workspace-resolver": patch
---

The published JavaScript is minified, 32% to 52% smaller, and still tree-shakes as before: a bundler
importing one function keeps the same bytes. Functions and classes keep their names, and source maps
map back to the source. agent-context-budget and expo-pnpm-catalog stay CommonJS, with the same
exports and command.
