/**
 * Ingestion orchestration: turns a connected gramjs client into a normalized
 * `Dataset`. This is the ONLY Telegram-aware module. gramjs objects are coerced
 * into the plain `Raw*` shapes and handed to the pure normalizers, so the
 * testable logic lives in `normalize.ts`; this file is the intentionally-untested
 * glue (it needs a live client). gramjs values arrive as `unknown` and are
 * narrowed defensively before use.
 */

import type { TelegramClient } from "telegram";

import type {
  Chat,
  Contact,
  Dataset,
  Message,
  PeerId,
} from "../../model/types";
import { floodWaitSeconds, withFloodRetry } from "./backoff";
import {
  mediaKindOf,
  normalizeMessage,
  normalizePeerToChat,
  normalizePeerToContact,
  type RawMessage,
  type RawPeer,
  type RawReaction,
} from "./normalize";

export interface IngestOptions {
  onProgress?: (p: {
    chatsDone: number;
    chatsTotal: number;
    messages: number;
    /** Present while Telegram rate-limits us — seconds it mandated. */
    waitSeconds?: number;
  }) => void;
  maxMessagesPerChat?: number;
  /** Only ingest messages newer than this many days ago. Default 365. */
  sinceDaysAgo?: number;
  signal?: AbortSignal;
}

const DEFAULT_MAX_PER_CHAT = 5000;
const DEFAULT_SINCE_DAYS = 365;
const SECONDS_PER_DAY = 24 * 60 * 60;

