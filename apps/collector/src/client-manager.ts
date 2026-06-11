import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { prisma } from "@tgdog/db";
import {
  decrypt,
  uploadBuffer,
  buildAvatarKey,
  matchedRuleIds,
  type MessageLike,
  type R2Config,
} from "@tgdog/core";
import { RuleCache } from "./rule-cache.js";
import { handleMessage } from "./handler.js";
import { loadR2Config } from "./settings.js";
import { downloadAvatarBuffer } from "./media.js";
import { env } from "./env.js";

interface RunningAccount {
  accountId: string;
  client: TelegramClient;
  removeHandler: () => void;
}

// Telegram 对 GetHistory 的 flood 限制约为 10 次/30 秒（Telethon 文档），
// 拉历史时每个源之间隔 1s，避免源多时触发 420 FLOOD_WAIT。
const HISTORY_PACING_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 管理所有已登录账号的 GramJS 客户端：连接、监听、热加载规则、媒体入 R2。
 */
export class ClientManager {
  private running = new Map<string, RunningAccount>();
  private ruleCache = new RuleCache();
  private r2: R2Config | null = null;
  private reloadTimer?: NodeJS.Timeout;
  private lastAvatarBackfillAt = 0;

  async start(): Promise<void> {
    this.r2 = await loadR2Config();
    if (!this.r2) {
      console.warn("[manager] R2 未配置，媒体将不会被存储（可在 web /settings 配置）");
    }

    await this.syncAccounts();

    // 定期热加载：规则/源 + 新账号 + R2 配置
    this.reloadTimer = setInterval(() => {
      void this.reloadAll();
    }, env.reloadIntervalMs);
  }

  private async reloadAll(): Promise<void> {
    try {
      this.r2 = await loadR2Config();
      for (const acc of this.running.values()) {
        await this.ruleCache.refresh(acc.accountId);
      }
      await this.syncAccounts(); // 接入新登录的账号

      // 头像补抓会调 Telegram API（getEntity/下载），按独立的慢节奏跑，
      // 避免跟着热加载频率打满 API 触发 FLOOD_WAIT
      if (Date.now() - this.lastAvatarBackfillAt >= env.avatarBackfillMs) {
        this.lastAvatarBackfillAt = Date.now();
        await this.backfillSourceAvatars();
      }
    } catch (err) {
      console.error("[manager] reload 出错:", (err as Error).message);
    }
  }

  /** 给 avatarKey 为空的已监控源补抓头像（已有源在头像功能上线前添加，没存头像） */
  private async backfillSourceAvatars(): Promise<void> {
    if (!this.r2) return;
    const sources = await prisma.source.findMany({
      where: { avatarKey: null },
      select: { id: true, accountId: true, tgChatId: true },
    });
    for (const s of sources) {
      const acc = this.running.get(s.accountId);
      if (!acc) continue; // 该账号未连接，下次再补
      try {
        const entity = await acc.client.getEntity(s.tgChatId);
        if (
          !(
            entity instanceof Api.User ||
            entity instanceof Api.Channel ||
            entity instanceof Api.Chat
          )
        ) {
          continue;
        }
        const key = await this.storeAvatar(
          "source",
          s.tgChatId,
          acc.client,
          entity,
        );
        if (key) {
          await prisma.source.update({
            where: { id: s.id },
            data: { avatarKey: key },
          });
          console.log(`[manager] 补抓源头像 ${s.tgChatId}`);
        }
      } catch (err) {
        // 实体解析失败 / 无头像：跳过，不阻塞其他源
        console.warn(
          `[manager] 源 ${s.tgChatId} 头像补抓失败:`,
          (err as Error).message,
        );
      }
    }
  }

  /** 把 DB 里 ACTIVE 且有 session 的账号都连上；已删除/停用的账号断开 */
  async syncAccounts(): Promise<void> {
    const accounts = await prisma.account.findMany({
      where: { status: "ACTIVE", sessionEnc: { not: null } },
    });

    // 断开 DB 里已不存在（被删除/停用）的账号
    const activeIds = new Set(accounts.map((a) => a.id));
    for (const [id, acc] of this.running) {
      if (activeIds.has(id)) continue;
      try {
        acc.removeHandler();
        await acc.client.disconnect();
      } catch {
        // ignore
      }
      this.running.delete(id);
      console.log(`[manager] 账号 ${id} 已从 DB 移除，断开连接`);
    }

    for (const acc of accounts) {
      if (this.running.has(acc.id)) continue;
      try {
        await this.connectAccount(acc.id, acc.apiId, acc.apiHashEnc, acc.sessionEnc!);
      } catch (err) {
        console.error(
          `[manager] 账号 ${acc.id} 连接失败:`,
          (err as Error).message,
        );
        await prisma.account.update({
          where: { id: acc.id },
          data: { status: "DISCONNECTED" },
        });
      }
    }
  }

