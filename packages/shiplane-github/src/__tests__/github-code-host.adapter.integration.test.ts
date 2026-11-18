import { describe, expect, it } from "vitest";

import { gitHubCodeHost } from "../github-code-host.adapter";
import { fakeGh } from "./gh.fake";

const ROOT = "/repo";
const PR = { number: 42, url: "https://github.com/acme/app/pull/42", head: "abc" };

const hostOn = (gh: ReturnType<typeof fakeGh>) =>
  gitHubCodeHost().create({ root: ROOT, shell: gh.shell });

const graphqlQuery = (args: readonly string[]) =>
  args.find((arg) => arg.startsWith("query="))?.slice("query=".length) ?? "";

describe("checking GitHub is ready before a release", () => {
  it("given a project releasing through GitHub, when doctor runs, then it names github and asks for gh to be signed in, saying how", () => {
    const adapter = gitHubCodeHost();

    expect(adapter.name).toBe("github");
    expect(adapter.requirements?.()).toEqual([
      {
        label: "gh",
        check: { command: "gh", args: ["auth", "status"] },
        fix: { command: "gh", args: ["auth", "login"] },
        secrets: ["GH_TOKEN"],
      },
    ]);
  });
});

describe("finding the release pull request already open", () => {
  it("given open PRs on several branches, when the release PRs are read, then only those on the prefix come back, lowest number first", async () => {
    const gh = fakeGh().seed(
      "pr list",
      JSON.stringify([
        { number: 9, url: "u9", headRefName: "shiplane/release-b", headRefOid: "s9" },
        { number: 3, url: "u3", headRefName: "feat/shiplane/release", headRefOid: "s3" },
        { number: 5, url: "u5", headRefName: "shiplane/release-a", headRefOid: "s5" },
      ]),
    );

    const prs = await hostOn(gh).openPrsFrom("shiplane/release");

    expect(prs).toEqual([
      { number: 5, url: "u5", head: "s5" },
      { number: 9, url: "u9", head: "s9" },
    ]);
    expect(gh.calls).toEqual([
      {
        how: "capture",
        command: "gh",
        args: [
          "pr",
          "list",
          "--state",
          "open",
          "--limit",
          "100",
          "--json",
          "number,url,headRefName,headRefOid",
        ],
        cwd: ROOT,
        input: undefined,
      },
    ]);
  });

  it("given a release PR someone merged, when shiplane checks on it, then it sees it merged", async () => {
    const gh = fakeGh().seed("pr view 42", '{"state":"MERGED"}');

    await expect(hostOn(gh).prState(PR)).resolves.toBe("MERGED");
    expect(gh.args).toEqual([["pr", "view", "42", "--json", "state"]]);
  });

  it("given a branch, when shiplane looks for its PR, then gh is asked for the one open PR from that branch", async () => {
    const gh = fakeGh().seed("pr list", "[]");

    await hostOn(gh).prForBranch("feat/x");

    expect(gh.args).toEqual([
      [
        "pr",
        "list",
        "--head",
        "feat/x",
        "--state",
        "open",
        "--limit",
        "1",
        "--json",
        "number,url,headRefOid",
      ],
    ]);
  });
});

describe("opening and closing the release pull request", () => {
  it("given a release ready to propose, when its PR opens, then gh makes the label, opens the PR with its title, body and label, and hands back its number, link and head", async () => {
    const gh = fakeGh().seed(
      "pr view",
      '{"number":24,"url":"https://github.com/acme/app/pull/24","headRefOid":"abc123"}',
    );

    const pr = await hostOn(gh).createPr({
      base: "main",
      head: "shiplane/release-x",
      title: "Release x",
      body: "Notes",
      label: "type: chore",
    });

    expect(pr).toEqual({ number: 24, url: "https://github.com/acme/app/pull/24", head: "abc123" });
    expect(gh.args).toEqual([
      ["label", "create", "type: chore", "--color", "ededed"],
      [
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        "shiplane/release-x",
        "--title",
        "Release x",
        "--body",
        "Notes",
        "--label",
        "type: chore",
      ],
      ["pr", "view", "shiplane/release-x", "--json", "number,url,headRefOid"],
    ]);
  });

  it("given GitHub refuses the label, when the release PR opens, then it fails saying why and no PR is opened", async () => {
    const gh = fakeGh().seed("label create", { status: 1, stderr: "HTTP 403: Forbidden" });

    await expect(
      hostOn(gh).createPr({ base: "main", head: "h", title: "t", body: "b", label: "l" }),
    ).rejects.toThrow("gh label create exited with 1: HTTP 403: Forbidden");
    expect(gh.args).toHaveLength(1);
  });

  it("given a stale release PR, when it is closed, then gh closes it leaving the comment that says why", async () => {
    const gh = fakeGh();

    await hostOn(gh).closePr(PR, "Superseded by #43");

    expect(gh.args).toEqual([["pr", "close", "42", "--comment", "Superseded by #43"]]);
  });
});

