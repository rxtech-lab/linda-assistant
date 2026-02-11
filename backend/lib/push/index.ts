import { SignJWT, importPKCS8 } from "jose";
import { db } from "@/lib/db";
import { devices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getApnsToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const keyBase64 = process.env.APNS_KEY_BASE64!;
  const keyId = process.env.APNS_KEY_ID!;
  const teamId = process.env.APNS_TEAM_ID!;

  const keyData = Buffer.from(keyBase64, "base64").toString("utf8");
  const privateKey = await importPKCS8(keyData, "ES256");

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(privateKey);

  cachedToken = { token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return token;
}

export async function sendPushNotification(
  userId: string,
  payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
  },
) {
  if (process.env.IS_E2E) {
    return [];
  }

  const userDevices = await db.select().from(devices).where(eq(devices.userId, userId));

  if (userDevices.length === 0) return;

  const token = await getApnsToken();
  const bundleId = process.env.APNS_BUNDLE_ID!;
  const isProduction = process.env.APNS_ENVIRONMENT === "production";
  const host = isProduction ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";

  const apnsPayload = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      "mutable-content": 1,
    },
    ...payload.data,
  };

  const results = await Promise.allSettled(
    userDevices.map(async (device) => {
      const response = await fetch(`${host}/3/device/${device.deviceToken}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${token}`,
          "apns-topic": bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "content-type": "application/json",
        },
        body: JSON.stringify(apnsPayload),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`APNs error for device ${device.id}:`, error);
      }
    }),
  );

  return results;
}
