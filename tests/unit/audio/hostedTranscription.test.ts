import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Collection, type Attachment, type Message } from "discord.js";
import type { TranscriptionModelRow } from "@/types/db/schema";
import { transcribeMessageAudioAttachment } from "@/utils/audio/audioAttachmentTranscription";
import * as ffmpegConvert from "@/utils/audio/ffmpegConvert";
import { log } from "@/utils/misc/logger";
import * as speechEndpointResolver from "@/utils/provider/speechEndpointResolver";
import type { TranscriptionTarget } from "@/utils/provider/speechEndpointResolver";
import * as safeDownloadModule from "@/utils/security/safeDownload";
import { stubGlobalFetch } from "../../helpers/fetchStub";

const SERVER_ID = 7;
const USER_ID = 11;
const MP3 = Buffer.from("converted-mp3");

function audioMessage(): Message {
  const attachment = {
    name: "voice.ogg",
    contentType: "audio/ogg",
    url: "https://cdn.discordapp.com/attachments/voice.ogg",
    size: 3,
  } as Attachment;
  return { id: "message_1", attachments: new Collection([["attachment_1", attachment]]) } as unknown as Message;
}

function hostedTarget(
  provider: TranscriptionModelRow["provider"],
  codename: string,
  owner: "server" | "personal",
): TranscriptionTarget {
  return {
    kind: "hosted-model",
    model: {
      transcription_model_id: provider === "openrouter" ? 1 : 2,
      provider,
      codename,
      descriptions: null,
      is_default: true,
      is_deprecated: false,
      is_scoped_registration: false,
    },
    owner: { kind: owner, ownerId: owner === "server" ? SERVER_ID : USER_ID },
    credentialId: 1,
    credentialRevision: 1,
    credentialProvider: provider,
    apiKey: `synthetic-${provider}-key`,
  };
}

function requestJson(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("Hosted transcription", () => {
  const spies: Array<{ mockRestore(): void }> = [];
  let requests: Array<{ url: string; body: Record<string, unknown> }>;
  let respond: (url: string) => Response;

  beforeEach(() => {
    requests = [];
    spies.push(
      spyOn(safeDownloadModule, "safeDownload").mockResolvedValue({ success: true, buffer: Buffer.from("ogg") }),
      spyOn(ffmpegConvert, "convertAudioToTranscriptionMp3").mockResolvedValue(MP3),
      spyOn(log, "warn").mockImplementation(() => undefined),
      spyOn(log, "error").mockResolvedValue(undefined),
      stubGlobalFetch((input, init) => {
        const url = String(input);
        requests.push({ url, body: requestJson(init) });
        return respond(url);
      }),
    );
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it("sends converted MP3 to OpenRouter and returns the normalized transcript", async () => {
    spies.push(
      spyOn(speechEndpointResolver, "resolveTranscriptionTargets").mockResolvedValue([
        hostedTarget("openrouter", "openai/whisper-large-v3-turbo", "server"),
      ]),
    );
    respond = () => Response.json({ text: "  hello   there ", usage: { seconds: 2, cost: 0.0001 } });

    const result = await transcribeMessageAudioAttachment(audioMessage(), SERVER_ID);

    expect(result.transcriptText).toBe("hello there");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(requests[0].body).toEqual({
      model: "openai/whisper-large-v3-turbo",
      input_audio: { data: MP3.toString("base64"), format: "mp3" },
    });
  });

  it("falls back from a failed personal model to the server model", async () => {
    spies.push(
      spyOn(speechEndpointResolver, "resolveTranscriptionTargets").mockResolvedValue([
        hostedTarget("openrouter", "openai/whisper-large-v3-turbo", "personal"),
        hostedTarget("google", "gemini-3.5-transcribe", "server"),
      ]),
    );
    respond = (url) =>
      url.startsWith("https://openrouter.ai")
        ? Response.json({ error: { message: "upstream unavailable" } }, { status: 503 })
        : Response.json({
            status: "completed",
            steps: [{ type: "model_output", content: [{ type: "text", text: "server transcript" }] }],
          });

    const result = await transcribeMessageAudioAttachment(audioMessage(), SERVER_ID, USER_ID);

    expect(result.transcriptText).toBe("server transcript");
    expect(requests.map(({ url }) => new URL(url).host)).toEqual([
      "openrouter.ai",
      "generativelanguage.googleapis.com",
    ]);
    expect(requests[1].body).toMatchObject({
      model: "gemini-3.5-transcribe",
      input: [{ type: "audio", data: MP3.toString("base64"), mime_type: "audio/mp3" }],
    });
  });

  it("treats an empty transcript as final instead of retrying the server model", async () => {
    spies.push(
      spyOn(speechEndpointResolver, "resolveTranscriptionTargets").mockResolvedValue([
        hostedTarget("openrouter", "openai/whisper-large-v3-turbo", "personal"),
        hostedTarget("google", "gemini-3.5-transcribe", "server"),
      ]),
    );
    respond = () => Response.json({ text: "   " });

    const result = await transcribeMessageAudioAttachment(audioMessage(), SERVER_ID, USER_ID);

    expect(result.failureReason).toBe("empty_transcript");
    expect(requests).toHaveLength(1);
  });

  it("reports a rejected key as an expected refusal, not an error", async () => {
    spies.push(
      spyOn(speechEndpointResolver, "resolveTranscriptionTargets").mockResolvedValue([
        hostedTarget("openrouter", "openai/whisper-large-v3-turbo", "personal"),
      ]),
    );
    respond = () => Response.json({ error: { message: "bad key" } }, { status: 401 });

    const result = await transcribeMessageAudioAttachment(audioMessage(), SERVER_ID, USER_ID);

    expect(result.failureReason).toBe("stt_failed");
    expect(log.error).not.toHaveBeenCalled();
  });
});
