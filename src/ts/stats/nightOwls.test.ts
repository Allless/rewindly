import { describe, expect, it } from "vitest";

import { nightOwls } from "./nightOwls";
import type { Dataset, Message, MessageDirection } from "../model/types";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** A message at `hour` local (UTC dataset) on day `day`. */
function at(
  hour: number,
  day: number,
  index: number,
  chatId = "c",
  direction: MessageDirection = "sent",
): Message {
  return {
    id: `${chatId}:${index}`,
    chatId,
    senderId: direction === "sent" ? "user:1" : "user:2",
    direction,
    timestamp: Date.UTC(2025, 0, 1) + day * DAY + hour * HOUR,
    text: "",
    charCount: 0,
    wordCount: 0,
    mediaType: "text",
    reactionCount: 0,
  };
}

function makeDataset(messages: Message[]): Dataset {
  return {
    self: { id: "user:1", displayName: "Me", isSelf: true },
    contacts: {},
    chats: {
      c: { id: "c", type: "private", title: "Owl" },
      d: { id: "d", type: "private", title: "Lark" },
      g: { id: "g", type: "group", title: "Group" },
    },
    messages,
    meta: {
      fetchedAt: Date.UTC(2025, 2, 1),
      messageCount: messages.length,
      dateRange: { from: 0, to: 0 },
      timezone: "UTC",
      partial: false,
    },
  };
}

describe("nightOwls.compute", () => {
  it("ranks chats by their share of after-dark messages", () => {
    const messages: Message[] = [];
    // "c": 60 messages, all at 01:00 → pure night owl
    for (let i = 0; i < 60; i++) messages.push(at(1, i, i, "c"));
    // "d": 60 messages at 07:00 → morning
    for (let i = 0; i < 60; i++) messages.push(at(7, i, i + 100, "d"));

    const result = nightOwls.compute(makeDataset(messages));
    expect(result.nightOwls.map((r) => r.chatId)).toEqual(["c"]);
    expect(result.nightOwls[0].share).toBe(1);
    expect(result.earlyBirds.map((r) => r.chatId)).toEqual(["d"]);
  });

  it("counts 00:00–03:59 as night; 23:00 and the 4–5am gap as neither", () => {
    const messages: Message[] = [];
    for (let i = 0; i < 25; i++) messages.push(at(0, i, i, "c"));
    for (let i = 0; i < 25; i++) messages.push(at(3, i, i + 50, "c"));
    for (let i = 0; i < 10; i++) messages.push(at(23, i, i + 100, "c"));
    for (let i = 0; i < 10; i++) messages.push(at(4, i, i + 150, "c"));

    const result = nightOwls.compute(makeDataset(messages));
    expect(result.nightOwls[0].share).toBeCloseTo(50 / 70);
    expect(result.earlyBirds).toEqual([]);
  });

  it("ignores groups and keeps thin chats out of the share ranking", () => {
    const messages: Message[] = [];
    for (let i = 0; i < 60; i++) messages.push(at(1, i, i, "g"));
    for (let i = 0; i < 6; i++) messages.push(at(1, i, i + 100, "c"));

    const result = nightOwls.compute(makeDataset(messages));
    expect(result.nightOwls).toEqual([]);
    // …but a small, wholly nocturnal chat is its own story
    expect(result.afterDarkOnly.map((r) => r.chatId)).toEqual(["c"]);
    expect(result.afterDarkOnly[0]).toMatchObject({
      messages: 6,
      nightMessages: 6,
    });
  });

  it("needs enough night messages before a chat can rank by share", () => {
    const messages: Message[] = [];
    // 60 messages, only 5 at night → 8%, and below the night-message floor
    for (let i = 0; i < 5; i++) messages.push(at(1, i, i, "c"));
    for (let i = 0; i < 55; i++) messages.push(at(14, i, i + 100, "c"));

    const result = nightOwls.compute(makeDataset(messages));
    expect(result.nightOwls).toEqual([]);
    expect(result.afterDarkOnly).toEqual([]); // not small, not nocturnal
  });

  it("reports your own night share across all chats", () => {
    const messages = [
      ...Array.from({ length: 3 }, (_, i) => at(2, i, i, "c", "sent")),
      ...Array.from({ length: 1 }, (_, i) => at(14, i, i + 50, "c", "sent")),
      at(2, 0, 99, "c", "received"), // theirs — not counted as yours
    ];
    const result = nightOwls.compute(makeDataset(messages));
    expect(result.yourNightShare).toBeCloseTo(0.75);
  });
});
