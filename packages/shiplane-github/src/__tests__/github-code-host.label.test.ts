import { RecordingShell } from "shiplane/testing";
import { expect, it } from "vitest";

import { githubHost } from "../github-code-host.adapter";

it("given GitHub, when a person reads about it, then it says its name and the gh command that closes a pull request", () => {
  const host = githubHost("/repo", new RecordingShell());

  expect(host.label).toBe("GitHub");
  expect(
    host.closeLine?.({ number: 7, url: "https://github.com/acme/repo/pull/7", head: "sha" }),
  ).toBe("gh pr close 7");
});