describe("merging a pull request the way GitHub's button would", () => {
  const repository = (overrides: Record<string, unknown>) =>
    JSON.stringify({
      data: {
        repository: {
          mergeCommitAllowed: true,
          squashMergeAllowed: true,
          rebaseMergeAllowed: true,
          viewerDefaultMergeMethod: "MERGE",
          ...overrides,
        },
      },
    });

  it("given a repository allowing squash and rebase, when the methods are read, then those two are offered and the viewer's default is preselected", async () => {
    const gh = fakeGh().seed(
      "api graphql",
      repository({ mergeCommitAllowed: false, viewerDefaultMergeMethod: "REBASE" }),
    );

    await expect(hostOn(gh).mergeMethods()).resolves.toEqual({
      allowed: ["--squash", "--rebase"],
      preselected: "--rebase",
    });
    const [args = []] = gh.args;
    expect(args.slice(0, 6)).toEqual([
      "api",
      "graphql",
      "-F",
      "owner={owner}",
      "-F",
      "name={repo}",
    ]);
    expect(args[6]).toBe("-f");
    expect(graphqlQuery(args)).toContain(
      "mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed viewerDefaultMergeMethod",
    );
  });

  it("given a repository allowing only merge commits, when the methods are read, then merge is the one offered", async () => {
    const gh = fakeGh().seed(
      "api graphql",
      repository({
        squashMergeAllowed: false,
        rebaseMergeAllowed: false,
        viewerDefaultMergeMethod: "SQUASH",
      }),
    );

    await expect(hostOn(gh).mergeMethods()).resolves.toEqual({
      allowed: ["--merge"],
      preselected: "--squash",
    });
  });

  it("given a PR and a method, when it merges, then gh merges it in the person's terminal", async () => {
    const gh = fakeGh();

    await hostOn(gh).merge(PR, "--squash");

    expect(gh.calls).toEqual([
      {
        how: "attach",
        command: "gh",
        args: ["pr", "merge", "42", "--squash"],
        cwd: ROOT,
        input: undefined,
      },
    ]);
  });

  it("given a PR, when its diff is shown, then gh prints it in the person's terminal", async () => {
    const gh = fakeGh();

    await hostOn(gh).showDiff(PR);

    expect(gh.calls).toEqual([
      { how: "attach", command: "gh", args: ["pr", "diff", "42"], cwd: ROOT, input: undefined },
    ]);
  });

  it("given a PR, when it is opened in the browser, then gh opens its web page", async () => {
    const gh = fakeGh();

    await hostOn(gh).openInBrowser(PR);

    expect(gh.calls).toEqual([
      {
        how: "capture",
        command: "gh",
        args: ["pr", "view", "42", "--web"],
        cwd: ROOT,
        input: undefined,
      },
    ]);
  });
});

