import { platformEnvContract, RecordingShell, staticHostingContract } from "shiplane/testing";

import { cloudflarePagesStaticHosting } from "../cloudflare-pages-static-hosting.adapter";

const settings = { project: "admin-site", secretsIn: "theirs" };

staticHostingContract([{ adapter: cloudflarePagesStaticHosting(), settings }]);

platformEnvContract([
  {
    adapter: cloudflarePagesStaticHosting(),
    settings,
    environment: "production",
    listing: {
      shell: new RecordingShell().seed("npx --yes wrangler@4.141.0 pages secret list", {
        stdout: "  - TURNSTILE_SECRET: Value Encrypted\n",
      }),
      names: ["TURNSTILE_SECRET"],
    },
    failing: new RecordingShell().seed("npx --yes wrangler@4.141.0 pages secret list", {
      status: 1,
      stderr: "✘ [ERROR] You are not logged in\n",
    }),
  },
]);
