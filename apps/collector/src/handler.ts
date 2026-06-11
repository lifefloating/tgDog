import { createHash } from "node:crypto";
import { Api } from "telegram";
import type { TelegramClient } from "telegram";
import { prisma } from "@tgdog/db";
import {
  buildAvatarKey,
  buildMediaKey,
  matchedRuleIds,
  uploadBuffer,
  type MessageLike,
  type R2Config,
} from "@tgdog/core";
import {
  extractMediaMeta,
  downloadMediaBuffer,
  downloadAvatarBuffer,
} from "./media.js";
import type { AccountCache } from "./rule-cache.js";

/** 刷屏去重窗口：同一发送人在窗口内重复发送相同内容只累加计数 */
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 把 GramJS chatId（可能是 bigInt/负数）规范成字符串 */
function chatIdStr(msg: Api.Message): string {
  const id = msg.chatId ?? msg.peerId;
  return String(id ?? "");
}

interface SenderInfo {
  id?: string;
  name?: string;
  username?: string;
  entity?: Api.User | Api.Channel | Api.Chat;
}

async function resolveSender(msg: Api.Message): Promise<SenderInfo> {
  try {
    const sender = await msg.getSender();
    if (!sender) return { id: msg.senderId ? String(msg.senderId) : undefined };
    if (sender instanceof Api.User) {
      const name = [sender.firstName, sender.lastName]
        .filter(Boolean)
        .join(" ");
      return {
        id: String(sender.id),
        name: name || sender.username || undefined,
        username: sender.username ?? undefined,
        entity: sender,
      };
    }
    if (sender instanceof Api.Channel || sender instanceof Api.Chat) {
      return {
        id: String(sender.id),
        name: sender.title,
        username:
          sender instanceof Api.Channel
            ? (sender.username ?? undefined)
            : undefined,
        entity: sender,
      };
    }
  } catch {
    // ignore
  }
  return { id: msg.senderId ? String(msg.senderId) : undefined };
}

/**
 * 拼 t.me 消息链接：公开频道用 username，私有频道/超级群用 /c/<内部id>；
 * 普通群和私聊没有稳定链接，返回 null。
 */
function buildMessageLink(
  username: string | null,
  chatId: string,
  tgMessageId: string,
): string | null {
  if (username) return `https://t.me/${username}/${tgMessageId}`;
  if (chatId.startsWith("-100")) {
    return `https://t.me/c/${chatId.slice(4)}/${tgMessageId}`;
  }
  return null;
}

/** 规范化文本后取 sha256，作为刷屏去重指纹；空文本返回 null */
function textHashOf(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex");
}

// senderId -> avatarKey（null 表示已尝试但无头像），避免每条消息都下载
const senderAvatarCache = new Map<string, string | null>();

async function storeSenderAvatar(
  client: TelegramClient,
  r2: R2Config | null,
  sender: SenderInfo,
): Promise<string | null> {
  if (!r2 || !sender.id || !sender.entity) return null;
  const cached = senderAvatarCache.get(sender.id);
  if (cached !== undefined) return cached;

  let key: string | null = null;
  const buffer = await downloadAvatarBuffer(client, sender.entity);
  if (buffer) {
    try {
      key = buildAvatarKey("sender", sender.id);
      await uploadBuffer(r2, key, buffer, "image/jpeg");
    } catch (err) {
      console.error("[handler] 发送人头像上传失败:", (err as Error).message);
      key = null;
    }
  }
  senderAvatarCache.set(sender.id, key);
  return key;
}

/** 记录消息 ↔ 规则命中（幂等） */
async function recordRuleHits(
  messageId: string,
  ruleIds: string[],
): Promise<void> {
  if (ruleIds.length === 0) return;
  await prisma.messageRuleHit.createMany({
    data: ruleIds.map((ruleId) => ({ messageId, ruleId })),
    skipDuplicates: true,
  });
}

/**
 * 处理一条新消息：判断是否在监控源 → 规则匹配 → 刷屏去重 → 媒体/头像入 R2 → 入库。
 * @returns 是否入库（含去重累加）
 */