  private async connectAccount(
    accountId: string,
    apiId: number,
    apiHashEnc: string,
    sessionEnc: string,
  ): Promise<void> {
    const apiHash = decrypt(apiHashEnc);
    const sessionStr = decrypt(sessionEnc);
    const client = new TelegramClient(
      new StringSession(sessionStr),
      apiId,
      apiHash,
      { connectionRetries: 5, autoReconnect: true },
    );

    await client.connect();
    const me = await client.getMe();
    const meId = me instanceof Api.User ? String(me.id) : undefined;
    console.log(`[manager] 账号 ${accountId} 已连接 (user=${meId})`);

    // 抓取账号自身头像（有 R2 才存）
    let avatarKey: string | undefined;
    if (this.r2 && me instanceof Api.User) {
      avatarKey = await this.storeAvatar("account", accountId, client, me);
    }

    await this.ruleCache.refresh(accountId);

    const handler = async (event: NewMessageEvent) => {
      try {
        const cache = this.ruleCache.get(accountId);
        if (!cache) return;
        await handleMessage(client, accountId, cache, this.r2, event.message);
      } catch (err) {
        console.error("[manager] 消息处理出错:", (err as Error).message);
      }
    };
    client.addEventHandler(handler, new NewMessage({}));

    await prisma.account.update({
      where: { id: accountId },
      data: {
        status: "ACTIVE",
        lastConnectedAt: new Date(),
        tgUserId: meId,
        ...(avatarKey ? { avatarKey } : {}),
      },
    });

    this.running.set(accountId, {
      accountId,
      client,
      removeHandler: () => client.removeEventHandler(handler, new NewMessage({})),
    });
  }

  /** 拉取某账号的对话列表，供 web /sources 选择监控源 */
  async listDialogs(accountId: string): Promise<
    {
      tgChatId: string;
      title: string;
      username?: string;
      type: string;
      avatarKey?: string;
    }[]
  > {
    const acc = this.running.get(accountId);
    if (!acc) throw new Error("账号未连接");
    const dialogs = await acc.client.getDialogs({ limit: 200 });
    const out: {
      tgChatId: string;
      title: string;
      username?: string;
      type: string;
      avatarKey?: string;
    }[] = [];
    for (const d of dialogs) {
      const entity = d.entity;
      let type = "USER";
      let username: string | undefined;
      if (entity instanceof Api.Channel) {
        type = entity.megagroup ? "GROUP" : "CHANNEL";
        username = entity.username ?? undefined;
      } else if (entity instanceof Api.Chat) {
        type = "GROUP";
      } else if (entity instanceof Api.User) {
        type = "USER";
        username = entity.username ?? undefined;
      }
      const tgChatId = String(d.id ?? entity?.id ?? "");
      if (!tgChatId) continue;

      // 有 R2 且能识别实体类型时，顺便抓头像入库（key 以 tgChatId 命名，幂等）
      let avatarKey: string | undefined;
      if (
        this.r2 &&
        (entity instanceof Api.User ||
          entity instanceof Api.Channel ||
          entity instanceof Api.Chat)
      ) {
        avatarKey = await this.storeAvatar(
          "source",
          tgChatId,
          acc.client,
          entity,
        );
      }

      out.push({
        tgChatId,
        title: d.title ?? username ?? "(未命名)",
        username,
        type,
        avatarKey,
      });
    }
    return out;
  }

  /** 下载实体头像并上传 R2，返回对象 key（无头像/无 R2/失败返回 undefined） */
  private async storeAvatar(
    kind: "account" | "source",
    id: string,
    client: TelegramClient,
    entity: Api.User | Api.Channel | Api.Chat,
  ): Promise<string | undefined> {
    if (!this.r2) return undefined;
    const buffer = await downloadAvatarBuffer(client, entity);
    if (!buffer) return undefined;
    try {
      const key = buildAvatarKey(kind, id);
      await uploadBuffer(this.r2, key, buffer, "image/jpeg");
      return key;
    } catch (err) {
      console.error("[manager] 头像上传失败:", (err as Error).message);
      return undefined;
    }
  }