describe("publishing GitHub Releases for shipped tags", () => {
  it("given published releases, when the released tags are read, then each tag comes back once", async () => {
    const gh = fakeGh().seed(
      "release list",
      '[{"tagName":"api@1.0.0"},{"tagName":"web@2.0.0"},{"tagName":"api@1.0.0"}]',
    );

    const tags = await hostOn(gh).releasedTags();

    expect([...tags]).toEqual(["api@1.0.0", "web@2.0.0"]);
    expect(gh.args).toEqual([["release", "list", "--limit", "200", "--json", "tagName"]]);
  });

  it("given a release that is not the latest, when it is published, then gh verifies the tag and leaves the latest badge alone", async () => {
    const gh = fakeGh().seed("repo view", '{"url":"https://github.com/acme/app"}');

    await hostOn(gh).createRelease("api@1.0.1", "- A fix", false, "api@1.0.0");

    expect(gh.args).toEqual([
      ["repo", "view", "--json", "url"],
      [
        "release",
        "create",
        "api@1.0.1",
        "--verify-tag",
        "--title",
        "api@1.0.1",
        "--notes",
        "- A fix\n\n**Full Changelog**: https://github.com/acme/app/compare/api@1.0.0...api@1.0.1",
        "--latest=false",
      ],
    ]);
  });

  it("given the latest release, when it is published, then gh lets GitHub mark it latest", async () => {
    const gh = fakeGh();

    await hostOn(gh).createRelease("api@1.0.0", "- First", true);

    expect(gh.args).toEqual([
      [
        "release",
        "create",
        "api@1.0.0",
        "--verify-tag",
        "--title",
        "api@1.0.0",
        "--notes",
        "- First",
      ],
    ]);
  });
});

describe("knowing what GitHub Deployments already shipped", () => {
  it("given deployments of every kind, when they are read, then only finished preview and production ones become deploys", async () => {
    const gh = fakeGh().seed(
      "api graphql",
      JSON.stringify({
        data: {
          repository: {
            deployments: {
              nodes: [
                { environment: "preview", state: "SUCCESS", ref: { name: "api@1.0.0" } },
                { environment: "production", state: "IN_PROGRESS", ref: { name: "api@1.0.0" } },
                { environment: "staging", state: "SUCCESS", ref: { name: "api@1.0.0" } },
                { environment: "preview", state: null, ref: { name: "web@1.0.0" } },
                { environment: "preview", state: "SUCCESS", ref: null },
                { environment: "production", state: "FAILURE", ref: { name: "web@1.0.0" } },
              ],
            },
          },
        },
      }),
    );

    await expect(hostOn(gh).deployments()).resolves.toEqual([
      { title: "Deploy api@1.0.0 to preview", state: "done" },
      { title: "Deploy api@1.0.0 to production", state: "running" },
      { title: "Deploy web@1.0.0 to production", state: "none" },
    ]);
    const [args = []] = gh.args;
    expect(args.slice(0, 7)).toEqual([
      "api",
      "graphql",
      "-F",
      "owner={owner}",
      "-F",
      "name={repo}",
      "-f",
    ]);
    expect(graphqlQuery(args)).toContain('deployments(environments: ["preview", "production"]');
  });

  it("given a shipped ref, when its deployment is recorded, then a deployment is created and marked successful", async () => {
    const gh = fakeGh().seed("api repos/{owner}/{repo}/deployments --method", '{"id":77}');

    await hostOn(gh).recordDeployment("api@1.0.0", "production");

    expect(gh.calls.map(({ args, input }) => ({ args, input }))).toEqual([
      {
        args: ["api", "repos/{owner}/{repo}/deployments", "--method", "POST", "--input", "-"],
        input: JSON.stringify({
          ref: "api@1.0.0",
          environment: "production",
          auto_merge: false,
          required_contexts: [],
        }),
      },
      {
        args: [
          "api",
          "repos/{owner}/{repo}/deployments/77/statuses",
          "--method",
          "POST",
          "-f",
          "state=success",
        ],
        input: undefined,
      },
    ]);
  });
});

