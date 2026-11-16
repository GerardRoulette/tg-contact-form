import type { Api, Context } from "grammy";
import type { User } from "grammy/types";
import type { Store, Visitor } from "./store.ts";

const GENERAL_TOPIC_ID = 1;
const TOPIC_NAME_MAX = 128;

export function isAdmin(
  userId: number | undefined,
  adminUserId: number,
): boolean {
  return userId === adminUserId;
}

export function topicTitle(user: User): string {
  if (user.username) {
    const name = user.first_name.trim() || "Посетитель";
    return truncate(`${name} / @${user.username}`, TOPIC_NAME_MAX);
  }
  return truncate(`id ${user.id}`, TOPIC_NAME_MAX);
}

export function formatVisitorCard(visitor: Visitor): string {
  const name =
    [visitor.firstName, visitor.lastName].filter(Boolean).join(" ") ||
    "Неизвестно";
  const username = visitor.username ? `@${visitor.username}` : "нет";
  const lines = [
    `Имя: ${name}`,
    `Имя пользователя: ${username}`,
    `ID: ${visitor.userId}`,
  ];
  if (!visitor.username) {
    lines.push("", "Нельзя открыть чат с пользователем, зная только id.");
  }
  return lines.join("\n");
}

export async function ensureVisitorTopic(
  api: Api,
  store: Store,
  user: User,
  adminGroupId: number,
): Promise<Visitor> {
  const profile = store.upsertProfile(user);
  if (profile.topicId != null) {
    return profile;
  }

  const topic = await api.createForumTopic(adminGroupId, topicTitle(user));
  store.setTopicId(user.id, topic.message_thread_id);
  const visitor = store.getByUserId(user.id)!;

  const card = await api.sendMessage(adminGroupId, formatVisitorCard(visitor), {
    message_thread_id: topic.message_thread_id,
  });
  try {
    await api.pinChatMessage(adminGroupId, card.message_id);
  } catch (error) {
    console.warn("Could not pin visitor card in topic:", error);
  }

  return visitor;
}

export async function handleBan(
  ctx: Context,
  store: Store,
  adminUserId: number,
): Promise<void> {
  if (!isAdmin(ctx.from?.id, adminUserId)) return;

  const visitor = visitorFromTopic(ctx, store);
  if (!visitor) {
    await ctx.reply("Команду /ban нужно отправлять в теме посетителя.");
    return;
  }
  if (visitor.banned) {
    await ctx.reply("Этот посетитель уже заблокирован.");
    return;
  }

  store.ban(visitor.userId);
  await ctx.reply(
    "Посетитель заблокирован. Дальнейшие сообщения от него будут игнорироваться.",
  );
  try {
    await ctx.api.sendMessage(
      visitor.userId,
      "Вы больше не можете писать сюда.",
    );
  } catch {
    await ctx.reply(
      "Не получилось уведомить посетителя (возможно, он заблокировал бота).",
    );
  }
}

export async function handleUnban(
  ctx: Context,
  store: Store,
  adminUserId: number,
): Promise<void> {
  if (!isAdmin(ctx.from?.id, adminUserId)) return;

  const visitor = visitorFromTopic(ctx, store);
  if (!visitor) {
    await ctx.reply("Команду /unban нужно отправлять в теме посетителя.");
    return;
  }
  if (!visitor.banned) {
    await ctx.reply("Этот посетитель не заблокирован.");
    return;
  }

  store.unban(visitor.userId);
  await ctx.reply("Блокировка снята. Сообщения посетителя снова будут доставляться.");
  try {
    await ctx.api.sendMessage(
      visitor.userId,
      "Вы снова можете писать сюда.",
    );
  } catch {
    await ctx.reply(
      "Не получилось уведомить посетителя (возможно, он заблокировал бота).",
    );
  }
}

export async function handleWho(
  ctx: Context,
  store: Store,
  adminUserId: number,
): Promise<void> {
  if (!isAdmin(ctx.from?.id, adminUserId)) return;

  const visitor = visitorFromTopic(ctx, store);
  if (!visitor) {
    await ctx.reply("Команду /who нужно отправлять в теме посетителя.");
    return;
  }

  await ctx.reply(formatVisitorCard(visitor));
}

function visitorFromTopic(ctx: Context, store: Store): Visitor | undefined {
  const threadId = ctx.message?.message_thread_id;
  if (threadId == null || threadId === GENERAL_TOPIC_ID) return undefined;
  return store.getByTopicId(threadId);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
