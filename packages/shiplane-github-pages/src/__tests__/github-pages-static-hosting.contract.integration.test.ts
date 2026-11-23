import { staticHostingContract } from "shiplane/testing";

import { githubPagesStaticHosting } from "../github-pages-static-hosting.adapter";

staticHostingContract([
  { adapter: githubPagesStaticHosting(), settings: { url: "https://acme.github.io/site/" } },
]);
