// Every test file starts in an empty temp folder: a command that forgets its cwd, as a mutation
// test's mutant does, fails there instead of running git, a deploy or an install in this repository.
// No variable that points git at a repository is left either: a git hook, such as pre-push running
// the tests, sets GIT_DIR, and a test's `git init --bare` would then turn this repository bare.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)) {
  delete process.env[name];
}

const home = process.cwd();
const sandbox = mkdtempSync(join(tmpdir(), "test-cwd-"));
process.chdir(sandbox);

afterAll(() => {
  process.chdir(home);
  rmSync(sandbox, { recursive: true, force: true });
});
