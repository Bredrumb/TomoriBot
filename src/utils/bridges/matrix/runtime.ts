/**
 * Matrix Bridge Manager (Appservice Edition)
 * Manages the Matrix Appservice bridge, giving each TomoriBot persona its own
 * virtual Matrix user identity (e.g., @_tomori_lilya:yourdomain.com).
 *
 * Architecture:
 *   Matrix Room ─[push]─> appservice HTTP server ─[onEvent]─> Discord Channel
 *   Discord Channel ─[matrixRelay.ts]─> sendToMatrixRoom ─[Intent]─> Matrix Room
 *
 * Loop prevention:
 *   - Matrix→Discord: onEvent filters sender === botUserId OR startsWith("@_tomori_")
 *   - Discord→Matrix: persona Intents send under virtual user IDs, not the bot account
 */

import { createRequire } from "node:module";
import type * as MatrixAppserviceBridge from "matrix-appservice-bridge";
import type { Intent, WeakEvent, Request as BridgeRequest } from "matrix-appservice-bridge";

// Bun's ESM→CJS static analyzer cannot resolve Object.defineProperty-based
// re-exports used by matrix-appservice-bridge. Load at runtime via require()
// and cast to the package's own types (which are resolved by import type above).
const _require = createRequire(import.meta.url);
const { Bridge, AppServiceRegistration } = _require("matrix-appservice-bridge") as typeof MatrixAppserviceBridge;
import { EmbedBuilder, MessageFlags, type BaseGuildTextChannel, type Client, type TextBasedChannel } from "discord.js";
import type { ReminderRow } from "@/types/db/schema";
import { isBridgeUserId } from "@/utils/bridges";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { sql } from "@/utils/db/client";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { log, ColorCode } from "@/utils/misc/logger";
import { getOrCreateWebhook } from "@/utils/discord/webhookManager";
import { clearShortTermMemoryForChannel } from "@/utils/cache/shortTermMemoryCache";
import { localizer } from "@/utils/text/localizer";

// ─── Module-level state ────────────────────────────────────────────────────

/**
 * Matrix event type for room messages (the "m.room" + ".message" string, kept split
 * so the locale-key scanner does not treat it as a missing locale key reference).
 */
// eslint-disable-next-line prefer-template
const MATRIX_TEXT_MSG_TYPE = "m.room" + ".message";

/**
 * Matrix event type for membership changes (the "m.room" + ".member" string, kept split
 * so the locale-key scanner does not treat it as a missing locale key reference).
 */
// eslint-disable-next-line prefer-template
const MATRIX_MEMBER_EVENT_TYPE = "m.room" + ".member";

/** Initialized Matrix Bridge, or null if Matrix is not configured. */
let matrixBridge: MatrixAppserviceBridge.Bridge | null = null;

/**
 * Cache TTL for channel-room link DB lookups.
 * Configurable via MATRIX_LINK_CACHE_TTL_MINUTES (default: 5 minutes).
 */
const CACHE_TTL_MS = Number.parseInt(process.env.MATRIX_LINK_CACHE_TTL_MINUTES || "5", 10) * 60_000;

/**
 * Maximum attachment size (in bytes) to relay in either direction.
 * Files larger than this threshold are replaced with a text notice.
 * Configurable via MATRIX_MAX_ATTACHMENT_MB (default: 8 MB).
 * Exported so matrixRelay.ts can enforce the same limit on Discord→Matrix uploads.
 */
export const MATRIX_MAX_ATTACHMENT_BYTES =
  Number.parseInt(process.env.MATRIX_MAX_ATTACHMENT_MB || "8", 10) * 1024 * 1024;

/**
 * Timeout in milliseconds for Matrix media download/upload requests.
 * Configurable via MATRIX_MEDIA_TIMEOUT_MS (default: 15 000 ms).
 */
const MATRIX_MEDIA_TIMEOUT_MS = Number.parseInt(process.env.MATRIX_MEDIA_TIMEOUT_MS || "15000", 10);

/** Cache: Discord channel ID → linked Matrix room ID (null = known-not-linked). */
const channelLinkCache = new Map<string, { roomId: string | null; cachedAt: number }>();

/** Cache: Matrix room ID → linked Discord channel ID (null = known-not-linked). */
const roomLinkCache = new Map<string, { channelDiscId: string | null; cachedAt: number }>();

/**
 * In-memory cache of provisioned persona intents.
 * Key: localpart (e.g., "_tomori_lilya"), Value: the avatarUrl that was used when provisioned.
 * Avoids redundant display-name/avatar API calls within a single bot session.
 */
const provisionedIntents = new Map<string, { avatarUrl: string | null }>();

/**
 * Set of "{roomId}:{localpart}" keys for rooms where a virtual user has already
 * been invited and joined. Prevents redundant invite/join calls on every message
 * in private rooms (private rooms require bot invite before virtual user can join).
 */
const ensuredRoomMemberships = new Set<string>();

/**
 * Maximum number of sent Matrix event IDs to track for reply detection.
 * When the cap is reached, the oldest entry (by insertion order) is evicted.
 * 500 events ≈ the last ~500 bot messages per session — enough for any realistic reply chain.
 */
const MAX_TRACKED_SENT_EVENTS = Number.parseInt(process.env.MATRIX_MAX_TRACKED_SENT_EVENTS || "500", 10);
/**
 * Metadata tracked for a Matrix event sent by a bot persona.
 */
type SentPersonaReplyEvent = {
  personaName: string;
  replySnippet?: string;
};

/**
 * Map of recently sent Matrix event_id → persona reply metadata.
 * Used to detect when a Matrix user replies to a bot persona message so we can
 * prepend a richer system annotation to relayed Discord content and register a
 * pending reply trigger (see below).
 */
const sentEventPersonas = new Map<string, SentPersonaReplyEvent>();

/**
 * Map of Matrix user display name → full Matrix user ID.
 * Populated on every incoming Matrix message so matrixRelay.ts can resolve
 * @{displayName} placeholders in bot responses to proper Matrix mention links.
 * Key: senderLocalpart (e.g., "bred") — matches the display name the AI sees.
 * Value: full Matrix ID (e.g., "@bred:localhost").
 */
const matrixDisplayNameToId = new Map<string, string>();

/**
 * Set of Discord channel IDs where the very next webhook message is a Matrix
 * reply to a bot persona. `shouldBotReply()` in tomoriChat.ts checks and
 * *consumes* entries via `Set.delete()` (returns true if the key existed).
 * This lets TomoriBot respond to Matrix replies without needing Discord-native
 * reply references (which webhooks cannot carry).
 */
export const pendingMatrixReplyChannels = new Set<string>();

/**
 * Resolve a Matrix user's display name to their full Matrix ID.
 * Returns undefined if the user has not sent any messages in this session.
 * Used by matrixRelay.ts to transform @{displayName} placeholders in bot
 * responses into proper Matrix mention links.
 *
 * @param displayName - The user's display name as seen by the AI (e.g., "bred")
 * @returns The full Matrix ID (e.g., "@bred:localhost"), or undefined if unknown
 */
