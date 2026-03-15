/**
 * Refresh OAuth access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
} | null> {
  if (!refreshToken || process.env.IS_E2E) {
    return null;
  }

  try {
    const response = await fetch("https://auth.rxlab.app/api/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.OAUTH_CLIENT_ID,
        client_secret: process.env.OAUTH_CLIENT_SECRET,
      }),
    });

    if (!response.ok) {
      console.warn("[refreshAccessToken] Failed to refresh token:", response.status);
      return null;
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken, // Use new refresh token if provided, else keep existing
    };
  } catch (error) {
    console.error("[refreshAccessToken] Error refreshing token:", error);
    return null;
  }
}
