# Telegram contact bot

A Grammy inbox that hides your Telegram username. Visitors message the bot (for example from `https://t.me/<bot>?start=web`). You answer in a private forum group — one topic per person. They only ever see the bot.

## How it works

1. A visitor DMs the bot.
2. The bot opens (or reuses) a forum topic named after them (`Anna / @anna`, or `id 123…` if they have no username) and copies the message there.
3. You reply in that topic. The bot copies your reply back to the visitor.
4. `/who` reprints their name, `@username` or `no username`, and user id. If they have no username, you cannot open a user chat from the id alone.

Only the account in `ADMIN_USER_ID` is admin. Replies from anyone else in the group are ignored.

## Setup

### 1. Create the bot

1. Open [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts.
3. Copy the token. That is `BOT_TOKEN`.

### 2. Create a private forum group

1. In Telegram, create a **private group**.
2. Open group settings and enable **Topics** (forum mode).
3. Add the bot to the group.
4. Promote it to **admin** with **Manage topics** (needed to create a topic per visitor). Pinning the visitor card also needs pin permission.
5. Turn **anonymous admins** off for your account so the bot can tell that replies are yours.

### 3. Copy the ids

- **Group id (`ADMIN_GROUP_ID`)** — for a forum supergroup this looks like `-100…`. Easiest path: send a message in the group, then open `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates` and read `chat.id`. You can also forward a group message to a bot such as [@userinfobot](https://t.me/userinfobot).
- **Your user id (`ADMIN_USER_ID`)** — message [@userinfobot](https://t.me/userinfobot) and copy your numeric id.

### 4. Configure env

```bash
cp .env.example .env
```

Fill in:

```
BOT_TOKEN=123456:ABC…
ADMIN_GROUP_ID=-1001234567890
ADMIN_USER_ID=123456789
```

The bot refuses to start if any of these are missing.

Do not commit `.env` or the SQLite file under `data/`.

## Run

```bash
npm i && npm start
```

Requires Node.js 20+. The process long-polls Telegram; keep it running (or under a process manager) while you want the inbox live.

Website contact links should point at `https://t.me/<bot_username>?start=web`. There is no web form in this repo.

## Commands

Admin only, **inside a visitor topic**:

| Command   | Effect |
|-----------|--------|
| `/ban`    | Blacklist that visitor. The bot tells them they cannot write; further DMs are dropped. |
| `/unban`  | Restore the visitor. |
| `/who`    | Reprint name, username or `no username`, and user id. |

Visitors:

| Command  | Effect |
|----------|--------|
| `/start` | Explains this is a contact channel, not a public username. |

## Guardrails

- Banned visitors are ignored.
- Text is capped at 4000 characters.
- About 1 second cooldown per visitor, including sticker floods.
- Service messages are skipped.
- Only human replies in a visitor topic are copied out, so the bot does not loop on its own posts.

## Storage

Local SQLite via `better-sqlite3` at `data/contact-bot.sqlite`: visitor `userId` → `topicId`, display fields, and the ban list. Restarts keep threads and bans.
