import { hasToolCall, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import NodeID3 from "node-id3";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings } from "@/lib/db/schema";
import { uploadBufferToS3 } from "@/lib/s3";
import { publishEvent } from "@/lib/queue/producer";
import { sendPushNotification } from "@/lib/push";
import { PODCAST_GENERATION_MODEL } from "../context";
import { getModelProvider } from "../model";
import {
  listAzureVoices,
  synthesizeSSML,
  type AzureVoice,
} from "@/lib/audio/azure-tts";

interface GenerateArgs {
  briefingId: string;
  userId: string;
  sessionId: string | null;
  title: string;
  content: string;
  imageUrl: string | null;
}

interface CastSpeaker {
  role: string;
  voiceShortName: string;
  description: string;
}

interface CastState {
  locale: string | null;
  speakers: CastSpeaker[];
}

const RECOMMENDED_LOCALES = new Set([
  "en-US",
  "en-GB",
  "zh-CN",
  "zh-TW",
  "ja-JP",
  "es-ES",
  "es-MX",
  "fr-FR",
  "de-DE",
  "pt-BR",
  "ko-KR",
]);

function summarizeVoice(v: AzureVoice): string {
  const styles =
    v.StyleList && v.StyleList.length > 0
      ? ` styles=[${v.StyleList.slice(0, 6).join(",")}]`
      : "";
  return `${v.ShortName} (${v.Locale}, ${v.Gender}${styles})`;
}

function buildVoiceCatalog(voices: AzureVoice[]): string {
  const neural = voices.filter(
    (v) => v.VoiceType === "Neural" && RECOMMENDED_LOCALES.has(v.Locale),
  );
  const byLocale = new Map<string, AzureVoice[]>();
  for (const v of neural) {
    const list = byLocale.get(v.Locale) ?? [];
    list.push(v);
    byLocale.set(v.Locale, list);
  }
  const lines: string[] = [];
  for (const [locale, vs] of byLocale.entries()) {
    const sample = vs.slice(0, 6).map(summarizeVoice).join("; ");
    lines.push(`- ${locale}: ${sample}`);
  }
  return lines.join("\n");
}

function wrapSSML(inner: string, locale: string): string {
  // If the agent already returned a full <speak> envelope, keep it.
  if (/^\s*<speak[\s>]/i.test(inner)) return inner;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}">${inner}</speak>`;
}

const PODCAST_AGENT_PROMPT = `You are a podcast producer adapting a written briefing into a natural spoken-word podcast using Azure Neural TTS.

Strict rules:
- Do NOT add facts, numbers, opinions, or anecdotes that are not in the briefing.
- Adapt the briefing for spoken delivery — do NOT read markdown verbatim. Convert tables, headings, and bullet lists into flowing conversational sentences.
- Detect the language of the briefing yourself and pick voices for that locale.

Workflow (strict order):
1. Call planCast ONCE with locale, reasoning, and the speaker cast (1..N voices).
2. Call generateSegment one or more times in monotonically increasing order (segmentIndex starts at 0). Keep each segment under ~1500 characters of SSML for low latency.
3. Call finalizePodcast when you are done.

Cast guidance:
- Use 1 narrator for short briefings (< 300 words).
- Add a co-host for long reflective briefings.
- For every named individual quoted in the briefing, assign a dedicated voice — match their gender and locale when known.
- All voices must come from the catalog provided.

SSML guidance:
- Wrap each speaker turn with <voice name="ShortName">...</voice>.
- Use <break time="400ms"/> between thoughts and <break time="700ms"/> between sections.
- Use <prosody rate="95%"> for emphatic phrases and <prosody rate="105%"> for fast asides.
- Where a voice supports styles (StyleList), use <mstts:express-as style="..."> to enrich delivery.
- Do NOT include the outer <speak> envelope — the system adds it automatically with the locale you declared.

Quality bar: write a podcast you would actually want to listen to. Open with a 1-2 sentence hook, then walk through the substance, then close with a brief takeaway.`;

