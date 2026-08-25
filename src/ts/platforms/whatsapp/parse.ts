/**
 * Parser for WhatsApp "Export chat" text files. Pure and dependency-free so
 * it is trivially unit-testable; the builder turns parsed chats into the
 * common `Dataset`.
 *
 * Handles both export families —
 *   Android: `13/02/24, 21:44 - Ada: text`
 *   iOS:     `[13/02/24, 21:44:07] Ada: text`
 * — including 12-hour clocks, `.`/`-` date separators, year-first dates,
 * multiline messages (continuation lines), media placeholders/attachments,
 * and the invisible direction marks (U+200E/U+200F) both apps sprinkle in.
 *
 * Exports carry no timezone: timestamps are wall-clock on the exporting
 * phone. They are parsed as UTC so bucketing under `timezone: "UTC"`
 * reproduces the wall-clock the user actually experienced.
 */

import type { MediaType } from "../../model/types";

export interface ParsedMessage {
  timestamp: number; // epoch ms, wall-clock-as-UTC
  sender: string;
  text: string;
  mediaType: MediaType;
  /** Attachment filename when the export references one. */
  attachedFile?: string;
}

export type DateOrder = "dmy" | "mdy" | "ymd";

export interface ParsedChat {
  participants: string[]; // in order of first appearance
  messages: ParsedMessage[];
  systemLineCount: number; // timestamped lines without a sender (group events etc.)
  unparsedLineCount: number; // lines that matched nothing (excluding continuations)
  unparsedSamples: string[]; // structure-masked, capped
  dateOrder: DateOrder;
  dateOrderAmbiguous: boolean; // true when no field ever exceeded 12
}

/** Strip direction marks and normalize exotic spaces (iOS uses U+202F). */
function cleanLine(line: string): string {
  return line
    .replace(/[\u200e\u200f\u2068\u2069]/g, "")
    .replace(/[\u202f\u00a0]/g, " ")
    .replace(/\r$/, "");
}

// `[13/02/24, 21:44:07]` (iOS) or `13/02/24, 21:44` (Android), then the rest.
// Date fields may use / . or - and be 1-4 digits; time may carry seconds and
// an am/pm tail. The prefix must be anchored at line start.
const LINE_RE =
  /^(\[)?(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AaPp])?\.?\s?[Mm]?\.?(?:\])? [-–] |^(\[)(\d{1,4})[./-](\d{1,2})[./-](\d{1,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AaPp])?\.?\s?[Mm]?\.?\] /;

interface RawLine {
  d1: number;
  d2: number;
  d3: number;
  hour: number;
  minute: number;
  second: number;
  ampm: string | null;
  rest: string;
}

function matchLine(line: string): RawLine | null {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const ios = m[9] !== undefined;
  const o = ios ? 9 : 1;
  return {
    d1: Number(m[o + 1]),
    d2: Number(m[o + 2]),
    d3: Number(m[o + 3]),
    hour: Number(m[o + 4]),
    minute: Number(m[o + 5]),
    second: m[o + 6] ? Number(m[o + 6]) : 0,
    ampm: m[o + 7]?.toLowerCase() ?? null,
    rest: line.slice(m[0].length),
  };
}

function toYear(value: number): number {
  if (value >= 100) return value;
  return value < 70 ? 2000 + value : 1900 + value;
}

function toTimestamp(raw: RawLine, order: DateOrder): number {
  const [day, month, year] =
    order === "ymd"
      ? [raw.d3, raw.d2, raw.d1]
      : order === "mdy"
        ? [raw.d2, raw.d1, raw.d3]
        : [raw.d1, raw.d2, raw.d3];
  let hour = raw.hour;
  if (raw.ampm === "p" && hour < 12) hour += 12;
  if (raw.ampm === "a" && hour === 12) hour = 0;
  return Date.UTC(toYear(year), month - 1, day, hour, raw.minute, raw.second);
}

/** Trailing marker WhatsApp appends to the text of an edited message. */
const EDITED_TAG_RE = /\s*<This message was edited>$/;

/** Tombstones left behind by a message deleted after sending. */
const DELETED_RE = /^(?:You deleted this message|This message was deleted)\.?$/;

