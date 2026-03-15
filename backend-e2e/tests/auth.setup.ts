import { test as setup, expect } from "@playwright/test";
import { getAuthToken } from "./auth.utils";

setup("obtain oauth token", async ({ page }) => {
	const token = await getAuthToken(page);
	expect(token.access_token).toBeTruthy();
});
