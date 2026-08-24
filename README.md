# ◀◀ Rewindly

**Your Telegram, in review.**

[![CI](https://github.com/Allless/rewindly/actions/workflows/ci.yml/badge.svg)](https://github.com/Allless/rewindly/actions/workflows/ci.yml)
[![Deploy](https://github.com/Allless/rewindly/actions/workflows/deploy.yml/badge.svg)](https://github.com/Allless/rewindly/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-b8441f.svg)](LICENSE)

Rewindly is a personal chat-analytics tool that runs entirely in the browser
and presents your year as a scrolling story told in five acts. **Telegram** is the main flow: it logs
in as a linked device and reads the last 12 months of your history locally.
**WhatsApp** is in beta: you drop in "Export chat" files and they are parsed
on-device. There is no server and nothing is uploaded.

**Live**: https://allless.github.io/rewindly/ (will move to
`rewindly.lessly.me` once the domain is set up)

## Features

- How much you talked: messages and words per month, sent and received
- When you're awake: activity heatmap by weekday and hour
- Your people and the groups you live in, with profile photos
- How fast you reply: median reply times, and who answers fastest
- Who texts first: the share of conversations each side starts
- Ghosted: conversation attempts that never got an answer, both ways
- How you text: bursts vs. long messages, per side and per contact
- Gone quiet: dormant conversations and who sent the last message
- Your emoji fingerprint and the reactions you send and receive
- Greatest hits: your most-reacted messages, with photos and video frames
- Streaks, sticker and GIF rotations, and a trophy shelf of awards
- Share links: a summary anyone can open without logging in, with a
  per-section picker; sections about other people are off by default

Reply times, initiations and ghosting are measured per detected conversation
session — see [METHODOLOGY.md](METHODOLOGY.md) for the method and the
research it follows.

## How it works

**Telegram**

1. Log in with the QR code (desktop) or your phone number and a login code
   (mobile — Telegram's mobile apps don't confirm same-device QR links).
   Rewindly becomes a linked device on your account, like any Telegram
   client.
2. The last 12 months of history are fetched over MTProto and analyzed in
   the browser. Results are cached in IndexedDB, so reopening is instant.
3. The only network traffic goes to Telegram's servers.

**WhatsApp (beta, `?platform=whatsapp`)**

1. In WhatsApp: open a chat → ⋮ → More → Export chat (without media), and
   send the file to this device. Repeat for the chats you care about.
2. Drop the `.txt` files (or the `.zip` they came in) onto the page and pick
   which participant is you. Parsing happens in the tab; no login exists.
3. Coverage is whatever you exported, so the story says "partial history".
   Exports carry no reactions or media, so those slides are hidden.

Each platform lives behind one interface in `src/ts/platforms/`; everything
downstream — stats, story, sharing — is platform-blind.

## Privacy

- There is no backend. The site is static files on GitHub Pages, built from
  this repository by GitHub Actions. The page footer links the commit each
  deployment was built from.
- The session token is stored in localStorage. Disconnect deletes it, and
  you can revoke the session at any time in Telegram under Settings →
  Devices.
- No analytics, no tracking, no third-party requests.
- The code is MIT-licensed. Run it locally if you prefer.

## FAQ

**How do I know this isn't stealing my account?**
You don't have to take it on trust. There is no server that could receive
anything: watch the network tab during login and ingestion, and every
request goes to Telegram. The deployed site is built by CI from this
repository, and the footer links the exact commit it was built from.

**Why does it need my login? Telegram has an export feature.**
The official export requires the desktop app and can involve a 24-hour
security delay. A web page can only read history through MTProto, by
becoming a linked device, which is how every third-party Telegram client
works.

**What can the session access?**
Everything. A linked device is equivalent to logging in on a new phone.
Revoke it at any time in Telegram under Settings → Devices → Terminate.

**Is my 2FA password sent anywhere?**
No. Telegram's two-step verification uses SRP: the password is used locally
to compute a proof and is never transmitted.

**Will Telegram notify me about the login?**
Yes, you get the standard new-device notification.

**The API key is visible in the bundle. Isn't that a problem?**
No. The `api_id`/`api_hash` pair identifies the application, not the user,
and is present in every distributed Telegram client. If you self-host,
register your own pair at https://my.telegram.org.

**How do share links work without a server?**
The summary contains aggregate numbers only; names and message content stay
out unless you opt in. It is encrypted with AES-GCM in the browser and
posted anonymously to [Telegraph](https://telegra.ph), Telegram's publishing
service. The decryption key is carried in the URL fragment, which browsers
never send to servers. Anyone with the link can view the report without
logging in. Telegraph makes no permanence guarantees, so treat share links
as temporary.

**Why only 12 months, and why are large chats truncated?**
Telegram rate-limits history reads. The defaults (12 months, 5,000 messages
per chat) keep ingestion to a few minutes. Both constants are in
`src/ts/platforms/telegram/ingest.ts` if you self-host.

## Stack

- [Preact](https://preactjs.com) — UI
- [gramjs](https://github.com/gram-js/gramjs) (`telegram`) — MTProto client,
  runs in the browser over WebSocket
- [qrcode](https://github.com/soldair/node-qrcode) — login QR rendering
- Vite, TypeScript (strict), Vitest

## Development

```sh
pnpm install
pnpm dev           # dev server on localhost:5173
pnpm test          # run tests
pnpm build         # production build to dist/
```

Copy `.env.example` to `.env` and fill in your Telegram API credentials
from https://my.telegram.org:

```sh
cp .env.example .env
```

The credentials end up in the client bundle, which is normal for web-based
Telegram clients; see the FAQ.

## License

[MIT](LICENSE)

## Disclaimer

Rewindly is not affiliated with, endorsed by, or sponsored by Telegram or
WhatsApp. "Telegram" and "WhatsApp" are trademarks of their respective
owners.
