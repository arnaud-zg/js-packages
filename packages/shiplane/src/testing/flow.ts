import type { DeployFlow } from "../domain/environment";

/** The way a test's apps go to their users, when the test is not about it. */
export const TEST_FLOW: DeployFlow = { path: ["preview", "production"], users: "production" };