export function getMatrixIdForDisplayName(displayName: string): string | undefined {
  return matrixDisplayNameToId.get(displayName);
}

/**
 * Resolve a Matrix user ID back to its most recently seen display name.
 * Returns undefined if this Matrix user has not sent any messages in this session.
 *
 * @param matrixUserId - Full Matrix user ID (e.g., "@bred:localhost")
 * @returns Display name/localpart used in context (e.g., "bred"), or undefined if unknown
 */
export function getDisplayNameForMatrixId(matrixUserId: string): string | undefined {
  for (const [displayName, mappedId] of matrixDisplayNameToId.entries()) {
    if (mappedId === matrixUserId) {
      return displayName;
    }
  }

  return undefined;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Initialize the Matrix Appservice bridge from environment variables.
 * Silent no-op if any required credential is absent — bot starts without Matrix support.
 *
 * Required env vars:
 *   MATRIX_HOMESERVER_URL  — e.g., http://localhost:8448
 *   MATRIX_ACCESS_TOKEN    — as_token (appservice → homeserver auth)
 *   MATRIX_HS_TOKEN        — hs_token (homeserver → appservice auth)
 *   MATRIX_BOT_USER_ID     — e.g., @tomoribot:yourdomain.com
 *   MATRIX_SERVER_NAME     — domain portion, e.g., localhost or yourdomain.com
 *
 * Optional env vars:
 *   MATRIX_APPSERVICE_PUBLIC_URL — homeserver-facing appservice callback URL.
 *     Use this when the homeserver is remote (e.g., Matrix on DigitalOcean and
 *     TomoriBot on AWS). If absent, defaults to http://localhost:{port}.
 *
 * @param discordClient - Discord.js client, forwarded to the event handler for channel lookups
 */
export async function initializeMatrixClient(discordClient: Client): Promise<void> {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  const asToken = process.env.MATRIX_ACCESS_TOKEN; // appservice → homeserver
  const hsToken = process.env.MATRIX_HS_TOKEN; // homeserver → appservice
  const botUserId = process.env.MATRIX_BOT_USER_ID;
  const serverName = process.env.MATRIX_SERVER_NAME;

  // Silently skip initialization if any required credential is absent
  if (!homeserverUrl || !asToken || !hsToken || !botUserId || !serverName) {
    log.info("Matrix bridge: credentials not configured — bridge disabled");
    return;
  }

  const port = Number.parseInt(process.env.MATRIX_APPSERVICE_PORT || "9993", 10);
  const configuredPublicUrl = process.env.MATRIX_APPSERVICE_PUBLIC_URL?.trim();
  const localhostHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  let hasValidPublicUrl = false;
  let registrationUrl = `http://localhost:${port}`;

  if (configuredPublicUrl) {
    try {
      const parsedUrl = new URL(configuredPublicUrl);
      const isHttps = parsedUrl.protocol === "https:";
      const isLocalHttp = parsedUrl.protocol === "http:" && localhostHosts.has(parsedUrl.hostname);
      hasValidPublicUrl = isHttps || isLocalHttp;
      if (hasValidPublicUrl) {
        registrationUrl = configuredPublicUrl;
      }
    } catch {
      hasValidPublicUrl = false;
    }
  }

  if (configuredPublicUrl && !hasValidPublicUrl) {
    log.warn(
      `Matrix bridge: invalid MATRIX_APPSERVICE_PUBLIC_URL "${configuredPublicUrl}" — ` +
        `must be https:// for remote endpoints (http:// allowed only for localhost). ` +
        `Falling back to ${registrationUrl}`,
    );
  }

  try {
    // 1. Build the AppServiceRegistration from environment credentials
    const registration = AppServiceRegistration.fromObject({
      id: "tomoribot-appservice",
      hs_token: hsToken,
      as_token: asToken,
      url: registrationUrl,
      sender_localpart: "tomoribot",
      namespaces: {
        // Exclusive: only this appservice may create/use @_tomori_*:serverName users
        users: [{ exclusive: true, regex: `@_tomori_.*:${serverName}` }],
        aliases: [],
        rooms: [],
      },
      rate_limited: false,
    });

    // 2. Create Bridge with onEvent controller
    //    disableStores: true  — we use PostgreSQL, not the built-in NeDB file stores
    //    disableContext: true — disableStores makes context lookups meaningless anyway
    matrixBridge = new Bridge({
      homeserverUrl,
      domain: serverName,
      registration,
      disableStores: true,
      disableContext: true,
      controller: {
        // onEvent is typed void (not Promise<void>) — fire-and-forget the async handler
        onEvent: (request: BridgeRequest<WeakEvent>): void => {
          void handleMatrixEvent(request, discordClient, botUserId).catch((error) => {
            log.warn("Matrix bridge: uncaught error in event handler", error);
          });
        },
        // Route bridge internal logs through our logger (errors only to reduce noise)
        onLog: (_text: string, isError: boolean): void => {
          if (isError) {
            log.warn(`[matrix-appservice-bridge] ${_text}`);
          }
        },
      },
    });

    // 3. Run the bridge: calls initialise() internally, then starts the HTTP server
    //    The homeserver pushes events to `registrationUrl`, which should route
    //    back to this local listener on MATRIX_APPSERVICE_PORT.
    await matrixBridge.run(port);

    log.success(
      `Matrix appservice initialized — ${botUserId} @ ${homeserverUrl} ` +
        `(listening on port ${port}, callback ${registrationUrl})`,
    );
  } catch (error) {
    // Safely extract message/stack — the bridge error has internal circular refs
    // that crash JSON serialization inside our logger
    const safeMsg = error instanceof Error ? error.message : String(error);
    const safeStack = error instanceof Error ? error.stack : undefined;
    log.error(`Matrix bridge: failed to initialize appservice: ${safeMsg}\n${safeStack ?? ""}`);
    matrixBridge = null;
  }
}

/**
 * Returns true if the Matrix bridge is configured and running.
 * Used as a fast "is Matrix enabled?" check in commands and event handlers.
 */
export function isMatrixConfigured(): boolean {
  return matrixBridge !== null;
}

/**
 * Send a non-chat informational notice to a Matrix room as the bot account.
 * Used for bridge onboarding messages so they do not appear as persona chat.
 *
 * @param roomId - The Matrix room ID to send the notice to
 * @param text   - Plain-text notice body
 */
async function sendMatrixNotice(roomId: string, text: string): Promise<void> {
  if (!matrixBridge) return;

  try {
    const botIntent = matrixBridge.getIntent();
    await botIntent.sendMessage(roomId, {
      msgtype: "m.notice",
      body: text,
    });
  } catch (error) {
    log.warn(`Matrix bridge: failed to send notice to room ${roomId}`, error);
  }
}

/**
 * Send the initial setup hint after the bot auto-accepts a room invite.
 * Uses en-US because there is no linked Discord server locale yet.
 *
 * @param roomId - The invited Matrix room ID
 */
export async function sendMatrixInviteSetupNotice(roomId: string): Promise<void> {
  await sendMatrixNotice(
    roomId,
    localizer("en-US", "matrix.notices.invited", {
      link_command: "/server matrix link",
      help_command: "/help matrix",
      room_id_path: "Room Settings -> Advanced -> Internal Room ID",
      kill_command: "/kill",
      refresh_command: "/refresh",
    }),
  );
}

/**
 * Send a post-link onboarding notice in the Matrix room describing what to do
 * next and the current Matrix-specific limitations.
 *
 * @param roomId      - The linked Matrix room ID
 * @param locale      - Locale of the Discord admin who linked the room
 * @param channelName - Name of the Discord channel linked to the room
 */
export async function sendMatrixLinkedSetupNotice(roomId: string, locale: string, channelName: string): Promise<void> {
  await sendMatrixNotice(
    roomId,
    localizer(locale, "matrix.notices.linked", {
      channel_name: `#${channelName}`,
      help_command: "/help matrix",
      kill_command: "/kill",
      refresh_command: "/refresh",
    }),
  );
}

/**
 * Timeout in milliseconds for the Matrix typing indicator.
 * The homeserver automatically clears the typing state after this duration,
 * so no explicit stop call is needed for normal response times.
 * Configurable via MATRIX_TYPING_TIMEOUT_MS (default: 60 000 ms).
 */
const MATRIX_TYPING_TIMEOUT_MS = Number.parseInt(process.env.MATRIX_TYPING_TIMEOUT_MS || "60000", 10);

/**
 * Send or clear a typing indicator in a Matrix room as the given persona virtual user.
 * Uses the Matrix Client-Server API typing endpoint with the appservice token so the
 * indication appears under the persona's own virtual user identity.
 *
 * Fire-and-forget: failures are logged as warnings and never propagate to the caller.
 * The homeserver auto-clears the typing state after MATRIX_TYPING_TIMEOUT_MS if the
 * persona does not explicitly send `{ typing: false }`.
 *
 * @param roomId      - The Matrix room ID (e.g., "!abc:matrix.org")
 * @param personaName - Persona display name used to derive the virtual user localpart
 * @param isTyping    - true to start typing, false to clear it immediately
 */
export async function sendMatrixTypingIndicator(roomId: string, personaName: string, isTyping: boolean): Promise<void> {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  const asToken = process.env.MATRIX_ACCESS_TOKEN;
  const serverName = process.env.MATRIX_SERVER_NAME;
  if (!homeserverUrl || !asToken || !serverName || !matrixBridge) return;

  const localpart = `_tomori_${personaName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  const userId = `@${localpart}:${serverName}`;
  const encodedRoomId = encodeURIComponent(roomId);
  const encodedUserId = encodeURIComponent(userId);

  try {
    // PUT /_matrix/client/v3/rooms/{roomId}/typing/{userId}?user_id={userId}
    // The ?user_id query param tells the homeserver to act as the virtual persona user
    // (standard Matrix appservice masquerading protocol).
    const url = `${homeserverUrl}/_matrix/client/v3/rooms/${encodedRoomId}/typing/${encodedUserId}?user_id=${encodedUserId}`;
    const body = JSON.stringify(isTyping ? { typing: true, timeout: MATRIX_TYPING_TIMEOUT_MS } : { typing: false });

    await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${asToken}`,
        "Content-Type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Non-fatal: typing indicators are cosmetic; never block the main response flow
  }
}

