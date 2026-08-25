// Parser diagnostics for a real WhatsApp export — prints coverage numbers,
// never message content. Participant names are masked unless --names is
// passed (for local use only).
//
//   node scripts/wa-doctor.mjs testdata/whatsapp-l/"WhatsApp Chat with L.txt" [--names]
import { readFileSync } from "fs";

const [, , path, flag] = process.argv;
if (!path) {
  console.error("usage: node scripts/wa-doctor.mjs <export.txt> [--names]");
  process.exit(1);
}
const { parseWhatsappExport } =
  await import("../src/ts/platforms/whatsapp/parse.ts");

const text = readFileSync(path, "utf8");
const chat = parseWhatsappExport(text);
const lines = text.split("\n").filter((l) => l.trim().length > 0).length;

/* Positional labels, not stars: a one-character name kept none of its stars
   and printed verbatim, and the star run leaked the name's length. Distinct
   people must also stay distinct — masking collided on shared prefixes. */
const labels = new Map();
const mask = (name) => {
  if (flag === "--names") return name;
  if (!labels.has(name)) labels.set(name, `Participant ${labels.size + 1}`);
  return labels.get(name);
};
const byType = {};
const bySender = {};
for (const m of chat.messages) {
  byType[m.mediaType] = (byType[m.mediaType] ?? 0) + 1;
  bySender[m.sender] = (bySender[m.sender] ?? 0) + 1;
}

console.log({
  nonEmptyLines: lines,
  messages: chat.messages.length,
  systemLines: chat.systemLineCount,
  unparsedLines: chat.unparsedLineCount,
  dateOrder: chat.dateOrder + (chat.dateOrderAmbiguous ? " (ambiguous!)" : ""),
  dateRange:
    chat.messages.length > 0
      ? new Date(chat.messages[0].timestamp).toISOString().slice(0, 10) +
        " → " +
        new Date(chat.messages[chat.messages.length - 1].timestamp)
          .toISOString()
          .slice(0, 10)
      : "n/a",
  participants: Object.fromEntries(
    Object.entries(bySender).map(([n, c]) => [mask(n), c]),
  ),
  mediaTypes: byType,
});
if (chat.unparsedSamples.length > 0) {
  console.log("unparsed samples (masked):");
  for (const s of chat.unparsedSamples) console.log(" ", s);
}