/** Media placeholders and attachment references, English exports. */
function detectMedia(text: string): {
  mediaType: MediaType;
  attachedFile?: string;
} {
  const t = text.trim();
  // A tombstone is not content: keep the message (it was sent, so it still
  // counts as activity) but classify it away from `text` so its placeholder
  // never lands in word, length, or emoji stats.
  if (DELETED_RE.test(t)) return { mediaType: "other" };
  if (t === "<Media omitted>") return { mediaType: "other" };
  if (t === "image omitted") return { mediaType: "photo" };
  if (t === "video omitted") return { mediaType: "video" };
  if (t === "GIF omitted") return { mediaType: "gif" };
  if (t === "sticker omitted") return { mediaType: "sticker" };
  if (t === "audio omitted") return { mediaType: "voice" };
  if (t === "document omitted") return { mediaType: "document" };
  if (t === "Contact card omitted") return { mediaType: "other" };

  const ios = /^<attached: (.+)>$/.exec(t);
  if (ios)
    return { mediaType: mediaFromFilename(ios[1]), attachedFile: ios[1] };
  const android = /^(\S+\.\w{2,4}) \(file attached\)$/.exec(t);
  if (android) {
    return {
      mediaType: mediaFromFilename(android[1]),
      attachedFile: android[1],
    };
  }
  return { mediaType: "text" };
}

function mediaFromFilename(name: string): MediaType {
  const upper = name.toUpperCase();
  // iOS attachment names embed the kind: `00000042-PHOTO-2024-01-01-....jpg`
  for (const [tag, type] of [
    ["-PHOTO-", "photo"],
    ["-VIDEO-", "video"],
    ["-AUDIO-", "voice"],
    ["-STICKER-", "sticker"],
    ["-GIF-", "gif"],
  ] as const) {
    if (upper.includes(tag)) return type;
  }
  const ext = /\.(\w{2,4})$/.exec(upper)?.[1] ?? "";
  if (["JPG", "JPEG", "PNG", "HEIC"].includes(ext)) return "photo";
  if (ext === "WEBP") return "sticker"; // WhatsApp stickers are webp
  if (["MP4", "MOV", "3GP"].includes(ext)) return "video";
  if (["OPUS", "M4A", "AAC", "OGG", "MP3"].includes(ext)) return "voice";
  if (ext === "GIF") return "gif";
  return "document";
}

/** Mask a line's words for diagnostics: keep structure, drop content. */
function maskLine(line: string): string {
  return line.replace(/\p{L}/gu, "x").replace(/\d/g, "9").slice(0, 80);
}

const MAX_UNPARSED_SAMPLES = 5;

export function parseWhatsappExport(text: string): ParsedChat {
  const lines = text.split("\n");

  // Pass 1: match every line, so the date order can be inferred from the
  // whole corpus before any timestamp is materialized.
  const raws: (RawLine | null)[] = lines.map((l) => matchLine(cleanLine(l)));
  let sawFirstOver12 = false;
  let sawSecondOver12 = false;
  let yearFirst = false;
  for (const raw of raws) {
    if (!raw) continue;
    if (raw.d1 >= 1000) yearFirst = true;
    else {
      if (raw.d1 > 12) sawFirstOver12 = true;
      if (raw.d2 > 12) sawSecondOver12 = true;
    }
  }
  const dateOrder: DateOrder = yearFirst
    ? "ymd"
    : sawSecondOver12 && !sawFirstOver12
      ? "mdy"
      : "dmy";
  const dateOrderAmbiguous = !yearFirst && !sawFirstOver12 && !sawSecondOver12;

  const participants: string[] = [];
  const messages: ParsedMessage[] = [];
  let systemLineCount = 0;
  let unparsedLineCount = 0;
  const unparsedSamples: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = raws[i];
    const line = cleanLine(lines[i]);
    if (!raw) {
      if (messages.length > 0 && line.length > 0) {
        // Continuation of a multiline message; the edit marker rides on the
        // final line, so it has to be stripped here too.
        const last = messages[messages.length - 1];
        last.text += `\n${line.replace(EDITED_TAG_RE, "")}`;
      } else if (line.length > 0) {
        unparsedLineCount++;
        if (unparsedSamples.length < MAX_UNPARSED_SAMPLES) {
          unparsedSamples.push(maskLine(line));
        }
      }
      continue;
    }

    const sep = raw.rest.indexOf(": ");
    if (sep <= 0) {
      systemLineCount++; // encryption notice, group events, missed calls…
      continue;
    }
    const sender = raw.rest.slice(0, sep);
    // The edit marker is WhatsApp's, not the sender's — strip it before the
    // text is measured or matched against a media placeholder.
    const body = raw.rest.slice(sep + 2).replace(EDITED_TAG_RE, "");
    const { mediaType, attachedFile } = detectMedia(body);

    if (!participants.includes(sender)) participants.push(sender);
    messages.push({
      timestamp: toTimestamp(raw, dateOrder),
      sender,
      text: mediaType === "text" ? body : "",
      mediaType,
      ...(attachedFile ? { attachedFile } : {}),
    });
  }

  return {
    participants,
    messages,
    systemLineCount,
    unparsedLineCount,
    unparsedSamples,
    dateOrder,
    dateOrderAmbiguous,
  };
}
