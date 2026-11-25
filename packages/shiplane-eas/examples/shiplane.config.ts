import { changesetsVersioning } from "@shiplane/changesets";
import { easMobileDistribution } from "@shiplane/eas";
import { gitSourceControl } from "@shiplane/git";
import { gitHubActionsCiPipeline, gitHubCodeHost } from "@shiplane/github";
import { defineRelease, mobileApp, releaseFlow } from "shiplane";

export default defineRelease({
  flow: releaseFlow({
    sourceControl: gitSourceControl(),
    codeHost: gitHubCodeHost(),
    ciPipeline: gitHubActionsCiPipeline(),
    versioning: changesetsVersioning(),
  }),
  deployApps: { promote: [{ from: "staging", to: "prod" }] },
  modules: [mobileApp({ mobileDistribution: easMobileDistribution() })],
});
