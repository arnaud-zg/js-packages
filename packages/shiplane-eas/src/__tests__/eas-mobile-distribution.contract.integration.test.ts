import { mobileDistributionContract, platformEnvContract, RecordingShell } from "shiplane/testing";

import { easMobileDistribution } from "../eas-mobile-distribution.adapter";

const settings = { update: { staging: "eas:update:staging", prod: "eas:update:prod" } };

mobileDistributionContract([
  // Its decision reads EAS builds and a version file the contract's empty fakes do not hold.
  { adapter: easMobileDistribution(), settings, decide: false },
]);

platformEnvContract([
  {
    adapter: easMobileDistribution(),
    settings,
    environment: "staging",
    listing: {
      shell: new RecordingShell().seed("pnpm exec eas env:list staging", {
        stdout: "SENTRY_DSN=*****\n",
      }),
      names: ["SENTRY_DSN"],
    },
    failing: new RecordingShell().seed("pnpm exec eas env:list", {
      status: 1,
      stderr: "Not logged in\n",
    }),
  },
]);
