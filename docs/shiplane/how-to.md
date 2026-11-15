[🏠 Home](../../README.md) · [📚 Docs](../README.md) ·
[`shiplane`](../../packages/shiplane/README.md) · [🚀 Tutorial](./tutorial.md) · **🛠️ How-to** ·
[📖 Reference](./reference.md) · [🔌 Plugins](./plugins.md) · [💡 Explanation](./explanation.md)

# 🛠️ How-to

**Apps:** [Add an app](#add-an-app) · [Stop shipping an app](#stop-shipping-an-app) ·
[Set a value per environment](#set-a-value-per-environment) ·
[Read another app's value](#read-another-apps-value) ·
[Check env before deploy](#check-env-before-deploy) · [Hold an app back](#hold-an-app-back)

**Release:** [Force another version](#force-another-version) ·
[Preview every command](#preview-every-command) · [Promote to production](#promote-to-production) ·
[Widen a production rollout](#widen-a-production-rollout) ·
[Retry a failed release](#retry-a-failed-release) ·
[Choose GitHub Actions or this machine](#choose-github-actions-or-this-machine) ·
[Ship with no laptop](#ship-with-no-laptop) · [Use it from a script](#use-it-from-a-script)

**Hosts and versions:** [their own page](./how-to-hosts.md): npm, Claude Code plugins, version
bumps, release notes, your own host, release comments, sign-ins.

**Terminal:** [Bring your own mascot](#bring-your-own-mascot) ·
[Turn the mascot off](#turn-the-mascot-off)

## Add an app

```sh
pnpm shiplane add apps/docs
```

Or write `apps/docs/shiplane.unit.yml` yourself; `shiplane docs web-app` lists its keys:

```yaml
module: web-app
project: acme-docs
```

## Stop shipping an app

```sh
pnpm shiplane remove docs
```

Its unit file goes. Changesets still version it.

## Set a value per environment

```yaml
app:
  preview: acme-api-preview
  production: acme-api
```

## Read another app's value

```yaml
build:
  env:
    VITE_API_URL: ${units.api.url}
```

The app read must ship first: list its module before the reader's in `modules`.

## Check env before deploy

List the env var names an app reads. Before each deploy, shiplane checks they are set on the
platform. You set the values; shiplane only reads names, never values.

```yaml
# apps/api/shiplane.unit.yml
checkEnvBeforeDeploy:
  - SENTRY_DSN
  - DATABASE_URL
```

Names that differ per environment: `all` holds the shared ones, and an environment adds its own. A
new environment inherits `all`.

```yaml
checkEnvBeforeDeploy:
  all:
    - SENTRY_DSN
  production:
    - REVENUECAT_PROJECT_ID
```

| When a name is unset               | What happens                                             |
| ---------------------------------- | -------------------------------------------------------- |
| In a terminal                      | It prints the command to set it, waits, then reads again |
| In CI, with `--yes` or no terminal | Nothing runs; it prints the command and exits 1          |
| The plugin cannot list names       | A warning, and the deploy goes on                        |

Fly reads its secrets and the fly.toml `[env]` keys, EAS its environment's variables, and Cloudflare
Pages its secrets plus the unit's `build.env`. `shiplane doctor` shows the same check for every
environment. `release`, `promote` and `ship` check before anything deploys; a release to preview
checks before it opens the release PR.

## Hold an app back

Untick it when `pnpm shiplane` asks what to release. Its changesets wait for the next release.

## Force another version

When everything a release moves lands on one version, `pnpm shiplane` asks for it, with the computed
version selected:

```text
◆  Release these to preview as (Esc cancels)
│  ○ 1.0.0  major
│  ● 0.5.0  minor, computed
│  ○ 0.4.1  patch
```

Enter releases the computed version. Pick another and it asks why, in one line:

```text
◆  Why 1.0.0? Tell users what changed, in one line.
│  Drops subjectsSince from SourceControlPort
```

Esc or an empty line goes back to the versions. The line reaches the changelog, the release PR and
the release notes, as
`Version forced to 1.0.0 instead of 0.5.0: Drops subjectsSince from SourceControlPort`. Everything
the release moves takes the forced version, a whole fixed group included, and a changeset's own bump
gives way when you go lower.

- **Units moving to different versions** get a plain yes: untick the others to force one.
- **`--yes` and a run without a terminal** keep the computed version.
- **An open release PR** has its version already: close it and run `pnpm shiplane` to change it.
- **A release PR replaced because main moved** starts again from the computed version, so force it
  again. `--yes` will not ask.
- **Versioning that cannot land there**, a peer dependency pulling a unit further, stops with
  `Can't force` and writes nothing.

## Preview every command

```sh
pnpm shiplane plan --channel production
```

Nothing runs. It prints the release order, then each command, both ways.

## Promote to production

```sh
pnpm shiplane promote
```

Type `production` when asked. Web apps redeploy the tag preview runs; the mobile app may first open
a PR moving its production version, then build after you merge it.

## Widen a production rollout

Run `pnpm shiplane promote` again and pick the mobile app. It shows the rollout, its launches and
crashes, and suggests the next step: 25%, 50%, everyone, stay, or roll back.

## Retry a failed release

```sh
pnpm shiplane
```

Run the same command again. It reads what is already done and skips it: an open release PR is picked
up, a pushed tag is not made twice, notes already published are kept. Only the step that failed runs
again.

A unit whose ship failed comes back ticked in the first question, as `released, not on preview yet`
(`not live yet` for a package, `never reached preview: retry` for a mobile app). Press Enter and it
goes straight to the ship.

To redeploy one unit without the questions:

```sh
pnpm shiplane ship my-api                      # add --channel production for production
```

If the unit is greyed out as `deploying already`, a GitHub deployment is still marked in progress.
Find its run with `gh run list --limit 5` and rerun it from GitHub.

## Choose GitHub Actions or this machine

```sh
pnpm shiplane ship --via github     # or --via local
```

Without `--via`, it asks per app and shows this month's Actions minutes. An app only one way can
ship is not asked, and it says why.

## Ship with no laptop

Run the **Ship** workflow from the Actions tab, on a tag or `main`, with the units and the
environment. Production runs as soon as you start it.

## Use it from a script

```sh
pnpm -s shiplane status --json
```

Without a terminal every question answers no: pass `--yes` (refused on production) and `--via`.

## Bring your own mascot

A built-in mascot sits beside the live line by default. Give `display.mascot` frames for the moods
you want; any mood you leave out uses the built-in frames:

```ts
// shiplane.config.ts
export default defineRelease({
  display: {
    mascot: {
      working: ["(=^･ω･^=)/", "(=^･ω･^=)-"], // looped while something runs
      happy: ["(=^▽^=) ✦"],
      worried: ["(=;ω;=)"],
    },
  },
  // flow, modules…
});
```

To react to more than the mood, give a function. It gets the mood, the animation tick and what runs
right now:

```ts
import type { Mascot } from "shiplane";

const rocket: Mascot = ({ mood, tick, label }) =>
  mood === "worried" ? "💥" : label.includes("production") ? "🚀✨" : ["🛰", "🛸"][tick % 2];

export default defineRelease({ display: { mascot: rocket } /* flow, modules… */ });
```

Shiplane pads every frame to one width so lines stay aligned, colours it (green when happy, red when
worried), and holds it still in CI or under `NO_MOTION=1`. To share one, export it from a package
(`shiplane-mascot-<name>`) and import it in the config. The moods are in the
[reference](./reference.md#mascot).

## Turn the mascot off

For one run: `pnpm shiplane --no-mascot`. For good: `display: { mascot: false }` in
`shiplane.config.ts`. `--mascot` brings it back for one run, your own if the config has one.

## Example

[`examples/repository/shiplane.config.ts`](../../packages/shiplane/examples/repository/shiplane.config.ts)
wires one adapter per port and ships an API on Fly and a site on Cloudflare Pages;
`packages/shiplane-integration/src/__tests__/examples.e2e.test.ts` runs it.
