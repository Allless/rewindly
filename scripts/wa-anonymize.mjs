// Turns a real WhatsApp export into a structure-preserving fake one, so a
// realistic fixture can exist without anyone's actual conversation in it.
//
// Preserved (this is what the parser and the stats are measured on):
//   export dialect (iOS/Android, 12h/24h, seconds, date order, separators),
//   message and line counts, senders, multi-line shapes, media placeholders,
//   attachment kinds, tombstones, edit markers, word and character lengths,
//   emoji frequency distribution, weekday and time-of-day.
// Replaced: every name, every word, every URL, emoji identities, and the
//   absolute dates (shifted whole weeks, so weekday/hour survive intact).
//
//   node scripts/wa-anonymize.mjs <export.txt> [--out <file>] [--seed N]
//                                 [--shift-weeks N]
//
// Deterministic for a given seed. Prints only counts, never content.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, basename, join } from "path";

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
if (!input) {
  console.error(
    "usage: node scripts/wa-anonymize.mjs <export.txt> [--out <file>] [--seed N] [--shift-weeks N]",
  );
  process.exit(1);
}
const seed = Number(opt("seed", 1));
const shiftWeeks = Number(opt("shift-weeks", 52));
/* Emoji are the least identifying content and drive a whole slide, so
   keeping the real ones is offered for a local fixture. */
const keepEmoji = args.includes("--keep-emoji");

/* Seeded PRNG: same seed in, same fixture out, so a committed artifact is
   reproducible from the original rather than a one-off blob. */
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seed);
const pick = (list) => list[Math.floor(rand() * list.length)];

// Same prefix grammar as src/ts/platforms/whatsapp/parse.ts — kept local so
// the parser needs no internals exported. Groups: date, time, tail.
const PREFIX_RE =
  /^(‎?\[?)(\d{1,4})([./-])(\d{1,2})([./-])(\d{1,4})(,? )(\d{1,2}):(\d{2})(?::(\d{2}))?(\s?[AaPp]\.?\s?[Mm]?\.?)?(\]? [-–] |\] )/;

const CONSONANTS = "bcdfghjklmnprstvwz".split("");
const VOWELS = "aeiou".split("");
/* Generated, not hand-listed: the substitution is a bijection, so a pool
   smaller than the corpus's distinct-emoji count silently merges two emoji
   into one and dents the frequency distribution. */
const codePoints = (from, to) => {
  const out = [];
  for (let c = from; c <= to; c++) out.push(String.fromCodePoint(c));
  return out;
};
const EMOJI_POOL = [
  ...codePoints(0x1f600, 0x1f64f), // emoticons
  ...codePoints(0x1f400, 0x1f4fd), // animals, objects
  ...codePoints(0x1f680, 0x1f6c0), // transport
  ...codePoints(0x1f910, 0x1f9ff), // supplemental
  ...codePoints(0x2600, 0x26ff), // misc symbols (BMP)
  ...codePoints(0x2700, 0x27bf), // dingbats (BMP)
  ...codePoints(0x2600, 0x26ff).map((c) => `${c}️`), // BMP + selector
  ...codePoints(0x1f600, 0x1f64f).map((c) => `${c}️`), // astral + selector
];

/** A pronounceable nonsense word of exactly `len` characters. */
function fakeWord(len) {
  let out = "";
  while (out.length < len) {
    out += pick(CONSONANTS);
    if (out.length < len) out += pick(VOWELS);
  }
  return out.slice(0, len);
}

/* Stable bijections: the same real name/emoji always maps to the same fake
   one, so frequency distributions (top contact, top emoji) keep their exact
   shape while the identities are gone. */
const names = new Map();
const nameFor = (real) => {
  if (!names.has(real)) names.set(real, `Person ${names.size + 1}`);
  return names.get(real);
};
/* Substitute within a same-length bucket: an emoji carrying a variation
   selector is longer than a bare one, and swapping across lengths would
   quietly change every message's character count. */
