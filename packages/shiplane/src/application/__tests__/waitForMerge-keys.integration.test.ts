import { describe, expect, it } from "vitest";

import type { Approval } from "../../domain/releasePr";
import { testContext, testUnit } from "../../testing/releaseContext";
import { waitForMerge } from "../waitForMerge";

// Waiting on a release PR: polled until it merges or closes, with keys to act on it meanwhile.

const PR = { number: 12, url: "https://host.test/acme/repo/pull/12" };

const setUp = ({
  approval,
  interactive = true,
}: { approval?: Approval; interactive?: boolean } = {}) => {
  const world = testContext({ units: [testUnit("api")], approval, interactive });
  const opened: string[] = [];
  world.host.showDiff = () => {
    opened.push("diff");
    return Promise.resolve();
  };
  world.host.openInBrowser = () => {
    opened.push("browser");
    return Promise.resolve();
  };
  return { ...world, opened };
};

describe("Feature: waiting for a release PR to merge, with keys to act on it", () => {
  it("given a solo release, when waiting, then it names the PR, says it carries on by itself and waits for the merge", async () => {
    // given
    const { context, host, output, prompter } = setUp();
    host.seed({ prStates: { 12: ["OPEN", "MERGED"] } });
    const waits: string[] = [];
    Object.assign(prompter, {
      waitForKey: (message: string, ms: number, keys: string[]) => {
        waits.push(`${message} ${ms} ${keys.join("")}`);
        return Promise.resolve(null);
      },
    });

    // when
    const outcome = await waitForMerge(context, PR);

    // then
    expect(outcome).toBe("merged");
    expect(output.lines).toEqual([
      `  ✓ Release PR  ${PR.url}`,
      "    Review and merge it here or on Fake Host; this carries on by itself once merged.",
      "",
      "    d see the diff   m merge it from here   o open it on Fake Host   Ctrl-C leave, continue later",
      "",
    ]);
    expect(waits).toEqual(["Waiting for #12 to merge 15000 dmo"]);
  });

  it("given approval required, when waiting in a terminal, then the wait says it is for an approval and offers no merge key", async () => {
    // given
    const { context, host, prompter } = setUp({ approval: "required" });
    host.seed({ prStates: { 12: ["OPEN", "CLOSED"] } });
    const waits: string[] = [];
    Object.assign(prompter, {
      waitForKey: (message: string, _ms: number, keys: string[]) => {
        waits.push(`${message} ${keys.join("")}`);
        return Promise.resolve(null);
      },
    });

    // when
    const outcome = await waitForMerge(context, PR);

    // then
    expect(outcome).toBe("closed");
    expect(waits).toEqual(["Waiting for #12 to be approved and merged do"]);
  });

  it("given the person presses d then o, when waiting, then the diff and the PR page open in turn", async () => {
    // given
    const { context, host, prompter, opened } = setUp();
    host.seed({ prStates: { 12: ["OPEN", "OPEN", "OPEN", "MERGED"] } });
    prompter.press("d", "o");

    // when
    await waitForMerge(context, PR);

    // then
    expect(opened).toEqual(["diff", "browser"]);
  });

  it("given no terminal and no approval needed, when waiting, then no keys are offered and a pressed key does nothing", async () => {
    // given
    const { context, host, prompter, output, opened } = setUp({ interactive: false });
    host.seed({ prStates: { 12: ["OPEN", "OPEN", "MERGED"] } });
    prompter.press("d");

    // when
    const outcome = await waitForMerge(context, PR);

    // then
    expect(outcome).toBe("merged");
    expect(opened).toEqual([]);
    expect(output.text).not.toContain("see the diff");
  });

  it("given approval required and no terminal, when the PR merged already, then it carries on", async () => {
    // given
    const { context, host } = setUp({ approval: "required", interactive: false });
    host.seed({ prStates: { 12: ["MERGED"] } });

    // when / then
    expect(await waitForMerge(context, PR)).toBe("merged");
  });

  it("given approval required and no terminal, when the PR was closed, then it says closed", async () => {
    // given
    const { context, host } = setUp({ approval: "required", interactive: false });
    host.seed({ prStates: { 12: ["CLOSED"] } });

    // when / then
    expect(await waitForMerge(context, PR)).toBe("closed");
  });

  it("given approval required and no terminal, when the code host cannot be read, then the PR is left for later", async () => {
    // given
    const { context, host } = setUp({ approval: "required", interactive: false });
    host.prState = () => Promise.reject(new Error("offline"));

    // when / then
    expect(await waitForMerge(context, PR)).toBe("left");
  });

  it("given the code host fails once, when waiting, then the wait goes on until the PR merges", async () => {
    // given
    const { context } = setUp();
    let polls = 0;
    context.services.codeHost.prState = () => {
      polls += 1;
      return polls === 1 ? Promise.reject(new Error("offline")) : Promise.resolve("MERGED");
    };

    // when / then
    expect(await waitForMerge(context, PR)).toBe("merged");
    expect(polls).toBe(2);
  });

  it("given a repository that allows no merge method, when the person presses m, then it says to merge on the host", async () => {
    // given
    const { context, host, prompter, output } = setUp();
    host.seed({
      merges: { allowed: [], preselected: "--squash" },
      prStates: { 12: ["OPEN", "MERGED"] },
    });
    prompter.press("m");

    // when
    await waitForMerge(context, PR);

    // then
    expect(output.lines).toContain(
      "✗ No merge method: the repository allows none: merge it on Fake Host.",
    );
    expect(prompter.asked).toEqual([]);
  });

  it("given the person presses m, when they pick no merge method, then it says not merged and nothing merges", async () => {
    // given
    const { context, host, prompter, output } = setUp();
    host.seed({ prStates: { 12: ["OPEN", "MERGED"] } });
    prompter.press("m").answer(null);

    // when
    await waitForMerge(context, PR);

    // then
    expect(output.lines).toContain("  Not merged.");
    expect(prompter.asked).toEqual(["Merge #12 into main?"]);
    expect(host.received).toEqual([]);
  });
});
