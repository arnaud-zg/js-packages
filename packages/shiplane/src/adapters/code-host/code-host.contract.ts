import { describe, expect, it } from "vitest";

import type { IssueRef } from "../../domain/issues";
import type { CodeHostPort } from "../../ports/code-host.port";

/** A repository on a code host, and the ways a test arranges it beyond the port. */
export interface CodeHostSubject {
  port: CodeHostPort;
  /** A branch the host can open a pull request from, pushed with one commit on it. */
  branch: (name: string) => Promise<string>;
  /** A tag the host can publish release notes for. */
  tag: () => Promise<string>;
  /** An issue or pull request comments can go on. */
  issue: IssueRef;
}

/** What every code host does, whatever its provider. */
export const codeHostContract = (name: string, subject: () => Promise<CodeHostSubject>) =>
  describe(`${name}, as a code host`, () => {
    it("given a pull request opened, when the open ones are read, then it is there and open", async () => {
      const { port, branch } = await subject();
      const head = await branch("release/contract-open");

      const pr = await port.createPr({
        base: "main",
        head,
        title: "chore: contract",
        body: "Opened by the contract suite.",
        label: "release",
      });

      expect(pr.head).toEqual(expect.any(String));
      expect(await port.openPrsFrom("release/contract-open")).toContainEqual(pr);
      expect(await port.prState(pr)).toBe("OPEN");
    });

    it("given a pull request closed, when the open ones are read, then it is gone and closed", async () => {
      const { port, branch } = await subject();
      const head = await branch("release/contract-close");
      const pr = await port.createPr({
        base: "main",
        head,
        title: "chore: contract",
        body: "Opened by the contract suite.",
        label: "release",
      });

      await port.closePr(pr, "Closed by the contract suite.");

      expect(await port.openPrsFrom("release/contract-close")).not.toContainEqual(pr);
      expect(await port.prState(pr)).toBe("CLOSED");
    });

    it("given a branch with an open pull request, when its pull request is read, then it is that one; another branch has none", async () => {
      const { port, branch } = await subject();
      const head = await branch("release/contract-for-branch");
      const pr = await port.createPr({
        base: "main",
        head,
        title: "chore: contract",
        body: "Opened by the contract suite.",
        label: "release",
      });

      expect(await port.prForBranch(head)).toMatchObject({ number: pr.number, url: pr.url });
      expect(await port.prForBranch(`${head}-none`)).toBeNull();
    });

    it("given a comment upserted twice with one marker, when the comments are read, then there is one, holding the second body", async () => {
      const { port, branch } = await subject();
      const head = await branch("release/contract-upsert");
      const pr = await port.createPr({
        base: "main",
        head,
        title: "chore: contract",
        body: "Opened by the contract suite.",
        label: "release",
      });
      const marker = `<!-- contract:${Date.now()} -->`;
      const ref = {
        repository: new URL(pr.url).pathname.split("/").slice(1, 3).join("/"),
        number: pr.number,
      };

      await port.upsertComment({ on: pr, marker, body: `${marker}\nfirst` });
      await port.upsertComment({ on: pr, marker, body: `${marker}\nsecond` });

      const marked = (await port.comments([ref])).flat().filter((body) => body.includes(marker));
      expect(marked).toEqual([`${marker}\nsecond`]);
    });

    it("given release notes published for a tag, when the released tags are read, then it is among them", async () => {
      const { port, tag } = await subject();
      const name = await tag();

      await port.createRelease(name, "Published by the contract suite.", false);

      expect(await port.releasedTags()).toContain(name);
    });

    it("given release notes published with the tag before, when the released tags are read, then it is among them", async () => {
      const { port, tag } = await subject();
      const before = await tag();
      const name = await tag();

      await port.createRelease(name, "Published by the contract suite.", false, before);

      expect(await port.releasedTags()).toContain(name);
    });

    it("given a deploy recorded, when the deploys are read, then it is there and done", async () => {
      const { port, tag } = await subject();
      const name = await tag();

      await port.recordDeployment(name, "preview");

      expect(await port.deployments()).toContainEqual({
        title: `Deploy ${name} to preview`,
        state: "done",
      });
    });

    it("given a comment posted, when the comments are read, then it is among them", async () => {
      const { port, issue } = await subject();
      const body = `Posted by the contract suite at ${new Date().toISOString()}.`;

      await port.comment(issue, body);

      expect((await port.comments([issue])).flat()).toContain(body);
    });
  });
