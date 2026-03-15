import { test, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";

test("onboard creates assignee if needed", async () => {
	await ensureOnboarded();
});