export async function generatePodcastForBriefing(
  args: GenerateArgs,
): Promise<void> {
  const { briefingId, userId, sessionId, title, content, imageUrl } = args;
  const log = (msg: string, extra?: unknown) =>
    console.log(`[podcast] briefing=${briefingId} ${msg}`, extra ?? "");

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;

  try {
    log("step=start", {
      userId,
      sessionId,
      titleLength: title.length,
      contentLength: content.length,
      hasImage: Boolean(imageUrl),
      model: PODCAST_GENERATION_MODEL,
    });

    // 1. Load voice catalog (cached after first call).
    log("step=load-voices begin");
    const voices = await listAzureVoices();
    const voicesByShortName = new Map(
      voices.map((v) => [v.ShortName, v] as const),
    );
    const voiceCatalogSummary = buildVoiceCatalog(voices);
    log("step=load-voices done", {
      totalVoices: voices.length,
      catalogLines: voiceCatalogSummary.split("\n").length,
      elapsed: elapsed(),
    });

    const cast: CastState = { locale: null, speakers: [] };
    const segmentBuffers: Buffer[] = [];

    const emitProgress = async (
      step: string,
      extra: Record<string, unknown> = {},
    ) => {
      if (!sessionId) return;
      await publishEvent({
        sessionId,
        event: "tool-progress",
        data: { toolName: "generate_podcast", briefingId, step, ...extra },
        timestamp: Date.now(),
      }).catch((err) => console.warn("[podcast] publishEvent failed", err));
    };

    const agent = new ToolLoopAgent({
      model: getModelProvider(PODCAST_GENERATION_MODEL),
      instructions: PODCAST_AGENT_PROMPT,
      stopWhen: hasToolCall("finalizePodcast"),
      providerOptions: { gateway: { caching: "auto" } },
      tools: {
        planCast: tool({
          description:
            "Declare the locale and the speaker cast. MUST be called once before generateSegment.",
          inputSchema: z.object({
            locale: z
              .string()
              .describe(
                "BCP-47 locale matching the chosen voices, e.g. en-US, zh-CN, ja-JP",
              ),
            reasoning: z
              .string()
              .describe("1-2 sentence justification of the cast composition"),
            speakers: z
              .array(
                z.object({
                  role: z
                    .string()
                    .describe("e.g. host, co-host, quoted-person:Sam Altman"),
                  voiceShortName: z
                    .string()
                    .describe("Azure ShortName, e.g. en-US-AvaNeural"),
                  description: z.string().describe("Short note on tone/use"),
                }),
              )
              .min(1),
          }),
          execute: async ({ locale, reasoning, speakers }) => {
            cast.locale = locale;
            cast.speakers = speakers;

            const warnings: string[] = [];
            for (const sp of speakers) {
              const v = voicesByShortName.get(sp.voiceShortName);
              if (!v) warnings.push(`Unknown voice: ${sp.voiceShortName}`);
              else if (v.Locale !== locale)
                warnings.push(
                  `Voice ${sp.voiceShortName} is locale ${v.Locale}, not ${locale}`,
                );
            }

            log(
              `step=planCast locale=${locale} speakers=${speakers.length} warnings=${warnings.length}`,
              {
                reasoning,
                speakers: speakers.map((s) => `${s.role}=${s.voiceShortName}`),
                warnings,
                elapsed: elapsed(),
              },
            );
            await emitProgress("planned", {
              locale,
              speakerCount: speakers.length,
            });
            return { ok: true, warnings };
          },
        }),

        generateSegment: tool({
          description:
            "Synthesize one ordered audio segment. Call repeatedly in increasing segmentIndex order.",
          inputSchema: z.object({
            segmentIndex: z.number().int().min(0),
            ssml: z
              .string()
              .describe(
                "SSML for this segment WITHOUT the outer <speak> envelope. Use <voice name='ShortName'>...</voice> per turn.",
              ),
          }),
          execute: async ({ segmentIndex, ssml }) => {
            if (!cast.locale) {
              throw new Error("planCast must be called before generateSegment");
            }
            const wrapped = wrapSSML(ssml, cast.locale);
            log(
              `step=generateSegment begin idx=${segmentIndex} ssmlBytes=${wrapped.length}`,
            );
            await emitProgress("synthesizing", { current: segmentIndex });
            const segStart = Date.now();
            const buf = await synthesizeSSML(wrapped);
            segmentBuffers[segmentIndex] = buf;
            log(
              `step=generateSegment done idx=${segmentIndex} audioBytes=${buf.length} took=${((Date.now() - segStart) / 1000).toFixed(2)}s totalSegments=${segmentBuffers.filter(Boolean).length}`,
            );
            return { ok: true, approxBytes: buf.length };
          },
        }),

        finalizePodcast: tool({
          description: "Call when all segments have been generated.",
          inputSchema: z.object({
            totalSegments: z.number().int().min(1),
          }),
          execute: async ({ totalSegments }) => {
            const actual = segmentBuffers.filter(Boolean).length;
            log(
              `step=finalizePodcast claimed=${totalSegments} actualBuffered=${actual} elapsed=${elapsed()}`,
            );
            return { ok: true };
          },
        }),
      },
    });

    log("step=agent-loop begin");
    const agentStart = Date.now();
    await agent.generate({
      prompt: `Adapt the following briefing into a podcast.\n\nBriefing title: ${title}\n\nBriefing content (markdown):\n\n${content}\n\n---\n\nAvailable Azure Neural voices (recommended subset, you may also use other voices for the detected locale):\n${voiceCatalogSummary}\n\nRemember: call planCast first, then one or more generateSegment calls in order, then finalizePodcast.`,
    });
    log(
      `step=agent-loop done took=${((Date.now() - agentStart) / 1000).toFixed(2)}s segmentsBuffered=${segmentBuffers.filter(Boolean).length}`,
    );

    if (!cast.locale || segmentBuffers.length === 0) {
      throw new Error("Podcast agent produced no segments");
    }

    // 2. Concatenate MP3 buffers (Azure guarantees identical encoding params for the chosen output format).
    log("step=concatenate begin");
    const compactSegments = segmentBuffers.filter((b): b is Buffer =>
      Buffer.isBuffer(b),
    );
    if (compactSegments.length === 0) {
      throw new Error("Podcast agent produced no audio buffers");
    }
    let podcastBuffer = Buffer.concat(compactSegments);
    log(
      `step=concatenate done segments=${compactSegments.length} bytes=${podcastBuffer.length} elapsed=${elapsed()}`,
    );

    // 3. Embed cover image as ID3v2 APIC.
    if (imageUrl) {
      log(`step=embed-cover begin url=${imageUrl}`);
      try {
        const imgRes = await fetch(imageUrl);
        if (imgRes.ok) {
          const imageBuffer = Buffer.from(await imgRes.arrayBuffer());
          const mime = imgRes.headers.get("content-type") ?? "image/jpeg";
          const tagged = NodeID3.write(
            {
              title,
              artist: "Linda",
              album: "Briefings",
              image: {
                mime,
                type: { id: 3, name: "front cover" },
                description: "Cover",
                imageBuffer,
              },
            },
            podcastBuffer,
          );
          if (Buffer.isBuffer(tagged)) {
            podcastBuffer = Buffer.from(tagged);
            log(
              `step=embed-cover done mime=${mime} coverBytes=${imageBuffer.length} taggedBytes=${podcastBuffer.length}`,
            );
          } else {
            log("step=embed-cover skipped (NodeID3 returned non-buffer)");
          }
        } else {
          log(`step=embed-cover skipped status=${imgRes.status}`);
        }
      } catch (err) {
        console.warn("[podcast] cover embed failed:", err);
      }
    } else {
      log("step=embed-cover skipped (no imageUrl)");
    }

    // 4. Upload.
    log(`step=upload begin bytes=${podcastBuffer.length}`);
    const uploadStart = Date.now();
    const { url: podcastUrl } = await uploadBufferToS3(
      podcastBuffer,
      "audio/mpeg",
      `podcast-${briefingId}.mp3`,
      "briefing-podcasts",
    );
    log(
      `step=upload done url=${podcastUrl} took=${((Date.now() - uploadStart) / 1000).toFixed(2)}s`,
    );

    // 5. Persist on briefing row.
    log("step=db-update begin");
    await db
      .update(briefings)
      .set({ podcastUrl })
      .where(eq(briefings.id, briefingId));
    log("step=db-update done");

    // 6. Notify clients via SSE event.
    if (sessionId) {
      log(`step=sse-publish begin sessionId=${sessionId}`);
      await publishEvent({
        sessionId,
        event: "briefing-podcast-ready",
        data: { briefingId, podcastUrl },
        timestamp: Date.now(),
      })
        .then(() => log("step=sse-publish done"))
        .catch((err) => console.warn("[podcast] publishEvent failed", err));
    } else {
      log("step=sse-publish skipped (no sessionId)");
    }

    // 7. Push notification.
    log(`step=push begin userId=${userId}`);
    await sendPushNotification(userId, {
      title: "Your podcast is ready",
      body: title,
      data: {
        type: "briefing-podcast-ready",
        briefingId,
        podcastUrl,
      },
    })
      .then(() => log("step=push done"))
      .catch((err) => console.warn("[podcast] push failed", err));

    log(`step=done totalElapsed=${elapsed()} url=${podcastUrl}`);
  } catch (err) {
    console.error(
      `[podcast] generation failed for briefing=${briefingId} after ${elapsed()}:`,
      err,
    );
  }
}
