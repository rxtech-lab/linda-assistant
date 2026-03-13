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

  // Wait for redirect with authorization code
  await page.waitForURL((url) => url.href.startsWith(redirectUri), {
    timeout: 30_000,
  });

  const callbackUrl = new URL(page.url());
  const code = callbackUrl.searchParams.get("code");
  const returnedState = callbackUrl.searchParams.get("state");

  if (!code) throw new Error("No authorization code in callback URL");
  if (returnedState !== state) throw new Error("State mismatch in callback");

  // Exchange code for tokens
  const tokenResponse = await fetch("https://auth.rxlab.app/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`Token exchange failed (${tokenResponse.status}): ${body}`);
  }

  const tokenData = (await tokenResponse.json()) as any;
  if (!tokenData.access_token) {
    throw new Error("No access_token in token response");
  }

  const token: AuthToken = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    id_token: tokenData.id_token,
    token_type: tokenData.token_type,
    expires_in: tokenData.expires_in,
    obtained_at: new Date().toISOString(),
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
    console.log("Using cached token from auth-token.json");
    return existing;
  }

  return signInAndObtainToken(page);
}