/**
 * Join a Matrix room as the bot's own account.
 * Called by /server matrix link after persisting the DB link.
 * Passes MATRIX_SERVER_NAME as a via-servers hint so Conduit does not attempt
 * a federation lookup for rooms that already live on the local homeserver.
 *
 * @param roomId - The Matrix room ID to join (e.g., "!abc:matrix.org")
 */
export async function joinMatrixRoom(roomId: string): Promise<void> {
  if (!matrixBridge) return;

  // getIntent() with no args returns the bot account's Intent
  const botIntent = matrixBridge.getIntent();

  // Prefer the room's own server as the primary via hint, with local server fallback.
  // This avoids false join failures when linking federated rooms (e.g., :matrix.org).
  await botIntent.join(roomId, getJoinViaServers(roomId));
}

/**
 * Build Matrix "via servers" hints for room joins.
 * Uses the room ID's server as primary hint, and appends MATRIX_SERVER_NAME as fallback.
 *
 * @param roomId - Matrix room ID, e.g. "!abc:matrix.org" or "!abc:matrix.tomoribot.app"
 * @returns Ordered unique via-server list, or undefined when no hint can be derived
 */
function getJoinViaServers(roomId: string): string[] | undefined {
  const localServer = process.env.MATRIX_SERVER_NAME?.trim();
  const roomDelimiter = roomId.indexOf(":");
  const roomServer = roomDelimiter === -1 ? undefined : roomId.slice(roomDelimiter + 1).trim();

  const viaServers = new Set<string>();
  if (roomServer) {
    viaServers.add(roomServer);
  }
  if (localServer) {
    viaServers.add(localServer);
  }

  const list = Array.from(viaServers);
  return list.length > 0 ? list : undefined;
}

/**
 * Get (and lazily provision) the Matrix Intent for a given persona virtual user.
 *
 * On first use per session (or when avatarUrl changes), the virtual user is:
 *   1. Registered on the homeserver (idempotent)
 *   2. Given the persona's display name
 *   3. Given the persona's avatar (uploaded from Discord CDN)
 *
 * Subsequent calls with the same avatarUrl return immediately from the in-memory cache.
 * The cache is session-scoped (cleared on bot restart), so avatar changes take effect
 * at the next restart.
 *
 * @param personaName - Display name for the virtual user (e.g., "Lilya")
 * @param avatarUrl   - CDN URL of the persona's avatar image, or null if none
 * @returns The provisioned Intent, or null if the bridge is not configured
 */
