import fs from "node:fs";
import { TOKEN_FILE, type AuthToken } from "./auth.utils";

const BASE_URL = "http://localhost:3000";

function loadToken(): AuthToken {
	const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as AuthToken;
	if (!data.access_token) throw new Error("No access_token in auth-token.json");
	return data;
}

function authHeaders(token: AuthToken): Record<string, string> {
	return {
		Authorization: `Bearer ${token.access_token}`,
		"Content-Type": "application/json",
	};
}

interface OnboardStatus {
	assignee: { check: boolean; required?: string[] };
	device: { check: boolean };
	overall: boolean;
}

export async function ensureOnboarded(): Promise<void> {
	const token = loadToken();
	const headers = authHeaders(token);

	// Check onboard status
	console.log(`Checking onboard status (${BASE_URL}/api/onboard)...`);
	const res = await fetch(`${BASE_URL}/api/onboard`, { headers });
	const body = (await res.json()) as OnboardStatus;

	if (body.overall) {
		console.log("Already onboarded");
		return;
	}

	// Create assignee if needed
	if (!body.assignee.check) {
		console.log("Creating default assignee...");
		const createRes = await fetch(`${BASE_URL}/api/assignees`, {
			method: "POST",
			headers,
			body: JSON.stringify({
				name: "Linda",
				email: "linda@assistant.rxlab.app",
				model: "openai/gpt-oss-120b",
			}),
		});

		if (!createRes.ok) {
			const err = await createRes.text();
			throw new Error(
				`Failed to create assignee (${createRes.status}): ${err}`,
			);
		}

		console.log("Assignee created");
	}

	// Verify onboard is complete
	const verifyRes = await fetch(`${BASE_URL}/api/onboard`, { headers });
	const verifyBody = (await verifyRes.json()) as OnboardStatus;

	if (!verifyBody.assignee.check) {
		throw new Error("Onboarding still incomplete after creating assignee");
	}

	console.log("Onboarding complete");
}
