import http2 from "node:http2";
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

function sendHttp2Request(
  host: string,
  path: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(host);

    client.on("error", (err) => {
      client.close();
      reject(err);
    });

    const req = client.request({
      ":method": "POST",
      ":path": path,
      ...headers,
    });

    let responseData = "";
    let statusCode = 0;

    req.on("response", (hdrs) => {
      statusCode = hdrs[":status"] ?? 0;
    });

    req.on("data", (chunk: Buffer) => {
      responseData += chunk.toString();
    });

    req.on("end", () => {
      client.close();
      resolve({ status: statusCode, body: responseData });
    });

    req.on("error", (err) => {
      client.close();
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

export async function sendPushNotification(
  userId: string,
  payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
  },
) {
  const log = (msg: string) => console.log(`[push] ${msg}`);

  if (process.env.IS_E2E) {
    log("skipped (E2E mode)");
    return [];
  }

  const userDevices = await db.select().from(devices).where(eq(devices.userId, userId));

  log(
    `userId=${userId} devices=${userDevices.length} title="${payload.title}" type=${payload.data?.type ?? "unknown"}`,
  );

  if (userDevices.length === 0) {
    log("no registered devices, skipping");
    return;
  }

  const token = await getApnsToken();
  const bundleId = process.env.APNS_BUNDLE_ID!;
  const isProduction = process.env.APNS_ENVIRONMENT === "production";
  const host = isProduction ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";

  log(`env=${isProduction ? "production" : "sandbox"} bundleId=${bundleId}`);

  const apnsPayload = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      "mutable-content": 1,
    },
    ...payload.data,
  });

  const results = await Promise.allSettled(
    userDevices.map(async (device) => {
      const path = `/3/device/${device.deviceToken}`;
      log(`sending to device=${device.id} token=${device.deviceToken.slice(0, 8)}...`);

      const response = await sendHttp2Request(
        host,
        path,
        {
          authorization: `bearer ${token}`,
          "apns-topic": bundleId,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "content-type": "application/json",
        },
        apnsPayload,
      );

      if (response.status === 200) {
        log(`device=${device.id} status=${response.status} ✓`);
      } else {
        console.error(
          `[push] device=${device.id} status=${response.status} error: ${response.body}`,
        );
        if (
          response.status === 410 ||
          (response.status === 400 && response.body.includes("BadDeviceToken"))
        ) {
          await db.delete(devices).where(eq(devices.id, device.id));
          log(
            `device=${device.id} token=${device.deviceToken.slice(0, 8)}... removed (${response.status === 410 ? "unregistered" : "bad token"})`,
          );
        }
      }
    }),
  );

  for (const r of results) {
    if (r.status === "rejected") {
      console.error("[push] promise rejected:", r.reason);
    }
  }
  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected").length;
  log(`done: ${fulfilled} sent, ${rejected} failed`);

  return results;
}