describe("reading what shipped pull requests link to", () => {
  const linkedPr = (number: number, url: string) => ({
    number,
    url,
    body: `body ${number}`,
    closingIssuesReferences: {
      nodes: [{ number: 7, repository: { name: "lib", owner: { login: "other" } } }],
    },
  });

  it("given several shipped PRs, when they are read, then one GitHub query fetches them all, each with its repository and the issues it closes", async () => {
    const gh = fakeGh().seed(
      "api graphql",
      JSON.stringify({
        data: {
          repository: {
            a0: linkedPr(12, "https://github.com/acme/app/pull/12"),
            a1: linkedPr(15, "https://github.com/acme/app/pull/15"),
          },
        },
      }),
    );

    const prs = await hostOn(gh).pullRequests([12, 15]);

    expect(prs).toEqual([
      {
        repository: "acme/app",
        number: 12,
        body: "body 12",
        closes: [{ repository: "other/lib", number: 7 }],
      },
      {
        repository: "acme/app",
        number: 15,
        body: "body 15",
        closes: [{ repository: "other/lib", number: 7 }],
      },
    ]);
    const [args = []] = gh.args;
    expect(args.slice(0, 7)).toEqual([
      "api",
      "graphql",
      "-F",
      "owner={owner}",
      "-F",
      "name={repo}",
      "-f",
    ]);
    const query = graphqlQuery(args);
    expect(query).toMatch(
      /^query\(\$owner: String!, \$name: String!\) \{ repository\(owner: \$owner, name: \$name\) \{ a0: pullRequest\(number: 12\) \{ number url body closingIssuesReferences\(first: 20\) .* a1: pullRequest\(number: 15\) \{ .* \} \}$/,
    );
  });

  it("given a shipped PR GitHub does not know, when it is read, then it fails naming that PR", async () => {
    const gh = fakeGh().seed(
      "api graphql",
      JSON.stringify({
        data: { repository: { a0: linkedPr(12, "https://github.com/acme/app/pull/12"), a1: null } },
      }),
    );

    await expect(hostOn(gh).pullRequests([12, 99])).rejects.toThrow("no pull request #99");
  });

  it("given issues and PRs across repositories, when their comments are read, then one GitHub query asks each repository and one that is gone has no comments", async () => {
    const gh = fakeGh().seed(
      "api graphql",
      JSON.stringify({
        data: {
          a0: { issueOrPullRequest: { comments: { nodes: [{ body: "one" }, { body: "two" }] } } },
          a1: { issueOrPullRequest: null },
        },
      }),
    );

    const comments = await hostOn(gh).comments([
      { repository: "acme/app", number: 12 },
      { repository: "other/lib", number: 7 },
    ]);

    expect(comments).toEqual([["one", "two"], []]);
    const [args = []] = gh.args;
    expect(args.slice(0, 3)).toEqual(["api", "graphql", "-f"]);
    const query = graphqlQuery(args);
    expect(query.startsWith('query { a0: repository(owner: "acme", name: "app") ')).toBe(true);
    expect(query).toContain(
      "{ issueOrPullRequest(number: 12) { ... on Issue { comments(last: 100) { nodes { body } } } ... on PullRequest { comments(last: 100) { nodes { body } } } } }",
    );
    expect(query).toContain(' a1: repository(owner: "other", name: "lib") ');
    expect(query.endsWith("} } } }")).toBe(true);
  });

  it("given an issue whose repository has no owner, when its comments are read, then GitHub is asked anyway instead of the release failing", async () => {
    const gh = fakeGh().seed("api graphql", '{"data":{"a0":{"issueOrPullRequest":null}}}');

    await hostOn(gh).comments([{ repository: "", number: 1 }]);

    expect(graphqlQuery(gh.args[0] ?? [])).toContain('a0: repository(owner: "", name: "")');
  });
});

describe("commenting on pull requests and issues", () => {
  it("given a PR with many comments, when shiplane updates its own comment there, then it reads every page to find it", async () => {
    const gh = fakeGh();

    await hostOn(gh).upsertComment({ on: PR, marker: "<!-- m -->", body: "b" });

    expect(gh.args[0]).toEqual([
      "api",
      "repos/{owner}/{repo}/issues/42/comments",
      "--paginate",
      "--jq",
      ".[] | {id, body}",
    ]);
  });

  it("given an issue in another repository, when a release comment is posted, then it goes to that repository's issue", async () => {
    const gh = fakeGh();

    await hostOn(gh).comment({ repository: "other/lib", number: 7 }, "Released");

    expect(gh.calls).toEqual([
      {
        how: "capture",
        command: "gh",
        args: ["api", "-X", "POST", "repos/other/lib/issues/7/comments", "-f", "body=Released"],
        cwd: ROOT,
        input: undefined,
      },
    ]);
  });
});
