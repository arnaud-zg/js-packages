import { describe, expect, it } from "vitest";

import { bumpOf, changesetsFrom } from "../conventional";

describe("the bump a Conventional Commit asks for", () => {
  it("given a breaking commit under 1.0, when its bump is read, then it is a minor", () => {
    expect(bumpOf({ subject: "feat(api)!: drop v1 routes", version: "0.4.0" })).toBe("minor");
    expect(bumpOf({ subject: "feat(api)!: drop v1 routes", version: "1.4.0" })).toBe("major");
  });

  it("given only chores, when the changesets are written, then the latest commit still brings a patch", () => {
    expect(
      changesetsFrom({
        name: "@acme/api",
        version: "1.0.0",
        subjects: ["chore: bump deps (#12)", "chore: tidy"],
      }),
    ).toEqual([
      {
        id: "commits-acme-api-1",
        releases: [{ name: "@acme/api", type: "patch" }],
        summary: "Bump deps.",
      },
    ]);
  });

  it("given a line template and a squash-merged fix, when the changesets are written, then the summary keeps its pull request for changelog-github, without a period", () => {
    expect(
      changesetsFrom({
        name: "@acme/api",
        version: "1.0.0",
        subjects: ["fix(cli): exit 1 on a bad config (#62)", "feat: no pull request"],
        line: true,
      }).map(({ summary }) => summary),
    ).toEqual(["Exit 1 on a bad config\n\npr: #62", "No pull request"]);
  });
});
