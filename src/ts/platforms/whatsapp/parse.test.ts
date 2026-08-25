import { describe, expect, it } from "vitest";

import { parseWhatsappExport } from "./parse";

const android = [
  "13/02/24, 21:44 - Ada: hey there",
  "13/02/24, 21:45 - Lin Wu: hi!",
  "14/02/24, 09:01 - Ada: multi",
  "line",
  "message",
  "14/02/24, 09:02 - Lin Wu: <Media omitted>",
  "15/02/24, 10:30 - Ada: IMG-20240215-WA0001.jpg (file attached)",
  "15/02/24, 10:31 - Lin Wu: STK-20240215-WA0002.webp (file attached)",
].join("\n");

const ios = [
  "[13/02/24, 21:44:07] Ada: hey there",
  "[13/02/24, 21:45:12] Lin Wu: hi!",
  "[14/02/24, 09:01:00] Ada: sticker omitted",
  "[14/02/24, 09:02:33] Lin Wu: <attached: 00000042-PHOTO-2024-02-14-09-02-33.jpg>",
].join("\n");

describe("parseWhatsappExport", () => {
  it("parses android exports with multiline messages", () => {
    const chat = parseWhatsappExport(android);
    expect(chat.participants).toEqual(["Ada", "Lin Wu"]);
    expect(chat.messages).toHaveLength(6);
    expect(chat.messages[2].text).toBe("multi\nline\nmessage");
    expect(chat.unparsedLineCount).toBe(0);
  });

  it("parses ios exports with bracketed seconds timestamps", () => {
    const chat = parseWhatsappExport(ios);
    expect(chat.messages).toHaveLength(4);
    expect(chat.messages[0].timestamp).toBe(Date.UTC(2024, 1, 13, 21, 44, 7));
  });

  it("detects media placeholders and typed attachments", () => {
    const a = parseWhatsappExport(android).messages;
    expect(a[3].mediaType).toBe("other"); // <Media omitted>
    expect(a[4].mediaType).toBe("photo"); // IMG-….jpg
    expect(a[5].mediaType).toBe("sticker"); // .webp
    expect(a[5].attachedFile).toBe("STK-20240215-WA0002.webp");
    const i = parseWhatsappExport(ios).messages;
    expect(i[2].mediaType).toBe("sticker"); // sticker omitted
    expect(i[3].mediaType).toBe("photo"); // -PHOTO- attachment
    expect(i.every((m) => m.mediaType === "text" || m.text === "")).toBe(true);
  });

  it("infers day-first vs month-first date order from the corpus", () => {
    const dmy = parseWhatsappExport("13/02/24, 21:44 - A: x");
    expect(dmy.dateOrder).toBe("dmy");
    expect(dmy.dateOrderAmbiguous).toBe(false);

    const mdy = parseWhatsappExport(
      ["02/13/24, 21:44 - A: x", "02/14/24, 08:00 - A: y"].join("\n"),
    );
    expect(mdy.dateOrder).toBe("mdy");
    expect(mdy.messages[0].timestamp).toBe(Date.UTC(2024, 1, 13, 21, 44));

    const ambiguous = parseWhatsappExport("03/04/24, 21:44 - A: x");
    expect(ambiguous.dateOrder).toBe("dmy"); // default
    expect(ambiguous.dateOrderAmbiguous).toBe(true);
  });

  it("handles 12-hour clocks and year-first dates", () => {
    const chat = parseWhatsappExport(
      [
        "2024-02-13, 9:44 PM - A: evening",
        "2024-02-14, 12:05 AM - A: past midnight",
      ].join("\n"),
    );
    expect(chat.dateOrder).toBe("ymd");
    expect(chat.messages[0].timestamp).toBe(Date.UTC(2024, 1, 13, 21, 44));
    expect(chat.messages[1].timestamp).toBe(Date.UTC(2024, 1, 14, 0, 5));
  });

  it("counts system lines separately and masks unparsed samples", () => {
    const chat = parseWhatsappExport(
      [
        "13/02/24, 21:40 - Messages and calls are end-to-end encrypted.",
        "13/02/24, 21:44 - Ada: hello",
        "", // blank lines are ignored
      ].join("\n"),
    );
    expect(chat.systemLineCount).toBe(1);
    expect(chat.messages).toHaveLength(1);
    expect(chat.unparsedLineCount).toBe(0);

    const junk = parseWhatsappExport("Secret rendezvous at 5pm");
    expect(junk.unparsedLineCount).toBe(1);
    expect(junk.unparsedSamples[0]).not.toContain("Secret");
    expect(junk.unparsedSamples[0]).toContain("x");
  });

  it("strips direction marks before matching", () => {
    const chat = parseWhatsappExport(
      "‎[13/02/24, 21:44:07] Ada: ‎image omitted",
    );
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].mediaType).toBe("photo");
  });

  it("strips WhatsApp's own edit marker from the text", () => {
    const chat = parseWhatsappExport(
      [
        "13/02/24, 21:44 - Ada: second thoughts <This message was edited>",
        "13/02/24, 21:45 - Ada: over",
        "several lines <This message was edited>",
      ].join("\n"),
    );
    expect(chat.messages[0].text).toBe("second thoughts");
    expect(chat.messages[1].text).toBe("over\nseveral lines");
  });

  /* A deleted message still happened — it stays as activity, but its
     tombstone must never be measured as something the sender wrote. */
  it("keeps deleted messages without counting their tombstone as text", () => {
    const chat = parseWhatsappExport(
      [
        "13/02/24, 21:44 - Ada: You deleted this message",
        "13/02/24, 21:45 - Lin Wu: This message was deleted",
      ].join("\n"),
    );
    expect(chat.messages).toHaveLength(2);
    expect(chat.messages.map((m) => m.mediaType)).toEqual(["other", "other"]);
    expect(chat.messages.map((m) => m.text)).toEqual(["", ""]);
  });
});