  getClient(accountId: string): TelegramClient | undefined {
    return this.running.get(accountId)?.client;
  }

  /**
   * 规则回测：拉每个监控源最近 limit 条历史消息跑一遍规则匹配。
   * 用于验证 chatId 映射、规则关键词在真实消息上的命中情况（不入库）。
   */
  async backtestRules(
    accountId: string,
    limit = 20,
  ): Promise<{
    rules: { id: string; keyword: string | null }[];
    sources: {
      tgChatId: string;
      username: string | null;
      fetched: number;
      /** 历史消息上的 msg.chatId 与源 tgChatId 不一致时给出实际值 */
      chatIdMismatch: string | null;
      hits: {
        tgMessageId: string;
        ruleIds: string[];
        text: string;
        date: string | null;
      }[];
      error?: string;
    }[];
  }> {
    const acc = this.running.get(accountId);
    if (!acc) throw new Error("账号未连接");
    const cache = await this.ruleCache.refresh(accountId);

    const sources: Awaited<
      ReturnType<ClientManager["backtestRules"]>
    >["sources"] = [];

    for (const source of cache.sourcesByChatId.values()) {
      const entry: (typeof sources)[number] = {
        tgChatId: source.tgChatId,
        username: source.username,
        fetched: 0,
        chatIdMismatch: null,
        hits: [],
      };
      try {
        const msgs = await acc.client.getMessages(source.tgChatId, { limit });
        for (const msg of msgs) {
          entry.fetched++;
          const eventChatId = String(msg.chatId ?? "");
          if (eventChatId && eventChatId !== source.tgChatId) {
            entry.chatIdMismatch = eventChatId;
          }
          const text = msg.message ?? "";
          const msgLike: MessageLike = {
            text,
            hasMedia: !!msg.media,
            senderId: msg.senderId ? String(msg.senderId) : undefined,
            sourceId: source.id,
          };
          const ruleIds = matchedRuleIds(cache.rules, msgLike);
          if (ruleIds.length > 0) {
            entry.hits.push({
              tgMessageId: String(msg.id),
              ruleIds,
              text: text.slice(0, 120),
              date: msg.date ? new Date(msg.date * 1000).toISOString() : null,
            });
          }
        }
      } catch (err) {
        entry.error = (err as Error).message;
      }
      sources.push(entry);
      await sleep(HISTORY_PACING_MS);
    }

    return {
      rules: cache.rules.map((r) => ({ id: r.id, keyword: r.keyword })),
      sources,
    };
  }

  /**
   * 历史回填：把各监控源最近 limit 条历史消息走完整入库管线
   * （命中规则才入库，含刷屏去重/媒体/规则命中记录）。
   */
  async backfillHistory(
    accountId: string,
    limit = 50,
  ): Promise<{ scanned: number; saved: number; errors: string[] }> {
    const acc = this.running.get(accountId);
    if (!acc) throw new Error("账号未连接");
    const cache = await this.ruleCache.refresh(accountId);

    let scanned = 0;
    let saved = 0;
    const errors: string[] = [];
    for (const source of cache.sourcesByChatId.values()) {
      try {
        const msgs = await acc.client.getMessages(source.tgChatId, { limit });
        // 从旧到新处理，让刷屏去重的 lastSeenAt 按时间正序推进
        for (const msg of [...msgs].reverse()) {
          scanned++;
          const ok = await handleMessage(
            acc.client,
            accountId,
            cache,
            this.r2,
            msg,
          );
          if (ok) saved++;
        }
      } catch (err) {
        errors.push(`${source.tgChatId}: ${(err as Error).message}`);
      }
      await sleep(HISTORY_PACING_MS);
    }
    console.log(`[manager] 历史回填完成：扫描 ${scanned} 条，入库 ${saved} 条`);
    return { scanned, saved, errors };
  }

  async stop(): Promise<void> {
    if (this.reloadTimer) clearInterval(this.reloadTimer);
    for (const acc of this.running.values()) {
      try {
        acc.removeHandler();
        await acc.client.disconnect();
      } catch {
        // ignore
      }
    }
    this.running.clear();
  }
}
