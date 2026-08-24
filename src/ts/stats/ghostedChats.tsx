/**
 * "Gone quiet" — chats ranked by how long they've been dormant, measured from
 * the dataset's `fetchedAt` (never `Date.now()`, so results are deterministic).
 * `lastDirection` tells the UI whether you sent the last message (you got
 * ghosted) or they did.
 */

import { formatRelativeDays } from "./shared/formatDate";
import { PeerAvatar, PeerName } from "../media/avatars";
import { defineStat } from "./registry";
import { beatStyle, useInViewOnce, useReveal } from "./shared/reveal";
import type { Dataset, MessageDirection } from "../model/types";

const DAY_MS = 86_400_000;
const MAX_RESULTS = 10;

interface GhostedChat {
  chatId: string;
  title: string;
  username?: string;
  lastTimestamp: number;
  daysSinceLast: number;
  lastDirection: MessageDirection;
}

export interface GhostedChatsResult {
  chats: GhostedChat[];
}

function compute(dataset: Dataset): GhostedChatsResult {
  const { fetchedAt } = dataset.meta;

  const lastByChat = new Map<
    string,
    { timestamp: number; direction: MessageDirection }
  >();
  for (const message of dataset.messages) {
    const current = lastByChat.get(message.chatId);
    if (!current || message.timestamp > current.timestamp) {
      lastByChat.set(message.chatId, {
        timestamp: message.timestamp,
        direction: message.direction,
      });
    }
  }

  const chats: GhostedChat[] = [];
  for (const [chatId, last] of lastByChat) {
    chats.push({
      chatId,
      title: dataset.chats[chatId]?.title ?? chatId,
      username: dataset.chats[chatId]?.username,
      lastTimestamp: last.timestamp,
      daysSinceLast: Math.floor((fetchedAt - last.timestamp) / DAY_MS),
      lastDirection: last.direction,
    });
  }

  chats.sort((a, b) => b.daysSinceLast - a.daysSinceLast);
  return { chats: chats.slice(0, MAX_RESULTS) };
}

function Card({ result }: { result: GhostedChatsResult }) {
  const { live, settled } = useReveal();
  const animate = live && !settled;
  // Quiet dialect: rows just ease in one after another, no hero payoff.
  const { ref, seen } = useInViewOnce<HTMLUListElement>(animate);
  if (result.chats.length === 0) {
    return <p class="muted">No chats yet.</p>;
  }

  return (
    <ul class="ghosted-list" ref={ref}>
      {result.chats.map((chat, i) => (
        <li
          key={chat.chatId}
          class={`ghosted-item beat${seen ? " beat-in" : ""}${animate ? "" : " beat-settled"}`}
          style={beatStyle(i, 100)}
        >
          <PeerAvatar
            peerId={chat.chatId}
            title={chat.title}
            username={chat.username}
          />
          <span class="ghosted-body">
            <PeerName
              class="ghosted-title"
              peerId={chat.chatId}
              title={chat.title}
              username={chat.username}
            />
            <span class="muted">
              {formatRelativeDays(chat.daysSinceLast)}
              {" · "}
              {chat.lastDirection === "sent"
                ? "you sent the last message"
                : "they sent the last message"}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export const ghostedChats = defineStat<GhostedChatsResult>({
  id: "ghosted-chats",
  title: "Gone quiet",
  icon: "🌙",
  description: "Conversations that went dormant, and who spoke last.",
  compute,
  Card,
});
