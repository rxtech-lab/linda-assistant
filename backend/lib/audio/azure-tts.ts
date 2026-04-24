/**
 * Azure Cognitive Services — Neural Text-to-Speech client.
 *
 * Uses the REST endpoints documented at
 * https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
 *
 * Requires:
 *   AZURE_SPEECH_KEY        — subscription key
 *   AZURE_SPEECH_ENDPOINT   — full base URL (e.g. https://eastus.tts.speech.microsoft.com)
 */

export interface AzureVoice {
  ShortName: string;
  Locale: string;
  LocaleName: string;
  DisplayName: string;
  Gender: string;
  VoiceType: string;
  StyleList?: string[];
  RolePlayList?: string[];
}

let cachedVoices: AzureVoice[] | null = null;
let cachedVoicesAt = 0;
const VOICES_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function getEndpoint(): string {
  const ep = process.env.AZURE_SPEECH_ENDPOINT;
  if (!ep) throw new Error("AZURE_SPEECH_ENDPOINT is not set");
  return ep.replace(/\/$/, "");
}

function getKey(): string {
  const key = process.env.AZURE_SPEECH_KEY;
  if (!key) throw new Error("AZURE_SPEECH_KEY is not set");
  return key;
}

export async function listAzureVoices(): Promise<AzureVoice[]> {
  if (cachedVoices && Date.now() - cachedVoicesAt < VOICES_TTL_MS) {
    return cachedVoices;
  }

  const url = `${getEndpoint()}/cognitiveservices/voices/list`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Ocp-Apim-Subscription-Key": getKey(),
    },
  });

  if (!res.ok) {
    throw new Error(`Azure voices/list failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as AzureVoice[];
  cachedVoices = data;
  cachedVoicesAt = Date.now();
  return data;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function synthesizeSSML(ssml: string): Promise<Buffer> {
  const url = `${getEndpoint()}/cognitiveservices/v1`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-160kbitrate-mono-mp3",
          "Ocp-Apim-Subscription-Key": getKey(),
          "User-Agent": "linda-assistant",
        },
        body: ssml,
      });

      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        return buf;
      }

      if (RETRYABLE_STATUS.has(res.status) && attempt < 2) {
        const delay = 500 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw new Error(`Azure TTS failed: ${res.status} ${await res.text()}`);
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        const delay = 500 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Azure TTS failed");
}