/** Minimal structural view of the gramjs client surface we depend on. */
interface DialogLike {
  entity?: unknown;
  id?: unknown;
  name?: unknown;
  title?: unknown;
  date?: unknown; // last-message date (epoch seconds)
  message?: unknown; // the latest message
  isUser?: boolean;
  isGroup?: boolean;
  isChannel?: boolean;
}
interface ClientSurface {
  getMe(): Promise<unknown>;
  getDialogs(params?: { limit?: number }): Promise<Iterable<DialogLike>>;
  iterMessages(
    entity: unknown,
    params?: { limit?: number; fromUser?: string; offsetId?: number },
  ): AsyncIterable<unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  // gramjs ids are `big-integer` Integer objects, not native bigint: stringify
  // any object whose text form is a plain integer.
  if (typeof value === "object" && value !== null) {
    const text = String(value);
    if (/^-?\d+$/.test(text)) return text;
  }
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && value !== null) {
    const parsed = Number(String(value));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

type PeerKind = RawPeer["kind"];

function dialogKind(dialog: DialogLike): PeerKind {
  if (dialog.isUser) return "user";
  if (dialog.isChannel) return "channel";
  return "group";
}

function peerId(kind: PeerKind, rawId: string): PeerId {
  return kind === "user" ? `user:${rawId}` : `chat:${rawId}`;
}

function reactionCountOf(record: Record<string, unknown>): number {
  const reactions = asRecord(record.reactions);
  const results = reactions?.results;
  if (!Array.isArray(results)) return 0;
  return results.reduce<number>((sum, entry) => {
    const count = readNumber(asRecord(entry)?.count) ?? 0;
    return sum + count;
  }, 0);
}

/**
 * Standard-emoji reaction tallies. `chosenOrder` is present exactly when the
 * current account picked that reaction. Custom/premium emoji reactions
 * (`ReactionCustomEmoji`) carry a document id instead of a glyph — skipped.
 */
function reactionsOf(
  record: Record<string, unknown>,
): RawReaction[] | undefined {
  const results = asRecord(record.reactions)?.results;
  if (!Array.isArray(results)) return undefined;

  const reactions: RawReaction[] = [];
  for (const entry of results) {
    const result = asRecord(entry);
    if (!result) continue;
    const emoticon = readString(asRecord(result.reaction)?.emoticon);
    const count = readNumber(result.count) ?? 0;
    if (!emoticon || count <= 0) continue;
    reactions.push({
      emoticon,
      count,
      chosen: result.chosenOrder !== undefined && result.chosenOrder !== null,
    });
  }
  return reactions.length > 0 ? reactions : undefined;
}

function toRawMessage(
  raw: unknown,
  chatId: PeerId,
  selfId: PeerId | undefined,
): RawMessage | null {
  const record = asRecord(raw);
  if (!record) return null;

  const messageId = readNumber(record.id);
  const date = readNumber(record.date);
  if (messageId === undefined || date === undefined) return null;

  const fromSelf = readBoolean(record.out);
  const senderRaw = readString(record.senderId);
  const senderId: PeerId = fromSelf
    ? (selfId ?? chatId)
    : senderRaw
      ? `user:${senderRaw}`
      : chatId;

  const media = asRecord(record.media);
  const replyTo = asRecord(record.replyTo);

  const rawMessage: RawMessage = {
    chatId,
    messageId,
    senderId,
    fromSelf,
    date,
    text: readString(record.message),
    media: mediaKindOf(media),
    reactionCount: reactionCountOf(record),
  };

  const reactions = reactionsOf(record);
  if (reactions !== undefined) {
    rawMessage.reactions = reactions;
  }

  const documentId = readString(asRecord(media?.document)?.id);
  if (documentId !== undefined) {
    rawMessage.mediaId = documentId;
  }

  const replyToMessageId = readNumber(replyTo?.replyToMsgId);
  if (replyToMessageId !== undefined) {
    rawMessage.replyToMessageId = replyToMessageId;
  }
  const editDate = readNumber(record.editDate);
  if (editDate !== undefined) {
    rawMessage.editDate = editDate;
  }

  return rawMessage;
}

async function resolveSelf(
  api: ClientSurface,
): Promise<{ contact: Contact; id: PeerId } | null> {
  const me = asRecord(await api.getMe());
  const rawId = readString(me?.id);
  if (!rawId) return null;
  const id = peerId("user", rawId);
  const rawPeer: RawPeer = {
    id,
    kind: "user",
    title: readString(me?.firstName) ?? "Me",
    username: readString(me?.username),
    isSelf: true,
  };
  return { contact: normalizePeerToContact(rawPeer), id };
}

/**
 * In-memory map of sticker/gif document id → the raw gramjs message that
 * contained it, so the top results can be downloaded on demand for display.
 * Not serialized/cached: the file references it holds are only valid for the
 * current session, so images load right after a fresh ingest, not from cache.
 */
export type MediaRefs = Map<string, unknown>;

/**
 * In-memory map of peer id → the raw gramjs entity, so profile photos can be
 * downloaded on demand for display. Like `MediaRefs`, session-only and never
 * serialized.
 */
export type PeerRefs = Map<PeerId, unknown>;

/**
 * In-memory map of message id → the raw gramjs message, kept for reacted
 * media messages so "Greatest hits" can render their photos/videos.
 * Session-only, like the other ref maps.
 */
export type HitRefs = Map<string, unknown>;

export interface IngestResult {
  dataset: Dataset;
  mediaRefs: MediaRefs;
  peerRefs: PeerRefs;
  hitRefs: HitRefs;
}

/**
 * Rebuild the peer-entity map with a single getDialogs call — used when the
 * dataset comes from cache, so profile photos still resolve without a full
 * re-ingest.
 */
export async function fetchPeerRefs(client: TelegramClient): Promise<PeerRefs> {
  const api = client as unknown as ClientSurface;
  const peerRefs: PeerRefs = new Map();
  for (const dialog of await api.getDialogs()) {
    const rawId =
      readString(dialog.id) ?? readString(asRecord(dialog.entity)?.id);
    if (!rawId || !dialog.entity) continue;
    peerRefs.set(peerId(dialogKind(dialog), rawId), dialog.entity);
  }
  return peerRefs;
}

export async function ingest(
  client: TelegramClient,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  // gramjs silently sleeps through FLOOD_WAITs below its threshold (60s by
  // default), which reads as a hang. Surface every wait instead — the
  // loading screen owns the countdown — and restore the client afterwards.
  const tunable = client as unknown as { floodSleepThreshold?: number };
  const savedThreshold = tunable.floodSleepThreshold;
  tunable.floodSleepThreshold = 0;
  try {
    return await runIngest(client, opts);
  } finally {
    tunable.floodSleepThreshold = savedThreshold;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function runIngest(
  client: TelegramClient,
  opts: IngestOptions,
): Promise<IngestResult> {
  const api = client as unknown as ClientSurface;
  const onWait = (waitSeconds: number, chatsDone = 0, chatsTotal = 0) =>
    opts.onProgress?.({
      chatsDone,
      chatsTotal,
      messages: 0,
      waitSeconds,
    });
  const maxPerChat = opts.maxMessagesPerChat ?? DEFAULT_MAX_PER_CHAT;
  const sinceDays = opts.sinceDaysAgo ?? DEFAULT_SINCE_DAYS;
  const cutoffSeconds =
    Math.floor(Date.now() / 1000) - sinceDays * SECONDS_PER_DAY;

  const self = await withFloodRetry(() => resolveSelf(api), {
    onWait: (s) => onWait(s),
  });
  const selfContact: Contact = self?.contact ?? {
    id: "user:self",
    displayName: "Me",
    isSelf: true,
  };
  const selfId = self?.id;

  const contacts: Record<PeerId, Contact> = { [selfContact.id]: selfContact };
  const chats: Record<PeerId, Chat> = {};
  const messages: Message[] = [];
  const mediaRefs: MediaRefs = new Map();
  const peerRefs: PeerRefs = new Map();
  const hitRefs: HitRefs = new Map();
  let partial = false;

  // Drop dialogs with no activity in the window up front — this avoids a
  // GetHistory (and its FLOOD_WAIT) for every long-dormant chat, and makes
  // the progress total match the real workload.
  const dialogs = Array.from(
    await withFloodRetry(() => api.getDialogs(), {
      onWait: (s) => onWait(s),
    }),
  ).filter((dialog) => {
    const lastActivity =
      readNumber(dialog.date) ?? readNumber(asRecord(dialog.message)?.date);
    return lastActivity === undefined || lastActivity >= cutoffSeconds;
  });
  const chatsTotal = dialogs.length;

  for (let index = 0; index < dialogs.length; index++) {
    if (opts.signal?.aborted) {
      partial = true;
      break;
    }

    const dialog = dialogs[index];
    const kind = dialogKind(dialog);
    const rawId =
      readString(dialog.id) ?? readString(asRecord(dialog.entity)?.id);
    if (!rawId) continue;

    const chatId = peerId(kind, rawId);
    const title = readString(dialog.name) ?? readString(dialog.title) ?? chatId;
    const entity = asRecord(dialog.entity);

    const chatPeer: RawPeer = {
      id: chatId,
      kind,
      title,
      username: readString(entity?.username),
      isBot: entity?.bot === true,
      memberCount: readNumber(entity?.participantsCount),
    };
    chats[chatId] = normalizePeerToChat(chatPeer);
    if (dialog.entity) peerRefs.set(chatId, dialog.entity);
    if (kind === "user") {
      contacts[chatId] = normalizePeerToContact({
        id: chatId,
        kind,
        title,
        username: readString(entity?.username),
      });
    }

    // Private chats: fetch both sides (needed for response-time/ghosting stats).
    // Groups & channels: fetch only *your* messages, server-side filtered — far
    // cheaper, and pulling every stranger's messages isn't meaningful here.
    const messageParams: { limit: number; fromUser?: string } = {
      limit: maxPerChat,
    };
    if (kind !== "user") messageParams.fromUser = "me";

    // Paging is resumable: a FLOOD_WAIT thrown mid-chat reports the mandated
    // pause, sleeps it out, and re-opens the iterator just below the last
    // message seen instead of failing the whole ingest.
    let perChat = 0;
    let offsetId: number | undefined;
    let chatDone = false;
    while (!chatDone) {
      try {
        for await (const rawMsg of api.iterMessages(dialog.entity, {
          ...messageParams,
          offsetId,
        })) {
          if (opts.signal?.aborted) {
            partial = true;
            break;
          }
          const msgId = readNumber(asRecord(rawMsg)?.id);
          if (msgId !== undefined) offsetId = msgId;
          const raw = toRawMessage(rawMsg, chatId, selfId);
          if (raw) {
            // Messages arrive newest-first; once we cross the window, the rest of
            // this chat is older too, so stop paging it. This is the main guard
            // against deep history and the FLOOD_WAIT it causes.
            if (raw.date < cutoffSeconds) break;
            const normalized = normalizeMessage(raw);
            messages.push(normalized);
            // Keep one downloadable reference per unique sticker/gif for display.
            if (
              normalized.mediaId &&
              (normalized.mediaType === "sticker" ||
                normalized.mediaType === "gif") &&
              !mediaRefs.has(normalized.mediaId)
            ) {
              mediaRefs.set(normalized.mediaId, rawMsg);
            }
            // Keep refs for reacted media messages — "Greatest hits" candidates.
            if (
              normalized.reactionCount > 0 &&
              normalized.mediaType !== "text" &&
              normalized.direction === "sent"
            ) {
              hitRefs.set(normalized.id, rawMsg);
            }
            // Attribute unknown non-self senders in groups as contacts lazily.
            if (!contacts[raw.senderId]) {
              contacts[raw.senderId] = {
                id: raw.senderId,
                displayName: raw.senderId,
                isSelf: raw.senderId === selfId,
              };
            }
          }
          perChat++;
          if (perChat >= maxPerChat) {
            partial = true;
            break;
          }
        }
        chatDone = true;
      } catch (err) {
        const waitSeconds = floodWaitSeconds(err);
        if (waitSeconds === null) throw err;
        opts.onProgress?.({
          chatsDone: index,
          chatsTotal,
          messages: messages.length,
          waitSeconds,
        });
        await sleep(waitSeconds * 1000);
      }
    }

    opts.onProgress?.({
      chatsDone: index + 1,
      chatsTotal,
      messages: messages.length,
    });
  }

  messages.sort((a, b) => a.timestamp - b.timestamp);

  const dataset: Dataset = {
    self: selfContact,
    contacts,
    chats,
    messages,
    meta: {
      fetchedAt: Date.now(),
      messageCount: messages.length,
      dateRange: {
        from: messages[0]?.timestamp ?? Date.now(),
        to: messages[messages.length - 1]?.timestamp ?? Date.now(),
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      partial,
    },
  };

  return { dataset, mediaRefs, peerRefs, hitRefs };
}
