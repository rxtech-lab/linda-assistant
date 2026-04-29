import { hasToolCall, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import NodeID3 from "node-id3";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { audios, briefings } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
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

interface GenerateAudioArgs {
  audioId: string;
  userId: string;
  sessionId: string;
  toolCallId: string;
  title: string;
  content: string;
}

interface CoreArgs {
  logTag: string;
  sessionId: string | null;
  toolCallId?: string;
  toolName?: string;
  title: string;
  content: string;
  imageUrl: string | null;
  uploadKey: string;
  uploadFolder: string;
}

interface CoreResult {
  audioUrl: string;
  transcript: TranscriptSegment[];
  locale: string;
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

export interface TranscriptSegment {
  speaker: string;
  voiceShortName: string;
  locale: string;
  text: string;
}

/** Extract `<voice name="X">…</voice>` turns from an SSML fragment into transcript segments. */
function extractSegmentsFromSSML(
  ssml: string,
  fallbackLocale: string,
  speakersByVoice: Map<string, CastSpeaker>,
  voiceLocale: Map<string, string>,
): TranscriptSegment[] {
  const results: TranscriptSegment[] = [];
  const voiceRe =
    /<voice[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/voice>/gi;
  let match: RegExpExecArray | null = voiceRe.exec(ssml);
  while (match !== null) {
    const voiceShortName = match[1];
    const inner = match[2];
    const text = stripSSMLTags(inner).trim();
    if (text.length > 0) {
      const speaker =
        speakersByVoice.get(voiceShortName)?.role ?? voiceShortName;
      const locale = voiceLocale.get(voiceShortName) ?? fallbackLocale;
      results.push({ speaker, voiceShortName, locale, text });
    }
    match = voiceRe.exec(ssml);
  }
  if (results.length === 0) {
    const text = stripSSMLTags(ssml).trim();
    if (text.length > 0) {
      const [first] = [...speakersByVoice.values()];
      results.push({
        speaker: first?.role ?? "narrator",
        voiceShortName: first?.voiceShortName ?? "",
        locale: fallbackLocale,
        text,
      });
    }
  }
  return results;
}

function stripSSMLTags(fragment: string): string {
  return fragment
    .replace(/<break\b[^>]*\/?>(?:<\/break>)?/gi, " ")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

/**
 * Priority rank for zh-CN voices. Lower = higher priority.
 * Prefers HD Flash Latest > HD Latest > HD Omni Latest > Multilingual > standard.
 */
function zhCnVoiceRank(v: AzureVoice): number {
  const name = v.ShortName;
  if (/DragonHDFlashLatest/i.test(name)) return 0;
  if (/DragonHDLatest/i.test(name)) return 1;
  if (/DragonHDOmniLatest/i.test(name)) return 2;
  if (/DragonHD/i.test(name)) return 3;
  if (/Multilingual/i.test(name)) return 4;
  return 5;
}

function sortLocaleVoices(locale: string, vs: AzureVoice[]): AzureVoice[] {
  if (locale === "zh-CN") {
    return [...vs].sort((a, b) => {
      const ra = zhCnVoiceRank(a);
      const rb = zhCnVoiceRank(b);
      if (ra !== rb) return ra - rb;
      return a.ShortName.localeCompare(b.ShortName);
    });
  }
  return vs;
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
    const sorted = sortLocaleVoices(locale, vs);
    // Expose more voices for zh-CN so the agent can actually see the HD variants
    // that should be preferred. For other locales, keep the compact 6-voice sample.
    const sampleSize = locale === "zh-CN" ? 20 : 6;
    const sample = sorted.slice(0, sampleSize).map(summarizeVoice).join("; ");
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

CRITICAL parallelism rule:
- Do NOT emit generateSegment and finalizePodcast in the same turn. finalizePodcast must be the ONLY tool call in its turn, emitted AFTER every generateSegment call has completed and returned its result.
- Prefer issuing generateSegment calls one at a time per turn (waiting for each result) rather than batching multiple generateSegment tool calls in a single turn.

Cast guidance:
- Use 1 narrator for short briefings (< 300 words).
- Add a co-host for long reflective briefings.
- For every named individual quoted in the briefing, assign a dedicated voice — match their gender and locale when known.
- All voices must come from the catalog provided.
- For zh-CN (Mandarin, Simplified), STRONGLY prefer the newer high-definition voices in this priority order: (1) *DragonHDFlashLatestNeural, (2) *DragonHDLatestNeural, (3) *DragonHDOmniLatestNeural, (4) *MultilingualNeural. Only fall back to the classic Neural voices (e.g. zh-CN-XiaoxiaoNeural, zh-CN-YunxiNeural) if no HD voice of the needed gender is available. The catalog lists zh-CN voices in this preferred order — pick from the top.

Quoted-speaker attribution (REQUIRED):
- Whenever you switch to a different voice to deliver a quoted person's words, the host/narrator MUST first introduce who is speaking using an attribution phrase before the other voice begins. Examples: "Sam Altman says,", "she expresses,", "the report indicates,", "according to Jane Doe,", "as Tim put it,". Localize the phrase to the podcast's locale (e.g. zh-CN: "萨姆·奥特曼表示", "她说道", "报告指出").
- The attribution must be spoken by the host/narrator voice, immediately followed by the quoted person's voice delivering the quote. Never switch voices without an attribution cue — listeners cannot see voice tags and will be confused.
- After the quote, when control returns to the host/narrator, briefly re-anchor if needed (e.g. "…that's what Sam said.") so the listener knows the quote has ended.

SSML guidance:
- Wrap each speaker turn with <voice name="ShortName">...</voice>.
- Use <break time="400ms"/> between thoughts and <break time="700ms"/> between sections.
- Do NOT adjust speaking speed — never use <prosody rate="..."> on any speaker. Use the default speed for all voices.
- Where a voice supports styles (StyleList), use <mstts:express-as style="..."> to enrich delivery.
- Do NOT include the outer <speak> envelope — the system adds it automatically with the locale you declared.

Structure (required):
- Open with a 1-2 sentence hook.
- Walk through the substance.
- ALWAYS include an exit segment before ending the podcast — a brief sign-off that thanks the listener and clearly closes out the episode (e.g. "That's all for today, thanks for listening — see you next time."). The exit segment must be present in every podcast, even short ones, and must be the final spoken content before finalizePodcast is called.

Quality bar: write a podcast you would actually want to listen to.`;

async function generatePodcastCore(args: CoreArgs): Promise<CoreResult> {
  const {
    logTag,
    sessionId,
    toolCallId,
    toolName,
    title,
    content,
    imageUrl,
    uploadKey,
    uploadFolder,
  } = args;
  const log = (msg: string, extra?: unknown) =>
    console.log(`[podcast] ${logTag} ${msg}`, extra ?? "");

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;

  log("step=start", {
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
  const segmentSSML: string[] = [];
  // Some models (e.g. Gemini) emit generateSegment + finalizePodcast in the same
  // parallel-tool-call turn. When stopWhen fires on finalizePodcast, the agent
  // loop returns while the in-flight synthesizeSSML promises are still running.
  // Track every segment promise so we can await them all before concatenating.
  const segmentPromises: Promise<void>[] = [];

  const emitProgress = async (
    step: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (!sessionId) return;
    await publishEvent({
      sessionId,
      event: "tool-progress",
      data: {
        toolName: toolName ?? "generate_podcast",
        ...(toolCallId ? { toolCallId } : {}),
        step,
        message: typeof extra.message === "string" ? extra.message : undefined,
        ...extra,
      },
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
          const work = (async () => {
            const buf = await synthesizeSSML(wrapped);
            segmentBuffers[segmentIndex] = buf;
            segmentSSML[segmentIndex] = ssml;
            log(
              `step=generateSegment done idx=${segmentIndex} audioBytes=${buf.length} took=${((Date.now() - segStart) / 1000).toFixed(2)}s totalSegments=${segmentBuffers.filter(Boolean).length}`,
            );
            return buf;
          })();
          segmentPromises.push(
            work.then(
              () => undefined,
              (err) => {
                log(
                  `step=generateSegment failed idx=${segmentIndex} err=${err instanceof Error ? err.message : String(err)}`,
                );
              },
            ),
          );
          const buf = await work;
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
    prompt: `Adapt the following content into a podcast.\n\nTitle: ${title}\n\nContent (markdown):\n\n${content}\n\n---\n\nAvailable Azure Neural voices (recommended subset, you may also use other voices for the detected locale):\n${voiceCatalogSummary}\n\nRemember: call planCast first, then one or more generateSegment calls in order, then finalizePodcast.`,
  });
  log(
    `step=agent-loop done took=${((Date.now() - agentStart) / 1000).toFixed(2)}s segmentsBuffered=${segmentBuffers.filter(Boolean).length} inFlight=${segmentPromises.length - segmentBuffers.filter(Boolean).length}`,
  );

  // Drain any segment promises still in flight (Gemini-style parallel tool calls
  // can return from agent.generate() before every synthesizeSSML resolves).
  if (segmentPromises.length > 0) {
    log(`step=drain-segments begin pending=${segmentPromises.length}`);
    await Promise.allSettled(segmentPromises);
    log(
      `step=drain-segments done buffered=${segmentBuffers.filter(Boolean).length}/${segmentPromises.length} elapsed=${elapsed()}`,
    );
  }

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
  const { url: audioUrl } = await uploadBufferToS3(
    podcastBuffer,
    "audio/mpeg",
    uploadKey,
    uploadFolder,
  );
  log(
    `step=upload done url=${audioUrl} took=${((Date.now() - uploadStart) / 1000).toFixed(2)}s`,
  );

  // 5. Build speaker-labeled transcript from the SSML segments we collected.
  const speakersByVoice = new Map(
    cast.speakers.map((s) => [s.voiceShortName, s] as const),
  );
  const voiceLocale = new Map<string, string>();
  for (const v of voices) voiceLocale.set(v.ShortName, v.Locale);
  const transcript: TranscriptSegment[] = [];
  for (const ssml of segmentSSML) {
    if (!ssml) continue;
    const segs = extractSegmentsFromSSML(
      ssml,
      cast.locale,
      speakersByVoice,
      voiceLocale,
    );
    transcript.push(...segs);
  }

  log(
    `step=core-done totalElapsed=${elapsed()} url=${audioUrl} transcriptSegments=${transcript.length}`,
  );
  return { audioUrl, transcript, locale: cast.locale };
}

export async function generatePodcastForBriefing(
  args: GenerateArgs,
): Promise<void> {
  const { briefingId, userId, sessionId, title, content, imageUrl } = args;

  const { audioUrl: podcastUrl } = await generatePodcastCore({
    logTag: `briefing=${briefingId}`,
    sessionId,
    toolName: "generate_podcast",
    title,
    content,
    imageUrl,
    uploadKey: `podcast-${briefingId}.mp3`,
    uploadFolder: "briefing-podcasts",
  });

  await db
    .update(briefings)
    .set({
      podcastUrl,
      podcastStatus: "ready",
      podcastError: null,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(briefings.id, briefingId));

  if (sessionId) {
    await publishEvent({
      sessionId,
      event: "briefing-podcast-ready",
      data: { briefingId, podcastUrl },
      timestamp: Date.now(),
    }).catch((err) => console.warn("[podcast] publishEvent failed", err));
  }

  await sendPushNotification(userId, {
    title: "Your podcast is ready",
    body: title,
    data: {
      type: "briefing-podcast-ready",
      briefingId,
      podcastUrl,
    },
  }).catch((err) => console.warn("[podcast] push failed", err));
}

export interface GeneratePodcastForAudioResult {
  audioUrl: string;
  transcript: TranscriptSegment[];
  locale: string;
}

export async function generatePodcastForAudio(
  args: GenerateAudioArgs,
): Promise<GeneratePodcastForAudioResult> {
  const { audioId, userId, sessionId, toolCallId, title, content } = args;
  try {
    if (sessionId) {
      await publishEvent({
        sessionId,
        event: "tool-progress",
        data: {
          toolCallId,
          toolName: "generate_audio",
          step: "starting",
          message: "Starting podcast generation...",
        },
        timestamp: Date.now(),
      }).catch(() => undefined);
    }

    const { audioUrl, transcript, locale } = await generatePodcastCore({
      logTag: `audio=${audioId}`,
      sessionId,
      toolCallId,
      toolName: "generate_audio",
      title,
      content,
      imageUrl: null,
      uploadKey: `audio-${audioId}.mp3`,
      uploadFolder: "audios",
    });

    await db
      .update(audios)
      .set({
        audioUrl,
        status: "ready",
        transcript: JSON.stringify(transcript),
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(audios.id, audioId));

    await publishEvent({
      sessionId,
      event: "audio-ready",
      data: { audioId, audioUrl },
      timestamp: Date.now(),
    }).catch((err) => console.warn("[podcast] publishEvent failed", err));

    await sendPushNotification(userId, {
      title: "Your audio is ready",
      body: title,
      data: {
        type: "audio-ready",
        audioId,
        audioUrl,
      },
    }).catch((err) => console.warn("[podcast] push failed", err));

    return { audioUrl, transcript, locale };
  } catch (err) {
    console.error(`[podcast] audio generation failed for ${audioId}:`, err);
    await db
      .update(audios)
      .set({
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(audios.id, audioId))
      .catch(() => undefined);
    throw err;
  }
}
