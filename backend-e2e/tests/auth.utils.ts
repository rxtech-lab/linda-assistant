import type { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TOKEN_FILE = path.join(__dirname, "..", "auth-token.json");

export interface AuthToken {
	access_token: string;
	refresh_token?: string;
	id_token?: string;
	token_type: string;
	expires_in: number;
	obtained_at: string;
}

function generateCodeVerifier(): string {
	return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
	return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function readExistingToken(): AuthToken | null {
	if (!fs.existsSync(TOKEN_FILE)) return null;

	try {
		const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as AuthToken;
		if (!data.access_token) return null;
		return data;
	} catch {
		return null;
	}
}

function isTokenExpired(token: AuthToken): boolean {
	if (!token.obtained_at || !token.expires_in) return true;
	const obtainedAt = new Date(token.obtained_at).getTime();
	const expiresAt = obtainedAt + token.expires_in * 1000;
	// Consider expired 60s early to avoid edge cases
	return Date.now() > expiresAt - 60_000;
}

async function refreshAccessToken(token: AuthToken): Promise<AuthToken | null> {
	if (!token.refresh_token) return null;

	const clientId = process.env.OAUTH_CLIENT_ID;
	const clientSecret = process.env.OAUTH_CLIENT_SECRET;
	if (!clientId || !clientSecret) return null;

	console.log("Access token expired, attempting refresh...");

	try {
		const response = await fetch("https://auth.rxlab.app/api/oauth/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: token.refresh_token,
				client_id: clientId,
				client_secret: clientSecret,
			}),
		});

		if (!response.ok) {
			console.log(`Refresh failed (${response.status}), will re-authenticate`);
			return null;
		}

		const data = (await response.json()) as any;
		if (!data.access_token) return null;

		const refreshed: AuthToken = {
			access_token: data.access_token,
			refresh_token: data.refresh_token ?? token.refresh_token,
			id_token: data.id_token ?? token.id_token,
			token_type: data.token_type,
			expires_in: data.expires_in,
			obtained_at: new Date().toISOString(),
		};

		fs.writeFileSync(TOKEN_FILE, JSON.stringify(refreshed, null, 2));
		console.log("Token refreshed successfully");
		return refreshed;
	} catch (err) {
		console.log("Refresh request failed:", err);
		return null;
	}
}

async function signInAndObtainToken(page: Page): Promise<AuthToken> {
	const clientId = process.env.OAUTH_CLIENT_ID;
	const clientSecret = process.env.OAUTH_CLIENT_SECRET;
	const testEmail = process.env.TEST_EMAIL;
	const testPassword = process.env.TEST_PASSWORD;

	if (!clientId) throw new Error("OAUTH_CLIENT_ID not set in .env");
	if (!clientSecret) throw new Error("OAUTH_CLIENT_SECRET not set in .env");
	if (!testEmail) throw new Error("TEST_EMAIL not set in .env");
	if (!testPassword) throw new Error("TEST_PASSWORD not set in .env");

	const codeVerifier = generateCodeVerifier();
	const codeChallenge = generateCodeChallenge(codeVerifier);
	const state = crypto.randomBytes(16).toString("hex");
	const redirectUri = "http://localhost:3001/callback";

	const authUrl = new URL("https://auth.rxlab.app/api/oauth/authorize");
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("scope", "openid email profile offline_access");
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("code_challenge", codeChallenge);
	authUrl.searchParams.set("code_challenge_method", "S256");

	// Register flow with callback server before navigating
	await fetch("http://localhost:3001/prepare", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			state,
			codeVerifier,
			clientId,
			clientSecret,
			redirectUri,
		}),
	});

	await page.goto(authUrl.toString());

	// Fill in email
	const emailField = page
		.locator(
			'input[type="email"], input[name="email"], input[placeholder*="email" i]',
		)
		.first();
	await emailField.waitFor({ timeout: 15_000 });
	await emailField.fill(testEmail);

	// Submit email
	const submitOrNext = page
		.locator('button[type="submit"], input[type="submit"]')
		.first();
	await submitOrNext.click();

	// Fill in password
	const passwordField = page.locator('input[type="password"]').first();
	await passwordField.waitFor({ timeout: 10_000 });
	await passwordField.fill(testPassword);

	// Submit sign-in form
	const signInSubmit = page
		.locator('button[type="submit"], input[type="submit"]')
		.first();
	await signInSubmit.click();

	// Wait for browser to be redirected to the callback server
	await page.waitForURL((url) => url.href.startsWith(redirectUri), {
		timeout: 30_000,
	});

	// Poll callback server — it handles code exchange upon receiving the redirect
	let tokenData: any = null;
	for (let attempt = 0; attempt < 20; attempt++) {
		const res = await fetch("http://localhost:3001/token");
		if (res.status === 202) {
			await Bun.sleep(500);
			continue;
		}
		const json = (await res.json()) as any;
		if (!res.ok) throw new Error(json.error ?? "Token fetch failed");
		tokenData = json;
		break;
	}

	if (!tokenData)
		throw new Error("Timed out waiting for token from callback server");
	if (!tokenData.access_token)
		throw new Error("No access_token in token response");

	const token: AuthToken = {
		access_token: tokenData.access_token,
		refresh_token: tokenData.refresh_token,
		id_token: tokenData.id_token,
		token_type: tokenData.token_type,
		expires_in: tokenData.expires_in,
		obtained_at: tokenData.obtained_at,
	};

	fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
	console.log(`Token saved to ${TOKEN_FILE}`);

	return token;
}

/**
 * Returns an auth token — reads from cached file if available,
 * otherwise performs the full OAuth sign-in flow via browser.
 */
export async function getAuthToken(page: Page): Promise<AuthToken> {
	const existing = readExistingToken();
	if (existing) {
		if (!isTokenExpired(existing)) {
			console.log("Using cached token from auth-token.json");
			return existing;
		}

		const refreshed = await refreshAccessToken(existing);
		if (refreshed) return refreshed;

		console.log("Token expired and refresh failed, re-authenticating...");
	}

	return signInAndObtainToken(page);
}
