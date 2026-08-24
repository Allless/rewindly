/**
 * Top DMs and Top groups — the same ranking, split by chat type. Groups and
 * channels only contain your own messages (ingestion filters to "me" there),
 * so the group card ranks and reports what *you* posted, while the DM card
 * shows both directions.
 */

import type { Chat, Dataset } from "../model/types";
import { PeerAvatar, PeerName } from "../media/avatars";
import { defineStat } from "./registry";
import { beatStyle, useInViewOnce, useReveal } from "./shared/reveal";

export interface TopChat {
  chatId: string;
  title: string;
  username?: string;
  messages: number;
  wordsSent: number;
  wordsReceived: number;
  sent: number;
  received: number;
}

export interface TopContactsResult {
  chats: TopChat[];
}

const MAX_CHATS = 10;

function computeTop(
  dataset: Dataset,
  includeType: (type: Chat["type"] | undefined) => boolean,
  rank: (chat: TopChat) => number,
): TopContactsResult {
  const byChat = new Map<string, TopChat>();

  for (const message of dataset.messages) {
    if (!includeType(dataset.chats[message.chatId]?.type)) continue;

    const existing =
      byChat.get(message.chatId) ??
      ({
        chatId: message.chatId,
        title: dataset.chats[message.chatId]?.title ?? message.chatId,
        username: dataset.chats[message.chatId]?.username,
        messages: 0,
        wordsSent: 0,
        wordsReceived: 0,
        sent: 0,
        received: 0,
      } satisfies TopChat);

    existing.messages += 1;
    if (message.direction === "sent") {
      existing.wordsSent += message.wordCount;
      existing.sent += 1;
    } else {
      existing.wordsReceived += message.wordCount;
      existing.received += 1;
    }

    byChat.set(message.chatId, existing);
  }

  const chats = [...byChat.values()]
    .filter((chat) => rank(chat) > 0)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, MAX_CHATS);

  return { chats };
}

// Rows stagger faster than narrative beats, matching the trophy shelf.
const RANK_STAGGER_MS = 80;

function RankList({
  chats,
  detail,
  emptyLabel,
}: {
  chats: TopChat[];
  detail: (chat: TopChat) => string;
  emptyLabel: string;
}) {
  const { live, settled } = useReveal();
  const animate = live && !settled;
  const { ref, seen } = useInViewOnce<HTMLOListElement>(animate);
  if (chats.length === 0) {
    return <p class="muted">{emptyLabel}</p>;
  }

  return (
    <ol class="rank-list" ref={ref}>
      {chats.map((chat, index) => (
        <li
          class={`rank-row beat${seen ? " beat-in" : ""}${animate ? "" : " beat-settled"}`}
          style={beatStyle(index, RANK_STAGGER_MS)}
          key={chat.chatId}
        >
          <span class="rank-index">{index + 1}</span>
          <PeerAvatar
            peerId={chat.chatId}
            title={chat.title}
            username={chat.username}
          />
          <span class="rank-body">
            <PeerName
              class="rank-title"
              peerId={chat.chatId}
              title={chat.title}
              username={chat.username}
            />
            <span class="rank-split muted">{detail(chat)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export const topDms = defineStat<TopContactsResult>({
  id: "top-dms",
  title: "Your people",
  icon: "🫂",
  description: "The people you exchange the most messages with.",
  compute: (dataset) =>
    computeTop(
      dataset,
      (type) => type === undefined || type === "private",
      (chat) => chat.messages,
    ),
  Card: ({ result }) => (
    <RankList
      chats={result.chats}
      detail={(chat) =>
        `${chat.sent.toLocaleString()} sent · ${chat.received.toLocaleString()} received — ` +
        `${chat.wordsSent.toLocaleString()} vs ${chat.wordsReceived.toLocaleString()} words`
      }
      emptyLabel="No direct chats yet."
    />
  ),
});

export const topGroups = defineStat<TopContactsResult>({
  id: "top-groups",
  title: "Groups you live in",
  icon: "🏟️",
  description: "The groups and channels where you post the most.",
  compute: (dataset) =>
    computeTop(
      dataset,
      (type) => type === "group" || type === "channel",
      (chat) => chat.sent,
    ),
  Card: ({ result }) => (
    <RankList
      chats={result.chats}
      detail={(chat) =>
        `${chat.sent.toLocaleString()} msgs · ${chat.wordsSent.toLocaleString()} words from you`
      }
      emptyLabel="No group activity yet."
    />
  ),
});
