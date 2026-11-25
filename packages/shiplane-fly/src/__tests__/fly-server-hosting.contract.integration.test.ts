import { platformEnvContract, RecordingShell, serverHostingContract } from "shiplane/testing";

import { flyServerHosting } from "../fly-server-hosting.adapter";

const settings = { app: { staging: "api-staging", prod: "api" } };

serverHostingContract([{ adapter: flyServerHosting(), settings }]);

platformEnvContract([
  {
    adapter: flyServerHosting(),
    settings,
    environment: "staging",
    listing: {
      shell: new RecordingShell().seed("flyctl secrets list -a api-staging --json", {
        stdout: JSON.stringify([{ name: "SENTRY_DSN" }]),
      }),
      names: ["SENTRY_DSN"],
    },
    failing: new RecordingShell().seed("flyctl secrets list", {
      status: 1,
      stderr: "Error: no access token available\n",
    }),
  },
]);