const EMOJI_BY_LEN = new Map();
for (const e of EMOJI_POOL) {
  const bucket = EMOJI_BY_LEN.get(e.length) ?? [];
  bucket.push(e);
  EMOJI_BY_LEN.set(e.length, bucket);
}
const emoji = new Map();
const usedFakes = new Set();
let emojiCollisions = 0;
const emojiFor = (real) => {
  if (keepEmoji) return real;
  if (!emoji.has(real)) {
    const bucket = EMOJI_BY_LEN.get(real.length) ?? [];
    // Take the first unused entry of the right length, so distinct emoji stay
    // distinct and the frequency distribution is carried over exactly.
    const free = bucket.find((e) => !usedFakes.has(e));
    let fake = free;
    if (!fake) {
      // Long ZWJ sequences have no same-length entry: keep the character
      // length by filling with 2-unit emoji rather than distorting it.
      emojiCollisions++;
      fake = (EMOJI_BY_LEN.get(2) ?? EMOJI_POOL)
        .slice(0, Math.max(1, Math.round(real.length / 2)))
        .join("");
    }
    usedFakes.add(fake);
    emoji.set(real, fake);
  }
  return emoji.get(real);
};

const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;
const URL_RE = /https?:\/\/\S+/g;
const EDITED_RE = /\s*<This message was edited>$/;

const PLACEHOLDERS = new Set([
  "<Media omitted>",
  "image omitted",
  "video omitted",
  "GIF omitted",
  "sticker omitted",
  "audio omitted",
  "document omitted",
  "Contact card omitted",
  "You deleted this message",
  "This message was deleted",
  "null",
]);

/** Attachment references keep their kind and extension, lose the filename. */
function fakeAttachment(body) {
  const ios = /^<attached: (.+)>$/.exec(body);
  if (ios) return `<attached: ${fakeFilename(ios[1])}>`;
  const android = /^(\S+\.\w{2,4}) \(file attached\)$/.exec(body);
  if (android) return `${fakeFilename(android[1])} (file attached)`;
  return null;
}
function fakeFilename(name) {
  const ext = /\.(\w{2,4})$/.exec(name)?.[1] ?? "bin";
  const tag = ["-PHOTO-", "-VIDEO-", "-AUDIO-", "-STICKER-", "-GIF-"].find((t) =>
    name.toUpperCase().includes(t),
  );
  const n = String(Math.floor(rand() * 9000) + 1000);
  return tag ? `000000${n}${tag}2024-01-01-00-00-00.${ext}` : `FILE-${n}.${ext}`;
}

/* One fake word per real word, so vocabulary size and word-frequency shape
   (what `textingStyles` measures) survive. That makes the output a
   substitution cipher over the original — fine for a local fixture, NOT for
   a public one, since preserved lengths and frequencies are what classical
   cryptanalysis needs. `--public` gives every occurrence its own fake word,
   which breaks that at the cost of the vocabulary stats. */
const stableWords = !args.includes("--public");
const vocab = new Map();
function wordFor(real) {
  if (!stableWords) return fakeWord([...real].length);
  const key = real.toLowerCase();
  if (!vocab.has(key)) vocab.set(key, fakeWord([...real].length));
  return vocab.get(key);
}

/** A URL of exactly `len` characters, so message lengths are untouched. */
function fakeUrl(len) {
  const base = "https://example.com/";
  if (len <= base.length) return base.slice(0, len);
  return base + fakeWord(len - base.length);
}

/** Replace content while keeping every length, count, and separator. */
function fakeText(text) {
  let out = text.replace(URL_RE, (u) => fakeUrl(u.length));
  out = out.replace(EMOJI_RE, (m) => emojiFor(m));
  // Digits are content too — ages, prices, addresses, codes, phone numbers.
  // Only the count and position of a number survive, never its value.
  out = out.replace(/\d/g, () => String(Math.floor(rand() * 10)));
  // Word-shaped runs only: punctuation, spacing and digits keep their places.
  return out.replace(/\p{L}[\p{L}\p{M}']*/gu, (w) => {
    const word = wordFor(w);
    return w[0] === w[0].toUpperCase() && [...w].length > 1
      ? word[0].toUpperCase() + word.slice(1)
      : word;
  });
}

const text = readFileSync(input, "utf8");
const lines = text.split("\n");

/* Which field is the day has to be settled across the whole file before any
   date is rewritten — exactly as the parser infers it. Getting this wrong
   silently rewrites months as days and scrambles the chronology. */