export async function getPersonaIntent(personaName: string, avatarUrl: string | null): Promise<Intent | null> {
  if (!matrixBridge) return null;

  const serverName = process.env.MATRIX_SERVER_NAME;
  if (!serverName) return null;

  // Build virtual user localpart: lowercase, only alphanumerics and underscores
  const localpart = `_tomori_${personaName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
  const userId = `@${localpart}:${serverName}`;
  const intent = matrixBridge.getIntent(userId);

  // Return cached intent if avatar URL is unchanged (no need to re-provision)
  const cached = provisionedIntents.get(localpart);
  if (cached && cached.avatarUrl === avatarUrl) {
    return intent;
  }

  // Optimistic cache write BEFORE the async provisioning chain.
  // This prevents a race condition where two messages for the same persona arrive
  // simultaneously: both would see cached=undefined and race through ensureRegistered()
  // / setDisplayName() / setAvatarUrl(). With the optimistic write, the second caller
  // hits the cache and returns early while the first is still awaiting.
  provisionedIntents.set(localpart, { avatarUrl });

  try {
    // 1. Register the virtual user (safe to call repeatedly — idempotent)
    await intent.ensureRegistered();

    // 2. Set the display name to the persona's nickname
    await intent.setDisplayName(personaName);

    // 3. Upload and set the avatar if an avatar URL is available
    if (avatarUrl) {
      const media = await downloadAvatar(avatarUrl);
      if (media) {
        // uploadContent returns the mxc:// URI directly as a string
        const mxcUri = await intent.uploadContent(media.buffer, {
          type: media.mimeType,
          name: "avatar.png",
        });
        await intent.setAvatarUrl(mxcUri);
      }
    }

    log.info(`Matrix appservice: provisioned virtual user ${userId}`);
  } catch (error) {
    // Roll back the optimistic entry so the next message retries provisioning
    provisionedIntents.delete(localpart);
    // Non-fatal: still return the intent so message sending can proceed
    log.warn(`Matrix appservice: failed to provision ${userId}`, error);
  }

  return intent;
}

/**
 * Send a text message to a Matrix room as the given persona virtual user.
 * Falls back to the bot's own account if no persona intent can be resolved.
 * Silent no-op if the Matrix bridge is not configured.
 *
 * When `formattedText` is provided, the message is sent as a rich text event
 * (format: "org.matrix.custom.html") so Matrix clients render mention links.
 * When `mentionedUserIds` is non-empty, the `m.mentions` field is included so
 * homeservers can notify mentioned users without parsing message content (MSC3952).
 *
 * @param roomId           - The Matrix room ID (e.g., "!abc:matrix.org")
 * @param text             - Plain-text message body (fallback for clients without HTML support)
 * @param personaName      - Optional persona name; resolves a virtual user Intent when provided
 * @param avatarUrl        - Optional avatar URL for the persona's virtual user
 * @param formattedText    - Optional HTML body (for Matrix mention anchor tags)
 * @param mentionedUserIds - Optional list of mentioned Matrix user IDs for MSC3952 notifications
 */
export async function sendToMatrixRoom(
  roomId: string,
  text: string,
  personaName?: string,
  avatarUrl?: string | null,
  formattedText?: string,
  mentionedUserIds?: string[],
): Promise<void> {
  if (!matrixBridge) return;

  try {
    const serverName = process.env.MATRIX_SERVER_NAME ?? "";

    // Resolve the correct Intent: persona virtual user if available, else bot account
    let intent: Intent;
    if (personaName) {
      const localpart = `_tomori_${personaName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
      const userId = `@${localpart}:${serverName}`;
      intent = (await getPersonaIntent(personaName, avatarUrl ?? null)) ?? matrixBridge.getIntent();

      // Pre-invite and join before sending: private rooms reject auto-join without an invite
      await ensurePersonaInRoom(intent, userId, localpart, roomId);
    } else {
      intent = matrixBridge.getIntent();
    }

    // Build the message content — plain text or rich HTML if mentions are present
    const messageContent: Record<string, unknown> = {
      msgtype: "m.text",
      body: text,
    };

    // Attach HTML formatted body when mention anchor tags are present
    if (formattedText) {
      messageContent.formatted_body = formattedText;
      messageContent.format = "org.matrix.custom.html";
    }

    // MSC3952: explicit mention list lets the homeserver notify users without
    // parsing message content — more reliable than content-based detection
    if (mentionedUserIds && mentionedUserIds.length > 0) {
      messageContent["m.mentions"] = { user_ids: mentionedUserIds };
    }

    // Capture event_id so incoming Matrix replies to this message can be detected
    const response = await intent.sendMessage(roomId, messageContent);
    if (personaName && (response as { event_id?: string })?.event_id) {
      trackSentMatrixEvent((response as { event_id: string }).event_id, personaName, text);
    }
  } catch (error) {
    log.warn(`Matrix bridge: failed to send message to room ${roomId}`, error);
  }
}

/**
 * Upload a file to Matrix and send it as a media event in the given room.
 * Uses m.image for images, m.video for video, m.file for everything else.
 * Silent no-op if the Matrix bridge is not configured.
 *
 * @param roomId      - The Matrix room ID (e.g., "!abc:matrix.org")
 * @param data        - Raw file bytes as an ArrayBuffer
 * @param filename    - Original filename (used as the event body)
 * @param mimeType    - MIME type string (e.g., "image/png")
 * @param size        - File size in bytes (included in the event info block)
 * @param personaName - Optional persona name for virtual user routing
 * @param avatarUrl   - Optional avatar URL for the persona's virtual user
 */
