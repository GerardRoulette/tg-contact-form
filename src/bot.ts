import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Bot, type Context } from "grammy";
import type { Message } from "grammy/types";
import {
  ensureVisitorTopic,
  handleBan,
  handleUnban,
  handleWho,
  isAdmin,
} from "./admin.ts";
import { Store } from "./store.ts";

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const MAX_TEXT_LENGTH = 4000;
const COOLDOWN_MS = 1000;
const GENERAL_TOPIC_ID = 1;

type Config = {
  botToken: string;
  adminGroupId: number;
  adminUserId: number;
};

function loadConfig(): Config {
  const missing = ["BOT_TOKEN", "ADMIN_GROUP_ID", "ADMIN_USER_ID"].filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length > 0) {
    console.error(
      `Missing required environment variable(s): ${missing.join(", ")}`,
    );
    console.error(
      "Copy .env.example to .env and fill in BOT_TOKEN, ADMIN_GROUP_ID, and ADMIN_USER_ID.",
    );
    process.exit(1);
  }

  const adminGroupId = Number(process.env.ADMIN_GROUP_ID);
  const adminUserId = Number(process.env.ADMIN_USER_ID);
  if (!Number.isFinite(adminGroupId) || !Number.isFinite(adminUserId)) {
    console.error(
      "ADMIN_GROUP_ID and ADMIN_USER_ID must be numeric Telegram ids.",
    );
    process.exit(1);
  }

  return {
    botToken: process.env.BOT_TOKEN!.trim(),
    adminGroupId,
    adminUserId,
  };
}

function isServiceMessage(message: Message): boolean {
  return Boolean(
    message.new_chat_members ||
      message.left_chat_member ||
      message.new_chat_title ||
      message.new_chat_photo ||
      message.delete_chat_photo ||
      message.group_chat_created ||
      message.supergroup_chat_created ||
      message.channel_chat_created ||
      message.message_auto_delete_timer_changed ||
      message.migrate_to_chat_id ||
      message.migrate_from_chat_id ||
      message.pinned_message ||
      message.forum_topic_created ||
      message.forum_topic_closed ||
      message.forum_topic_reopened ||
      message.forum_topic_edited ||
      message.general_forum_topic_hidden ||
      message.general_forum_topic_unhidden ||
      message.video_chat_scheduled ||
      message.video_chat_started ||
      message.video_chat_ended ||
      message.video_chat_participants_invited ||
      message.web_app_data ||
      message.write_access_allowed ||
      message.successful_payment ||
      message.connected_website ||
      message.proximity_alert_triggered,
  );
}

function isCopyableMessage(message: Message): boolean {
  return Boolean(
    message.text ||
      message.caption ||
      message.photo ||
      message.video ||
      message.animation ||
      message.audio ||
      message.document ||
      message.sticker ||
      message.voice ||
      message.video_note ||
      message.location ||
      message.venue ||
      message.contact ||
      message.poll ||
      message.dice ||
      message.story,
  );
}

function textLength(message: Message): number {
  return (message.text ?? message.caption ?? "").length;
}

function isCommandMessage(message: Message): boolean {
  const text = message.text;
  if (!text?.startsWith("/")) return false;
  const token = text.slice(1).split(/\s+/, 1)[0] ?? "";
  return /^[a-zA-Z0-9_]+(?:@\w+)?$/.test(token);
}

class Cooldown {
  private readonly lastSent = new Map<number, number>();

  tooSoon(userId: number): boolean {
    const now = Date.now();
    const previous = this.lastSent.get(userId) ?? 0;
    if (now - previous < COOLDOWN_MS) return true;
    this.lastSent.set(userId, now);
    return false;
  }
}

const config = loadConfig();
const store = new Store(path.join(ROOT_DIR, "data", "contact-bot.sqlite"));
const cooldown = new Cooldown();
const bot = new Bot(config.botToken);

bot.catch((error) => {
  console.error("Bot error:", error.error);
});

const dms = bot.chatType("private");

dms.command("start", async (ctx) => {
  await ctx.reply(
    [
      "Здравствуйте! Это мой бот для фильтрации спама. ",
      "",
      "Отправьте сюда сообщение и я его немедленно получу.",
    ].join("\n"),
  );
});

dms.on("message", async (ctx) => {
  const message = ctx.message;
  const from = ctx.from;
  if (!from || isServiceMessage(message) || isCommandMessage(message)) return;
  if (!isCopyableMessage(message)) return;
  if (store.isBanned(from.id)) return;
  if (cooldown.tooSoon(from.id)) return;

  if (textLength(message) > MAX_TEXT_LENGTH) {
    await ctx.reply(
      `Пожалуйста, уложитесь в ${MAX_TEXT_LENGTH} символов.`,
    );
    return;
  }

  try {
    await copyVisitorIn(ctx);
  } catch (error) {
    console.error("Failed to copy visitor message:", error);
    await ctx.reply("Не получилось отправить ваше сообщение. Пожалуйста, попробуйте позже.");
  }
});

const inbox = bot.filter((ctx) => ctx.chat?.id === config.adminGroupId);

inbox.command("ban", (ctx) => handleBan(ctx, store, config.adminUserId));
inbox.command("unban", (ctx) => handleUnban(ctx, store, config.adminUserId));
inbox.command("who", (ctx) => handleWho(ctx, store, config.adminUserId));

inbox.on("message", async (ctx) => {
  const message = ctx.message;
  if (!isAdmin(ctx.from?.id, config.adminUserId)) return;
  if (ctx.from?.is_bot) return;
  if (isServiceMessage(message) || isCommandMessage(message)) return;
  if (!isCopyableMessage(message)) return;

  const threadId = message.message_thread_id;
  if (threadId == null || threadId === GENERAL_TOPIC_ID) return;

  const visitor = store.getByTopicId(threadId);
  if (!visitor) return;

  try {
    await ctx.api.copyMessage(
      visitor.userId,
      ctx.chat.id,
      message.message_id,
    );
  } catch (error) {
    console.error("Failed to copy admin reply:", error);
    await ctx.reply(
      "Не получилось отправить это сообщение. Возможно, посетитель заблокировал бота.",
    );
  }
});

async function copyVisitorIn(ctx: Context): Promise<void> {
  const message = ctx.message;
  const from = ctx.from;
  if (!message || !from) return;

  let visitor = await ensureVisitorTopic(
    ctx.api,
    store,
    from,
    config.adminGroupId,
  );
  if (visitor.topicId == null) {
    throw new Error("Visitor topic was not created");
  }

  try {
    await ctx.api.copyMessage(
      config.adminGroupId,
      message.chat.id,
      message.message_id,
      { message_thread_id: visitor.topicId },
    );
  } catch (error) {
    console.warn("Visitor topic missing; recreating:", error);
    store.clearTopicId(from.id);
    visitor = await ensureVisitorTopic(
      ctx.api,
      store,
      from,
      config.adminGroupId,
    );
    if (visitor.topicId == null) {
      throw new Error("Visitor topic was not recreated");
    }
    await ctx.api.copyMessage(
      config.adminGroupId,
      message.chat.id,
      message.message_id,
      { message_thread_id: visitor.topicId },
    );
  }
}

async function main(): Promise<void> {
  await bot.start({
    onStart: (info) => {
      console.log(`Contact bot @${info.username} is running`);
    },
  });
}

function shutdown(): void {
  void bot.stop().finally(() => {
    store.close();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

main().catch((error) => {
  console.error("Failed to start bot:", error);
  store.close();
  process.exit(1);
});
