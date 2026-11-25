import { describe, expect, it } from "vitest";

import type { Feature, FollowUp, Shipped } from "../../modules/module";
import { testContext, testUnit } from "../../testing/releaseContext";
import { planFollowUps, runFollowUps } from "../followUps";

// What features do once units ship, over a release of Fakes. Each feature here records what ran.

const feature = (name: string, afterShip: Feature["afterShip"]): Feature => ({
  type: "feature",
  name,
  adapters: [],
  afterShip,
});

const SHIPPED: Shipped[] = [{ unit: testUnit("api"), tag: "api@1.0.0", environment: "production" }];

const given = () => {
  const ran: string[] = [];
  const seen: (readonly Shipped[])[] = [];
  const step = (label: string, fails?: unknown): FollowUp => ({
    label,
    run: () => {
      ran.push(label);
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a feature may throw anything
      return fails === undefined ? Promise.resolve() : Promise.reject(fails);
    },
  });
  const features = [
    feature("release-comments", (_context, shipped) => {
      seen.push(shipped);
      return Promise.resolve([step("comment on #12"), step("label #12", new Error("forbidden"))]);
    }),
    feature("chat", () => Promise.reject(new Error("no token"))),
    feature("pager", () => Promise.resolve([step("page on-call", "timed out")])),
  ];
  const release = testContext({ units: [testUnit("api")], features });
  return { ...release, ran, seen };
};

describe("Feature: commenting, labelling and paging once apps ship", () => {
  it("given features with follow-ups, when apps ship, then each follow-up runs in order and a failure is shown without stopping the rest", async () => {
    const { context, output, ran, seen } = given();

    await runFollowUps(context, SHIPPED);

    expect(seen).toEqual([SHIPPED]);
    expect(ran).toEqual(["comment on #12", "label #12", "page on-call"]);
    expect(output.lines).toEqual([
      "  ! chat  could not read: no token",
      "  ✓ comment on #12",
      "  ! label #12  forbidden",
      "  ! page on-call  timed out",
    ]);
  });

  it("given features with follow-ups, when apps ship, then the person sees which feature is being read while it is read", async () => {
    const { context, progress } = given();

    await runFollowUps(context, SHIPPED);

    expect(progress.events).toEqual([
      { kind: "during", mood: "thinking", text: "release-comments: reading what to follow up" },
      { kind: "during", mood: "thinking", text: "chat: reading what to follow up" },
      { kind: "during", mood: "thinking", text: "pager: reading what to follow up" },
    ]);
  });

  it("given nothing shipped, when the release ends, then no follow-up runs and nothing is shown", async () => {
    const { context, output, ran, seen } = given();

    await runFollowUps(context, []);

    expect(seen).toEqual([]);
    expect(ran).toEqual([]);
    expect(output.lines).toEqual([]);
  });

  it("given features with follow-ups, when the person dry-runs a ship, then the follow-ups are listed and none runs", async () => {
    const { context, output, ran } = given();

    await planFollowUps(context, SHIPPED);

    expect(ran).toEqual([]);
    expect(output.lines).toEqual([
      "  ! chat  could not read: no token",
      "",
      "  Then  once shipped",
      "    comment on #12",
      "    label #12",
      "    page on-call",
    ]);
  });

  it("given nothing to ship, when the person dry-runs a ship, then no follow-up section is shown", async () => {
    const { context, output } = given();

    await planFollowUps(context, []);

    expect(output.lines).toEqual([]);
  });
});