export async function sendAttachmentToMatrixRoom(
  roomId: string,
  data: ArrayBuffer,
  filename: string,
  mimeType: string,
  size: number,
  personaName?: string,
  avatarUrl?: string | null,
): Promise<void> {
  if (!matrixBridge) return;

  try {
    const serverName = process.env.MATRIX_SERVER_NAME ?? "";

    let intent: Intent;
    if (personaName) {
      const localpart = `_tomori_${personaName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
      const userId = `@${localpart}:${serverName}`;
      intent = (await getPersonaIntent(personaName, avatarUrl ?? null)) ?? matrixBridge.getIntent();

      // Pre-invite and join before uploading/sending (same as sendToMatrixRoom)
      await ensurePersonaInRoom(intent, userId, localpart, roomId);
    } else {
      intent = matrixBridge.getIntent();
    }

    // 1. Upload the file bytes to the homeserver's media repository
    const buffer = Buffer.from(data);
    const mxcUri = await intent.uploadContent(buffer, {
      type: mimeType,
      name: filename,
    });

    const info = { mimetype: mimeType, size };

    // 2. Send the appropriate media event type based on MIME type and track event_id
    let mediaResponse: { event_id: string } | undefined;
    if (mimeType.startsWith("image/")) {
      mediaResponse = await intent.sendMessage(roomId, {
        msgtype: "m.image",
        body: filename,
        url: mxcUri,
        info,
      });
    } else {
      const msgtype = mimeType.startsWith("video/") ? "m.video" : "m.file";
      mediaResponse = await intent.sendMessage(roomId, {
        msgtype,
        body: filename,
        url: mxcUri,
        info,
      });
    }

    // Track so replies to media messages also trigger the bot
    if (personaName && mediaResponse?.event_id) {
      trackSentMatrixEvent(mediaResponse.event_id, personaName);
    }
  } catch (error) {
    log.warn(`Matrix bridge: failed to send attachment to room ${roomId}`, error);
  }
}

/**
 * Cached DB lookup: Discord channel ID → linked Matrix room ID.
 * Returns null if the channel has no linked Matrix room.
 * Results are cached for CACHE_TTL_MS to reduce DB load.
 *
 * @param channelDiscId - The Discord channel ID to look up
 * @returns The linked Matrix room ID, or null if not linked
 */
export async function getLinkedMatrixRoom(channelDiscId: string): Promise<string | null> {
  const now = Date.now();
  const cached = channelLinkCache.get(channelDiscId);

  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.roomId;
  }

  const [row] = await sql<{ matrix_room_id: string }[]>`
		SELECT matrix_room_id
		FROM matrix_channel_links
		WHERE channel_disc_id = ${channelDiscId}
		LIMIT 1
	`;

  const roomId = row?.matrix_room_id ?? null;
  channelLinkCache.set(channelDiscId, { roomId, cachedAt: now });

  return roomId;
}

/**
 * Cached DB lookup: Matrix room ID → linked Discord channel ID.
 * Returns null if the room has no linked Discord channel.
 * Results are cached for CACHE_TTL_MS to reduce DB load.
 *
 * @param matrixRoomId - The Matrix room ID to look up
 * @returns The linked Discord channel ID, or null if not linked
 */
export async function getDiscordChannelForRoom(matrixRoomId: string): Promise<string | null> {
  const now = Date.now();
  const cached = roomLinkCache.get(matrixRoomId);

  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.channelDiscId;
  }

  const [row] = await sql<{ channel_disc_id: string }[]>`
		SELECT channel_disc_id
		FROM matrix_channel_links
		WHERE matrix_room_id = ${matrixRoomId}
		LIMIT 1
	`;

  const channelDiscId = row?.channel_disc_id ?? null;
  roomLinkCache.set(matrixRoomId, { channelDiscId, cachedAt: now });

  return channelDiscId;
}

/**
 * Check whether a Matrix room has end-to-end encryption enabled.
 * Uses the appservice token to query the room's m.room.encryption state event.
 * Returns false on any error (network failure, room not found, etc.) so callers
 * can proceed optimistically — the worst case is a missed encryption check.
 *
 * @param roomId - The Matrix room ID to check (e.g., "!abc:matrix.org")
 * @returns true if the room is encrypted, false if not or unknown
 */
export async function isRoomEncrypted(roomId: string): Promise<boolean> {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  const asToken = process.env.MATRIX_ACCESS_TOKEN;
  if (!homeserverUrl || !asToken) return false;

  try {
    // Query the m.room.encryption state event — 200 means encrypted, 404 means not
    const url = `${homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${asToken}` },
      signal: AbortSignal.timeout(MATRIX_MEDIA_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Invalidate both link caches for a given Discord channel (and optionally its Matrix room).
 * Must be called after any INSERT/UPDATE/DELETE on matrix_channel_links to prevent stale data.
 *
 * @param channelDiscId - The Discord channel ID whose cache entry to clear
 * @param matrixRoomId  - Optional: the Matrix room ID whose cache entry to also clear
 */
export function invalidateMatrixLinkCache(channelDiscId: string, matrixRoomId?: string): void {
  channelLinkCache.delete(channelDiscId);
  if (matrixRoomId) {
    roomLinkCache.delete(matrixRoomId);
  }
}

/**
 * Attempt to recover a bridge user ID from a potentially mangled value produced by an LLM.
 * Handles two Matrix-specific failure modes in order:
 *   1. Missing "@" prefix — e.g., "bred:localhost" instead of "@bred:localhost"
 *   2. Plain display name — e.g., "bred" instead of "@bred:localhost"
 *
 * Pure Discord snowflakes (all digits) and already-valid bridge IDs are returned unchanged.
 * This consolidates the defensive checks that reminder and memory tools need.
 *
 * @param rawId - The raw string from the LLM (may be mangled bridge ID, display name, or snowflake)
 * @returns The resolved bridge user ID if recoverable, otherwise the original string unchanged
 */
export function resolveBridgeUserId(rawId: string): string {
  // No-op for empty strings, already-valid bridge IDs, or pure Discord snowflakes
  if (!rawId || isBridgeUserId(rawId) || /^\d+$/.test(rawId)) return rawId;

  // 1. Matrix "@" prefix recovery: "bred:localhost" → "@bred:localhost"
  if (rawId.includes(":") && !rawId.startsWith("@")) {
    const withAt = `@${rawId}`;
    if (isBridgeUserId(withAt)) {
      log.info(`Bridge: Restored missing @ prefix in user ID: "${rawId}" → "${withAt}"`);
      return withAt;
    }
  }

  // 2. Attempt display name → full Matrix ID resolution via session-scoped map
  const resolved = matrixDisplayNameToId.get(rawId);
  if (resolved) {
    log.info(`Bridge: Resolved display name "${rawId}" → "${resolved}"`);
    return resolved;
  }

  return rawId;
}

/**
 * Ensures the Matrix reminder recipient receives a mention ping after the AI responds.
 * Called by reminderTimer after tomoriChat() runs for a Matrix-targeted reminder.
 *
 * Checks whether any recent bot/webhook Discord message contained the @{localpart}
 * placeholder the AI uses to mention Matrix users. If none is found, sends a proper
 * Matrix mention directly to the linked room (plain @user:server body + HTML anchor
 * formatted_body + m.mentions field for MSC3952 homeserver notifications).
 *
 * @param channel          - The Discord channel the reminder was set in
 * @param reminder         - The due reminder row from the database
 * @param afterMessageId   - Fetch only messages sent after this Discord message ID
 * @param reminderStartTime - Unix timestamp (ms) of when reminder execution began
 * @param botUserId        - The Discord bot user ID for filtering relevant messages
 */
export async function sendMatrixReminderMention(
  channel: TextBasedChannel,
  reminder: ReminderRow,
  afterMessageId: string,
  reminderStartTime: number,
  botUserId: string,
): Promise<void> {
  const matrixRoomId = await getLinkedMatrixRoom(reminder.channel_disc_id);
  if (!matrixRoomId) return;

  if (!botUserId || !("messages" in channel)) return;

  // The AI uses @{localpart} format (e.g., "@{bred}") when mentioning Matrix users.
  // Use the localpart from user_discord_id for reliable detection — the user_nickname
  // field may differ from the localpart (e.g., "bredrumb" vs localpart "bred").
  const matrixLocalpart = reminder.user_discord_id.split(":")[0].replace(/^@/, "");
  const mentionPlaceholder = `@{${matrixLocalpart}}`;

  try {
    const recentMessages = await channel.messages.fetch({
      after: afterMessageId,
      limit: 100,
    });

    const relevantMessages = recentMessages.filter(
      (message) =>
        (message.author.id === botUserId || message.webhookId) && message.createdTimestamp >= reminderStartTime - 1000,
    );

    const hasMention = relevantMessages.some((message) => message.content.includes(mentionPlaceholder));

    if (!hasMention) {
      // AI did not mention the user — send a proper Matrix mention ping.
      // Plain body: "@bred:localhost" (Matrix ID as fallback text)
      // Formatted body: anchor tag rendered as a clickable, highlighted mention
      // m.mentions: MSC3952 field so the homeserver notifies the user directly
      const matrixId = reminder.user_discord_id;
      const safeName = reminder.user_nickname.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      await sendToMatrixRoom(
        matrixRoomId,
        matrixId,
        undefined,
        undefined,
        `<a href="https://matrix.to/#/${matrixId}">${safeName}</a>`,
        [matrixId],
      );

      log.info(`Matrix: Added fallback mention for reminder ${reminder.reminder_id} to ensure recipient is pinged`);
    }
  } catch (error) {
    log.warn(`Matrix: Failed to ensure mention for reminder ${reminder.reminder_id}:`, error);
  }
}

// ─── Private helpers ───────────────────────────────────────────────────────

/**
 * Convert an mxc:// URI to an authenticated HTTP download URL.
 * Uses the MSC3916 authenticated media endpoint (Matrix v1.11+):
 *   {homeserverUrl}/_matrix/client/v1/media/download/{serverHost}/{mediaId}
 * This endpoint requires an Authorization header with a valid access token.
 * Returns null if the URI format is invalid.
 *
 * @param mxcUrl        - The mxc:// media URI from the Matrix event content
 * @param homeserverUrl - The homeserver base URL used to resolve the HTTP download URL
 */
function mxcToHttp(mxcUrl: string, homeserverUrl: string): string | null {
  const match = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, serverHost, mediaId] = match;
  // MSC3916 authenticated media endpoint (replaces legacy /_matrix/media/v3/download/)
  return `${homeserverUrl}/_matrix/client/v1/media/download/${serverHost}/${mediaId}`;
}

/**
 * Normalize quoted reply snippets used in Matrix reply system annotations.
 */
function buildReplySnippet(rawText?: string | null): string | undefined {
  if (!rawText) return undefined;

  const normalized = rawText.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;

  // Keep outer annotation quoting stable: convert inner double quotes to single quotes.
  const safeForQuote = normalized.replace(/"/g, "'");
  return safeForQuote;
}

type PersonaReplyLookup = {
  isPersonaReply: boolean;
  replySnippet?: string;
};

/**
 * Fetch a Matrix event and detect whether it was sent by one of TomoriBot's
 * virtual persona users (@_tomori_*:serverName).
 *
 * Used as a fallback when a reply's event_id is not in sentEventPersonas
 * (e.g., replies to messages sent in a previous bot session). Also extracts a
 * short body snippet for richer [System:] reply annotations.
 *
 * @param roomId      - The Matrix room ID containing the event
 * @param eventId     - The event_id to fetch
 * @param serverName  - The homeserver domain (used to scope virtual user matching)
 */
async function getPersonaReplyEventMetadata(
  roomId: string,
  eventId: string,
  serverName: string,
): Promise<PersonaReplyLookup> {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  const asToken = process.env.MATRIX_ACCESS_TOKEN;
  if (!homeserverUrl || !asToken || !serverName) {
    return { isPersonaReply: false };
  }

  try {
    const url = `${homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${asToken}` },
      signal: AbortSignal.timeout(MATRIX_MEDIA_TIMEOUT_MS),
    });
    if (!response.ok) return { isPersonaReply: false };

    const data = (await response.json()) as {
      sender?: string;
      content?: { body?: string };
    };
    // Virtual persona users follow the pattern @_tomori_*:serverName
    const isPersonaReply =
      typeof data.sender === "string" && data.sender.startsWith("@_tomori_") && data.sender.endsWith(`:${serverName}`);
    if (!isPersonaReply) {
      return { isPersonaReply: false };
    }

    return {
      isPersonaReply: true,
      replySnippet: buildReplySnippet(data.content?.body),
    };
  } catch {
    return { isPersonaReply: false };
  }
}

/**
 * Store sent Matrix event metadata for reply detection.
 * Evicts the oldest entry when the MAX_TRACKED_SENT_EVENTS cap is reached.
 * Map iteration order is insertion order, so the first key is always the oldest.
 *
 * @param eventId     - The Matrix event_id returned by the homeserver after sending
 * @param personaName - The display name of the persona that sent the message
 * @param sentText    - The plain message body sent to Matrix (used to build a reply snippet)
 */
function trackSentMatrixEvent(eventId: string, personaName: string, sentText?: string): void {
  if (sentEventPersonas.size >= MAX_TRACKED_SENT_EVENTS) {
    // Map preserves insertion order — first key is the oldest entry
    const oldestKey = sentEventPersonas.keys().next().value;
    if (oldestKey) sentEventPersonas.delete(oldestKey);
  }
  sentEventPersonas.set(eventId, {
    personaName,
    replySnippet: buildReplySnippet(sentText),
  });
}

/**
 * Strip the Matrix reply fallback quote from a message body.
 * When a Matrix client replies to a message, it prepends the original content
 * as a block-quote fallback for clients that do not support rich replies:
 *   "> <@sender:server> original text\n\nactual reply"
 * This function removes that fallback block so the relayed Discord message
 * contains only the user's actual reply text.
 *
 * @param body - Raw message body from the Matrix event content
 * @returns The body with any leading fallback quote stripped, or the original if none found
 */
function stripMatrixReplyFallback(body: string): string {
  if (!body.startsWith("> ")) return body;
  // Fallback and reply are separated by a blank line (\n\n)
  const blankLineIndex = body.indexOf("\n\n");
  if (blankLineIndex === -1) return body;
  return body.slice(blankLineIndex + 2).trim();
}

/**
 * Ensure a virtual persona user is a member of the given Matrix room.
 * Private rooms require an explicit invite from the bot (already in room) before
 * the virtual user can join. Results are cached per session to avoid repeated calls.
 *
 * @param intent    - The persona virtual user's Intent
 * @param userId    - Full Matrix ID of the virtual user (e.g., "@_tomori_lilya:localhost")
 * @param localpart - The localpart portion (e.g., "_tomori_lilya"), used as cache key
 * @param roomId    - The Matrix room ID to ensure membership in
 */
async function ensurePersonaInRoom(intent: Intent, userId: string, localpart: string, roomId: string): Promise<void> {
  const cacheKey = `${roomId}:${localpart}`;
  if (ensuredRoomMemberships.has(cacheKey)) return;

  try {
    // 1. Have the bot invite the virtual user (safe to call if already invited)
    const botIntent = matrixBridge?.getIntent();
    if (botIntent) {
      try {
        await botIntent.invite(roomId, userId);
      } catch {
        // Ignore: user may already be invited or the room is public
      }
    }

    // 2. Virtual user joins (accepts the invite, or self-joins if public)
    await intent.join(roomId);

    // 3. Cache successful membership so we skip on future messages
    ensuredRoomMemberships.add(cacheKey);
    log.info(`Matrix appservice: ${userId} joined room ${roomId}`);
  } catch (error) {
    const safeMsg = error instanceof Error ? error.message : String(error);
    log.warn(`Matrix appservice: failed to ensure ${userId} in ${roomId}: ${safeMsg}`);
  }
}

/**
 * Fetch an avatar image from a CDN URL (e.g., Discord's media proxy).
 * Returns null on any error — avatar provisioning is non-critical.
 *
 * @param url - The HTTP(S) URL of the avatar image to download
 * @returns `{ buffer, mimeType }` on success, null on failure
 */
async function downloadAvatar(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(MATRIX_MEDIA_TIMEOUT_MS),
    });
    if (!response.ok) {
      log.warn(`Matrix appservice: avatar fetch failed (${response.status}) for ${url}`);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const mimeType = response.headers.get("content-type") ?? "image/png";
    return { buffer: Buffer.from(arrayBuffer), mimeType };
  } catch (error) {
    log.warn(`Matrix appservice: failed to download avatar from ${url}`, error);
    return null;
  }
}

/**
 * Download a Matrix media file identified by an mxc:// URL.
 * Returns null and logs a warning on any failure (network, size limit, etc.).
 *
 * @param mxcUrl        - The mxc:// media URL from the Matrix event content
 * @param homeserverUrl - The homeserver base URL to resolve the HTTP download URL
 * @param asToken       - The appservice token for authenticated media (MSC3916)
 * @param knownSize     - Optional pre-flight size from the event's info.size field
 * @returns `{ buffer, mimeType }` on success, null on failure
 */
async function downloadMatrixMedia(
  mxcUrl: string,
  homeserverUrl: string,
  asToken: string,
  knownSize?: number,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  // 1. Pre-flight size guard: reject oversized files before fetching
  if (knownSize !== undefined && knownSize > MATRIX_MAX_ATTACHMENT_BYTES) {
    return null;
  }

  // 2. Convert mxc:// URI to an HTTP(S) download URL
  const httpUrl = mxcToHttp(mxcUrl, homeserverUrl);
  if (!httpUrl) {
    log.warn(`Matrix bridge: could not resolve mxc URL: ${mxcUrl}`);
    return null;
  }

  try {
    // 3. Fetch with auth header and timeout (MSC3916 authenticated media)
    const response = await fetch(httpUrl, {
      headers: { Authorization: `Bearer ${asToken}` },
      signal: AbortSignal.timeout(MATRIX_MEDIA_TIMEOUT_MS),
    });

    if (!response.ok) {
      log.warn(`Matrix bridge: media fetch failed (${response.status}) for ${httpUrl}`);
      return null;
    }

    // 4. Secondary size guard via Content-Length header (if provided)
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    if (contentLength > MATRIX_MAX_ATTACHMENT_BYTES) {
      return null;
    }

    // 5. Buffer the response body and final size guard
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > MATRIX_MAX_ATTACHMENT_BYTES) {
      return null;
    }

    const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
    return { buffer, mimeType };
  } catch (error) {
    log.warn(`Matrix bridge: failed to download media from ${httpUrl}`, error);
    return null;
  }
}

/**
 * Handles the Matrix /refresh command.
 * Posts the standard refresh embed to the Discord channel (triggering history reset)
 * and clears the short-term memory cache for the channel.
 *
 * The embed title matches `commands.tool.refresh.title` — the exact marker that
 * checkTargetEmbedTitle() in tomoriChat.ts detects as a conversation reset point.
 *
 * @param channel       - The Discord text channel to post the embed to
 * @param channelDiscId - The Discord channel ID (for cache invalidation)
 */
async function handleMatrixRefresh(channel: BaseGuildTextChannel, channelDiscId: string): Promise<void> {
  // 1. Clear short-term memory cache for this channel (same as /tool refresh does)
  clearShortTermMemoryForChannel(channelDiscId);
  log.info(`Matrix /refresh: cleared short-term memories for channel ${channelDiscId}`);

  // 2. Build the refresh embed using en-US locale as the canonical reset marker
  const embed = new EmbedBuilder()
    .setTitle(localizer("en-US", "commands.tool.refresh.title"))
    .setDescription(localizer("en-US", "commands.tool.refresh.response"))
    .setColor(ColorCode.SECTION);

  // 3. Send the embed (suppress notifications to avoid pinging everyone)
  await channel.send({
    embeds: [embed],
    flags: MessageFlags.SuppressNotifications,
  });
}

/**
 * Clear Matrix typing indicators for all personas in a linked Discord channel.
 * Used by Matrix /kill to aggressively clear any lingering typing state.
 *
 * @param channel - Linked Discord channel (guild text-based)
 * @param roomId  - Matrix room ID where typing should be cleared
 * @returns Number of persona typing indicators attempted
 */
async function clearMatrixTypingIndicatorsForChannel(channel: BaseGuildTextChannel, roomId: string): Promise<number> {
  const personaNames = new Set<string>();

  try {
    const personas = await getCachedAllPersonas(channel.guildId);
    for (const persona of personas) {
      const name = persona.tomori_nickname?.trim();
      if (name) {
        personaNames.add(name);
      }
    }
  } catch (error) {
    log.warn(`Matrix /kill: failed to load personas for typing clear in channel ${channel.id}`, error);
  }

  personaNames.add(process.env.DEFAULT_BOTNAME || "Tomori");

  const names = Array.from(personaNames);
  await Promise.all(names.map((personaName) => sendMatrixTypingIndicator(roomId, personaName, false)));
  return names.length;
}

/**
 * Handle an incoming Matrix event pushed by the homeserver.
 * Replaces the old RoomEvent.Timeline sync listener.
 * Relays Matrix messages to the linked Discord channel via webhook.
 *
 * Loop prevention:
 *   - Skip events sent by the bot account itself
 *   - Skip events sent by any @_tomori_* virtual persona user
 *
 * @param request       - The bridge request wrapping the raw Matrix event
 * @param discordClient - Discord.js client for channel/webhook resolution
 * @param botUserId     - The bot's Matrix user ID for loop prevention
 */
async function handleMatrixEvent(
  request: BridgeRequest<WeakEvent>,
  discordClient: Client,
  botUserId: string,
): Promise<void> {
  const event = request.getData();
  const serverName = process.env.MATRIX_SERVER_NAME ?? "";

  // 1. Auto-accept invites sent to the bot account.
  //    When a Matrix user invites @tomoribot:domain, Conduit pushes a m.room.member
  //    event with membership="invite" and state_key=botUserId. We join immediately so
  //    the bot is ready before the Discord admin runs /server matrix link.
  if (
    event.type === MATRIX_MEMBER_EVENT_TYPE &&
    event.state_key === botUserId &&
    (event.content as { membership?: string }).membership === "invite"
  ) {
    try {
      const botIntent = matrixBridge?.getIntent();
      if (!botIntent) return;
      await botIntent.join(event.room_id, getJoinViaServers(event.room_id));
      log.info(`Matrix bridge: auto-accepted invite to ${event.room_id}`);
      await sendMatrixInviteSetupNotice(event.room_id);
    } catch (err) {
      const safeMsg = err instanceof Error ? err.message : String(err);
      log.warn(`Matrix bridge: failed to auto-accept invite to ${event.room_id}: ${safeMsg}`);
    }
    return;
  }

  // 2. Only relay room message events
  if (event.type !== MATRIX_TEXT_MSG_TYPE) return;

  // 3. Loop prevention: ignore messages from the bot account or any persona virtual user.
  //    The domain suffix check prevents a remote user named @_tomori_*:evil.org from
  //    accidentally (or maliciously) matching our appservice's virtual user namespace.
  const isOwnVirtualUser = event.sender.startsWith("@_tomori_") && event.sender.endsWith(`:${serverName}`);
  if (event.sender === botUserId || isOwnVirtualUser) return;

  // 4. Look up the linked Discord channel (cached DB query)
  const channelDiscId = await getDiscordChannelForRoom(event.room_id);
  if (!channelDiscId) return;

  // 5. Fetch the Discord channel
  const channel = await discordClient.channels.fetch(channelDiscId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;

  // 6. Build the webhook username from the sender's Matrix ID
  //    Format: "[Matrix|@user:host] localpart" (max 80 chars per Discord webhook limit)
  const senderLocalpart = event.sender.split(":")[0].replace("@", "");
  const rawUsername = `[Matrix|${event.sender}] ${senderLocalpart}`;

  // Record the display name → Matrix ID mapping so matrixRelay.ts can resolve
  // @{displayName} placeholders in bot responses to proper Matrix mention links.
  // The localpart is what the AI sees as the display name after prefix stripping.
  matrixDisplayNameToId.set(senderLocalpart, event.sender);
  const username = rawUsername.length > 80 ? `${rawUsername.slice(0, 77)}...` : rawUsername;

  // 7. Extract content fields and detect Matrix reply structure
  const content = event.content;
  const msgtype = (content.msgtype as string | undefined) ?? "m.text";
  const rawBody = (content.body as string | undefined)?.trim();

  // Detect whether this is a Matrix reply (m.relates_to.m.in_reply_to)
  const relatesTo = content["m.relates_to"] as Record<string, unknown> | undefined;
  const inReplyTo = relatesTo?.["m.in_reply_to"] as { event_id?: string } | undefined;
  const replyEventId = inReplyTo?.event_id;

  // Always strip the Matrix reply fallback quote block from the body.
  // Matrix clients prepend "> <@sender> original\n\nactual reply" for non-rich-reply clients.
  const bodyText = rawBody ? stripMatrixReplyFallback(rawBody) : rawBody;

  // 8. Branch on msgtype: relay media events as Discord file attachments
  const isMediaMsg = msgtype === "m.image" || msgtype === "m.video" || msgtype === "m.file" || msgtype === "m.audio";

  if (isMediaMsg) {
    const { webhook: mediaWebhook } = await getOrCreateWebhook(channel as BaseGuildTextChannel);
    if (!mediaWebhook) return;

    const mxcUrl = content.url as string | undefined;
    const info = content.info as Record<string, unknown> | undefined;
    const knownSize = typeof info?.size === "number" ? info.size : undefined;
    const filename = bodyText ?? "attachment";

    // 7a. Reject oversized attachments with a text notice
    if (knownSize !== undefined && knownSize > MATRIX_MAX_ATTACHMENT_BYTES) {
      const sizeMb = (knownSize / (1024 * 1024)).toFixed(1);
      await mediaWebhook.send({
        content: `[Matrix: attachment too large to relay (${sizeMb} MB)]`,
        username,
        allowedMentions: { parse: [] },
      });
      return;
    }

    // 7b. Attempt to download and relay the media file
    if (mxcUrl) {
      const homeserverUrl = process.env.MATRIX_HOMESERVER_URL ?? "";
      const asToken = process.env.MATRIX_ACCESS_TOKEN ?? "";
      const media = await downloadMatrixMedia(mxcUrl, homeserverUrl, asToken, knownSize);

      if (media) {
        await mediaWebhook.send({
          files: [{ attachment: media.buffer, name: filename }],
          username,
          allowedMentions: { parse: [] },
        });
        return;
      }
    }

    // 7c. Fallback: media unavailable
    await mediaWebhook.send({
      content: `[Matrix: attachment unavailable — ${filename}]`,
      username,
      allowedMentions: { parse: [] },
    });
    return;
  }

  // 9. Skip m.notice (bot/system automated messages) to prevent relay loops
  if (msgtype === "m.notice") return;

  if (!bodyText) return;

  // 10. Special command: /kill — stop active stream + clear queue in linked Discord channel
  if (bodyText === "/kill") {
    let hasActiveStream = false;
    let clearedQueueCount = 0;

    try {
      const { isChannelProcessingLocked, clearChannelProcessingQueue } = await import(
        "@/events/messageCreate/tomoriChat"
      );

      hasActiveStream = isChannelProcessingLocked(channelDiscId);
      clearedQueueCount = clearChannelProcessingQueue(channelDiscId);

      if (hasActiveStream) {
        StreamOrchestrator.requestStop(channelDiscId, event.sender);
      }
    } catch (error) {
      log.warn(`Matrix /kill: failed to stop stream/clear queue for channel ${channelDiscId}`, error);
    }

    const clearedTypingPersonaCount = await clearMatrixTypingIndicatorsForChannel(
      channel as BaseGuildTextChannel,
      event.room_id,
    );

    log.info(
      `Stop/clear requested via Matrix /kill by user ${event.sender} in channel ${channelDiscId}. Active stream: ${hasActiveStream}. Cleared ${clearedQueueCount} queued message(s). Cleared Matrix typing for ${clearedTypingPersonaCount} persona(s).`,
    );
    return;
  }

  // 11. Special command: /refresh — trigger conversation history reset in Discord
  if (bodyText === "/refresh") {
    await handleMatrixRefresh(channel as BaseGuildTextChannel, channelDiscId);
    return;
  }

  // 12. If this is a reply to a bot persona message, build a [System:] annotation
  //     that mirrors the format tomoriChat.ts uses for Discord replies (line ~2539).
  //     Also registers the Discord channel as a pending trigger so shouldBotReply()
  //     fires — webhooks cannot carry Discord-native reply references.
  //
  //     Two-layer lookup:
  //     a) sentEventPersonas Map  — fast in-memory hit for same-session messages
  //     b) homeserver event fetch — fallback for replies to messages sent in a
  //        previous bot session whose event_id was never recorded in this Map
  let replyContext = "";
  if (replyEventId) {
    const repliedPersonaEvent = sentEventPersonas.get(replyEventId);
    if (repliedPersonaEvent) {
      // Fast path: event was sent in this session — persona name is known
      const quotedSnippet = repliedPersonaEvent.replySnippet ? ` "${repliedPersonaEvent.replySnippet}"` : "";
      replyContext = `[System: ${senderLocalpart} is replying to ${repliedPersonaEvent.personaName}'s message${quotedSnippet}]`;
      pendingMatrixReplyChannels.add(channelDiscId);
    } else {
      // Slow path: fetch the original event and check if it was sent by a virtual persona user
      const replyMetadata = await getPersonaReplyEventMetadata(event.room_id, replyEventId, serverName);
      if (replyMetadata.isPersonaReply) {
        const quotedSnippet = replyMetadata.replySnippet ? ` "${replyMetadata.replySnippet}"` : "";
        replyContext = `[System: ${senderLocalpart} is replying to another person's message${quotedSnippet}]`;
        pendingMatrixReplyChannels.add(channelDiscId);
      }
    }
  }

  // 13. Relay as text via Discord webhook.
  //     m.emote (/me actions) are prefixed with "* " to match IRC/Matrix convention.
  //     For reply annotations, append [System: ...] at the end of the relayed body.
  let relayContent = msgtype === "m.emote" ? `* ${bodyText}` : bodyText;
  if (replyContext) {
    relayContent = `${relayContent} ${replyContext}`;
  }

  const { webhook } = await getOrCreateWebhook(channel as BaseGuildTextChannel);
  if (!webhook) return;

  await webhook.send({
    content: relayContent,
    username,
    allowedMentions: { parse: [] }, // Prevent accidental Discord @mentions from Matrix text
  });
}