export async function handleMessage(
  client: TelegramClient,
  accountId: string,
  cache: AccountCache,
  r2: R2Config | null,
  msg: Api.Message,
): Promise<boolean> {
  const chatId = chatIdStr(msg);
  const source = cache.sourcesByChatId.get(chatId);
  if (!source) return false; // 不在监控源

  const mediaMeta = extractMediaMeta(msg);
  const text = msg.message ?? "";

  const sender = await resolveSender(msg);
  const msgLike: MessageLike = {
    text,
    hasMedia: !!mediaMeta,
    senderId: sender.id,
    senderUsername: sender.username,
    sourceId: source.id,
  };

  const ruleIds = matchedRuleIds(cache.rules, msgLike);
  if (ruleIds.length === 0) return false; // 未命中任何规则

  const timestamp = new Date((msg.date ?? 0) * 1000);
  const isForwarded = !!msg.fwdFrom;
  const textHash = textHashOf(text);

  // 刷屏去重：同一发送人窗口内发过相同内容 → 计数 +1，合并命中规则，不再新建记录
  if (textHash && sender.id) {
    const since = new Date(Date.now() - DEDUP_WINDOW_MS);
    const dup = await prisma.message.findFirst({
      where: {
        senderId: sender.id,
        textHash,
        OR: [{ timestamp: { gte: since } }, { lastSeenAt: { gte: since } }],
      },
      orderBy: { timestamp: "desc" },
      select: { id: true, matchedRuleIds: true },
    });
    if (dup) {
      const merged = Array.from(
        new Set([
          ...((dup.matchedRuleIds as string[]) ?? []),
          ...ruleIds,
        ]),
      );
      await prisma.message.update({
        where: { id: dup.id },
        data: {
          dupCount: { increment: 1 },
          lastSeenAt: timestamp,
          matchedRuleIds: merged,
        },
      });
      await recordRuleHits(dup.id, ruleIds);
      console.log(
        `[dedup] ${source.tgChatId} 刷屏 +1: "${text.slice(0, 30)}"`,
      );
      return true;
    }
  }

  const senderAvatarKey = await storeSenderAvatar(client, r2, sender);
  const messageLink = buildMessageLink(
    source.username,
    chatId,
    String(msg.id),
  );

  // 先 upsert 消息（避免重复），拿到 messageId 用于媒体 key
  let saved;
  try {
    saved = await prisma.message.upsert({
      where: {
        accountId_tgChatId_tgMessageId: {
          accountId,
          tgChatId: chatId,
          tgMessageId: String(msg.id),
        },
      },
      update: { matchedRuleIds: ruleIds },
      create: {
        accountId,
        sourceId: source.id,
        tgMessageId: String(msg.id),
        tgChatId: chatId,
        senderId: sender.id,
        senderName: sender.name,
        senderUsername: sender.username,
        senderAvatarKey,
        text,
        textHash,
        lastSeenAt: timestamp,
        messageLink,
        timestamp,
        isForwarded,
        matchedRuleIds: ruleIds,
        needsSummary: true,
      },
    });
  } catch (err) {
    console.error("[handler] 入库失败:", (err as Error).message);
    return false;
  }

  await recordRuleHits(saved.id, ruleIds);

  // 媒体：下载 → R2 → Media 记录
  if (mediaMeta && r2) {
    const buffer = await downloadMediaBuffer(client, msg);
    if (buffer) {
      try {
        const key = buildMediaKey(
          saved.id,
          mediaMeta.fileName,
          timestamp.toISOString(),
        );
        const url = await uploadBuffer(r2, key, buffer, mediaMeta.mimeType);
        await prisma.media.create({
          data: {
            messageId: saved.id,
            type: mediaMeta.type,
            r2Key: key,
            r2Url: url,
            fileName: mediaMeta.fileName,
            fileSize: mediaMeta.fileSize ?? buffer.length,
            mimeType: mediaMeta.mimeType,
            width: mediaMeta.width,
            height: mediaMeta.height,
          },
        });
      } catch (err) {
        console.error("[handler] 媒体上传失败:", (err as Error).message);
      }
    }
  } else if (mediaMeta && !r2) {
    console.warn("[handler] 有媒体但 R2 未配置，跳过媒体存储");
  }

  console.log(
    `[match] ${source.tgChatId} 命中 ${ruleIds.length} 规则: "${text.slice(0, 50)}"`,
  );
  return true;
}
