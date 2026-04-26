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

export type LiveActivityEvent = "start" | "update" | "end";

export type LiveActivityContentState = {
  status: "starting" | "inProgress" | "waitingConfirmation" | "completed" | "failed";
  currentStep?: string | null;
  updatedAt: number;
};

export type LiveActivityAttributes = {
  taskId: string;
  taskTitle: string;
  assigneeName?: string | null;
};

const LIVE_ACTIVITY_ATTRIBUTES_TYPE = "LindaTaskAttributes";

/**
 * Send an APNs Live Activity push (start / update / end). The token is either a
 * push-to-start token (for `event: "start"` with no per-activity token yet) or
 * a per-activity token returned by `Activity.pushTokenUpdates` on iOS.
 */
export async function sendLiveActivityPush(args: {
  token: string;
  event: LiveActivityEvent;
  contentState: LiveActivityContentState;
  attributes?: LiveActivityAttributes;
  dismissalDate?: number; // unix seconds
  staleDate?: number; // unix seconds
}) {
  const log = (msg: string) => console.log(`[push:liveactivity] ${msg}`);

  if (process.env.IS_E2E) {
    log("skipped (E2E mode)");
    return { status: 0, body: "skipped" };
  }

  const apnsToken = await getApnsToken();
  const bundleId = process.env.APNS_BUNDLE_ID!;
  const isProduction = process.env.APNS_ENVIRONMENT === "production";
  const host = isProduction ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";

  const aps: Record<string, unknown> = {
    timestamp: Math.floor(Date.now() / 1000),
    event: args.event,
    "content-state": args.contentState,
  };
  if (args.event === "start") {
    if (!args.attributes) {
      throw new Error("Live Activity start push requires attributes");
    }
    aps["attributes-type"] = LIVE_ACTIVITY_ATTRIBUTES_TYPE;
    aps.attributes = args.attributes;
  }
  if (args.event === "end" && args.dismissalDate) {
    aps["dismissal-date"] = args.dismissalDate;
  }
  if (args.staleDate) {
    aps["stale-date"] = args.staleDate;
  }

  const payload = JSON.stringify({ aps });
  const path = `/3/device/${args.token}`;

  log(`event=${args.event} status=${args.contentState.status} taskId=${args.attributes?.taskId ?? "-"}`);

  const response = await sendHttp2Request(
    host,
    path,
    {
      authorization: `bearer ${apnsToken}`,
      "apns-topic": `${bundleId}.push-type.liveactivity`,
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    payload,
  );

  if (response.status === 200) {
    log(`status=${response.status} ✓`);
  } else {
    console.error(`[push:liveactivity] status=${response.status} error: ${response.body}`);
  }
  return response;
}

/**
 * Send a silent/background push notification to a specific device token.
 * Used for auto-confirm location requests where the app responds in the background.
 */
export async function sendSilentPushNotification(
  deviceToken: string,
  data: Record<string, string>,
) {
  const log = (msg: string) => console.log(`[push:silent] ${msg}`);

  if (process.env.IS_E2E) {
    log("skipped (E2E mode)");
    return;
  }

  const token = await getApnsToken();
  const bundleId = process.env.APNS_BUNDLE_ID!;
  const isProduction = process.env.APNS_ENVIRONMENT === "production";
  const host = isProduction ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";

  log(`token=${deviceToken.slice(0, 8)}... type=${data.type ?? "unknown"}`);

  const apnsPayload = JSON.stringify({
    aps: {
      "content-available": 1,
    },
    ...data,
  });

  const path = `/3/device/${deviceToken}`;
  const response = await sendHttp2Request(
    host,
    path,
    {
      authorization: `bearer ${token}`,
      "apns-topic": bundleId,
      "apns-push-type": "background",
      "apns-priority": "5",
      "content-type": "application/json",
    },
    apnsPayload,
  );

  if (response.status === 200) {
    log(`status=${response.status} ✓`);
  } else {
    console.error(`[push:silent] status=${response.status} error: ${response.body}`);
  }

  return response;
}
