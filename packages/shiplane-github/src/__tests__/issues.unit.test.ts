import { describe, expect, it } from "vitest";

import { pullRequestNumbers, relatedIssues, releaseComment } from "../issues";

const REPO = "acme/app";
const pr = (body: string, closes: { repository: string; number: number }[] = []) => ({
  repository: REPO,
  number: 10,
  body,
  closes,
});

describe("the pull requests a release holds", () => {
  it("given squash-merged commits, when a release finds its PRs, then only a trailing (#n) counts, once each, and the release PR itself is left out", () => {
    expect(
      pullRequestNumbers([
        "feat: plants (#12)",
        "fix: yard (#12)",
        "fix: trailing space (#13)  ",
        "docs: mentions (#14) in the middle",
        "chore: direct push",
        "chore(expo): release v0.4.2 (#15)",
      ]),
    ).toEqual([12, 13]);
  });
});

describe("the issues a pull request relates to", () => {
  it("given a PR without a ticket line, when a release finds its issues, then they are what GitHub says it closes", () => {
    expect(relatedIssues(pr("No template here.", [{ repository: REPO, number: 3 }]))).toEqual([
      { repository: REPO, number: 3 },
    ]);
  });

  it("given a ticket line without spaces, when a release finds its issues, then the ticket's issue counts", () => {
    expect(relatedIssues(pr("<!--Ticket:#21-->"))).toEqual([{ repository: REPO, number: 21 }]);
  });

  it("given a bare issue after some spaces, when a release finds its issues, then it is an issue of the PR's repository", () => {
    expect(relatedIssues(pr("<!-- Ticket:   #1600 -->"))).toEqual([
      { repository: REPO, number: 1600 },
    ]);
  });

  it("given a ticket naming an issue in another repository, when a release finds its issues, then it keeps that repository", () => {
    expect(relatedIssues(pr("<!-- Ticket: other/lib#5 -->"))).toEqual([
      { repository: "other/lib", number: 5 },
    ]);
  });

  it("given the same issue closed and named in the ticket, when a release finds its issues, then it comes back once", () => {
    expect(
      relatedIssues(pr(`<!-- Ticket: ${REPO}#3 -->`, [{ repository: REPO, number: 3 }])),
    ).toEqual([{ repository: REPO, number: 3 }]);
  });

  it("given the same number in two repositories, when a release finds its issues, then both come back", () => {
    expect(
      relatedIssues(pr("<!-- Ticket: other/lib#3 -->", [{ repository: REPO, number: 3 }])),
    ).toEqual([
      { repository: REPO, number: 3 },
      { repository: "other/lib", number: 3 },
    ]);
  });
});

describe("the comment a shipped PR or issue reads", () => {
  it("given an issue whose PR lives in another repository, when it hears of the release, then the PR is named with its repository", () => {
    expect(
      releaseComment({
        about: { repository: REPO, number: 1 },
        releases: [{ unit: "api", version: "1.0.0", tag: "api@1.0.0" }],
        environment: "prod",
        mention: { kind: "pr", refs: [{ repository: "other/lib", number: 9 }] },
      }),
    ).toBe(
      "🚀 Released to **prod** in version **1.0.0** (api, PR other/lib#9).\n\n<!-- shiplane-release: api@1.0.0 prod -->",
    );
  });

  it("given three units shipped together, when the comment names them, then it reads as a list ending in and", () => {
    expect(
      releaseComment({
        about: { repository: REPO, number: 1 },
        releases: [
          { unit: "api", version: "1.0.0", tag: "api@1.0.0" },
          { unit: "web", version: "2.0.0", tag: "web@2.0.0" },
          { unit: "expo", version: "3.0.0", tag: "expo@3.0.0" },
        ],
        environment: "staging",
        mention: { kind: "issue", refs: [] },
      }).split("\n")[0],
    ).toBe(
      "🚀 Released to **staging** in versions **1.0.0** (api), **2.0.0** (web) and **3.0.0** (expo).",
    );
  });
});