const prefixes = lines.map((l) => PREFIX_RE.exec(l));
let yearFirst = false;
let firstOver12 = false;
let secondOver12 = false;
for (const m of prefixes) {
  if (!m) continue;
  if (m[2].length === 4) yearFirst = true;
  else {
    if (Number(m[2]) > 12) firstOver12 = true;
    if (Number(m[4]) > 12) secondOver12 = true;
  }
}
const dateOrder = yearFirst
  ? "ymd"
  : secondOver12 && !firstOver12
    ? "mdy"
    : "dmy";

/* Whole-week shift: absolute dates move, weekday and time-of-day do not —
   the heatmap and night-owl stats stay exactly as they were. */
const shiftDays = shiftWeeks * 7;
function shiftDate(y, m, d) {
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() - shiftDays);
  return [at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate()];
}
const pad = (value, sample) => String(value).padStart(sample.length, "0");

let messages = 0;
let systemLines = 0;
let continuations = 0;

const out = lines.map((line) => {
  const m = PREFIX_RE.exec(line);
  if (!m) {
    if (line.trim().length > 0) continuations++;
    return line.trim().length > 0 ? fakeText(line.replace(EDITED_RE, "")) : line;
  }

  const [, open, a, sepA, b, sepB, c, comma, hh, mm, ss, ampm, tail] = m;
  const nums = [Number(a), Number(b), Number(c)];
  // Decode into real day/month/year using the order inferred for the file…
  const [day, month, rawYear] =
    dateOrder === "ymd"
      ? [nums[2], nums[1], nums[0]]
      : dateOrder === "mdy"
        ? [nums[1], nums[0], nums[2]]
        : [nums[0], nums[1], nums[2]];
  const year = rawYear < 100 ? (rawYear < 70 ? 2000 : 1900) + rawYear : rawYear;
  const [ny, nm, nd] = shiftDate(year, month, day);
  const outYear = rawYear < 100 ? ny % 100 : ny;
  // …then re-render into the same field positions, so the dialect survives.
  const fields =
    dateOrder === "ymd"
      ? [outYear, nm, nd]
      : dateOrder === "mdy"
        ? [nm, nd, outYear]
        : [nd, nm, outYear];
  const rebuilt = `${pad(fields[0], a)}${sepA}${pad(fields[1], b)}${sepB}${pad(fields[2], c)}`;
  const stamp = `${open}${rebuilt}${comma}${hh}:${mm}${ss ? `:${ss}` : ""}${ampm ?? ""}${tail}`;

  const rest = line.slice(m[0].length);
  const sep = rest.indexOf(": ");
  if (sep <= 0) {
    systemLines++;
    // System lines name people ("X added Y"); swap any known participant.
    let masked = rest;
    for (const [real, fake] of names) masked = masked.split(real).join(fake);
    return `${stamp}${masked}`;
  }

  messages++;
  const sender = nameFor(rest.slice(0, sep));
  let body = rest.slice(sep + 2);
  const edited = EDITED_RE.test(body);
  body = body.replace(EDITED_RE, "");
  const trimmed = body.trim();

  let fake;
  if (PLACEHOLDERS.has(trimmed)) fake = body;
  else fake = fakeAttachment(trimmed) ?? fakeText(body);

  return `${stamp}${sender}: ${fake}${edited ? " <This message was edited>" : ""}`;
});

// The filename carries a name too ("WhatsApp Chat with L.txt").
let outPath = opt("out", null);
if (!outPath) {
  const stem = basename(input).replace(/\.txt$/i, "");
  const who = /whatsapp chat with (.+)$/i.exec(stem)?.[1];
  const renamed = who
    ? `WhatsApp Chat with ${names.get(who) ?? "Person 2"}.txt`
    : `anonymized-${seed}.txt`;
  outPath = join(dirname(input), "..", "whatsapp-anon", renamed);
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out.join("\n"), "utf8");

console.log({
  out: outPath,
  messages,
  systemLines,
  continuationLines: continuations,
  participants: names.size,
  distinctEmoji: keepEmoji ? "kept" : emoji.size,
  emojiLengthFallbacks: emojiCollisions,
  shiftWeeks,
  seed,
});
