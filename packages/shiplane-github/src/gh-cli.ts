import type { Requirement, Shell } from "shiplane/plugin";
import { firstLine, retrying } from "shiplane/plugin";

// Primary and secondary limits both say "rate limit"; 429 is the plain HTTP form.
const RATE_LIMITED = /rate limit|HTTP 429/i;
// Four more tries, waiting twice as long each time.
const RATE_LIMIT_WAITS_MS = [2_000, 4_000, 8_000, 16_000];

/** What every adapter driving gh needs: gh signed in. */
export const GH_REQUIREMENT: Requirement = {
  label: "gh",
  check: { command: "gh", args: ["auth", "status"] },
  fix: { command: "gh", args: ["auth", "login"] },
  // Every GitHub-hosted runner has gh already.
  secrets: ["GH_TOKEN"],
};

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The gh CLI in the repository: `must` throws on a failed call, `json` parses its output. A call
 * GitHub rate limits is retried, waiting twice as long each time.
 */
export const ghCli = ({
  root,
  shell,
  wait = sleep,
}: {
  root: string;
  shell: Shell;
  wait?: (ms: number) => Promise<void>;
}) => {
  const must = async (args: string[], input?: string) => {
    const result = await retrying({
      run: () => shell.capture("gh", args, { cwd: root, input }),
      retryable: ({ status, stderr }) => status !== 0 && RATE_LIMITED.test(stderr),
      delays: RATE_LIMIT_WAITS_MS,
      wait,
    });
    if (result.status === 0) return result.stdout;
    const reason = firstLine(result.stderr);
    throw new Error(
      `gh ${args.slice(0, 2).join(" ")} exited with ${result.status}${reason ? `: ${reason}` : ""}`,
    );
  };
  const json = async (args: string[]): Promise<unknown> => JSON.parse(await must(args));
  return { must, json };
};
