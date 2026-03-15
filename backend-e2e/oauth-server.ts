const PORT = 3001;

interface PendingFlow {
	state: string;
	codeVerifier: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}

interface TokenResult {
	access_token: string;
	refresh_token?: string;
	id_token?: string;
	token_type: string;
	expires_in: number;
	obtained_at: string;
}

let pendingFlow: PendingFlow | null = null;
let tokenResult: TokenResult | null = null;
let tokenError: string | null = null;

Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);

		if (url.pathname === "/prepare" && req.method === "POST") {
			const body = (await req.json()) as PendingFlow;
			pendingFlow = body;
			tokenResult = null;
			tokenError = null;
			return Response.json({ ok: true });
		}

		if (url.pathname === "/callback" && req.method === "GET") {
			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");

			if (!pendingFlow) {
				tokenError = "No pending flow registered";
				return new Response("No pending flow", { status: 400 });
			}

			if (!code) {
				tokenError = "No authorization code in callback";
				return new Response("No authorization code", { status: 400 });
			}

			if (state !== pendingFlow.state) {
				tokenError = `State mismatch: expected ${pendingFlow.state}, got ${state}`;
				return new Response("State mismatch", { status: 400 });
			}

			try {
				const tokenResponse = await fetch(
					"https://auth.rxlab.app/api/oauth/token",
					{
						method: "POST",
						headers: { "Content-Type": "application/x-www-form-urlencoded" },
						body: new URLSearchParams({
							grant_type: "authorization_code",
							code,
							redirect_uri: pendingFlow.redirectUri,
							client_id: pendingFlow.clientId,
							client_secret: pendingFlow.clientSecret,
							code_verifier: pendingFlow.codeVerifier,
						}),
					},
				);

				if (!tokenResponse.ok) {
					const errBody = await tokenResponse.text();
					tokenError = `Token exchange failed (${tokenResponse.status}): ${errBody}`;
					return new Response(tokenError, { status: 502 });
				}

				const data = (await tokenResponse.json()) as any;
				tokenResult = {
					access_token: data.access_token,
					refresh_token: data.refresh_token,
					id_token: data.id_token,
					token_type: data.token_type,
					expires_in: data.expires_in,
					obtained_at: new Date().toISOString(),
				};

				return new Response(
					"<html><body><h1>Authentication successful!</h1><p>You can close this tab.</p></body></html>",
					{ headers: { "Content-Type": "text/html" } },
				);
			} catch (err) {
				tokenError = `Callback error: ${err}`;
				return new Response("Internal server error", { status: 500 });
			}
		}

		if (url.pathname === "/health" && req.method === "GET") {
			return Response.json({ ok: true });
		}

		if (url.pathname === "/token" && req.method === "GET") {
			if (tokenError) {
				return Response.json({ error: tokenError }, { status: 400 });
			}
			if (!tokenResult) {
				return Response.json({ pending: true }, { status: 202 });
			}
			return Response.json(tokenResult);
		}

		return new Response("Not found", { status: 404 });
	},
});

console.log(`OAuth callback server listening on http://localhost:${PORT}`);
