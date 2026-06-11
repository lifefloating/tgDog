import { prisma } from "@tgdog/db";
import type { RuleLike } from "@tgdog/core";

export interface CachedSource {
  id: string;
  tgChatId: string;
  enabled: boolean;
  username: string | null;
  type: string;
}

export interface AccountCache {
  /** tgChatId -> source */
  sourcesByChatId: Map<string, CachedSource>;
  rules: RuleLike[];
}

/**
 * 规则/源缓存，定期从 DB 刷新，实现 web 端配置热加载（无需重启 collector）。
 */
export class RuleCache {
  private cache = new Map<string, AccountCache>(); // accountId -> cache

  async refresh(accountId: string): Promise<AccountCache> {
    const [sources, rules] = await Promise.all([
      prisma.source.findMany({ where: { accountId, enabled: true } }),
      prisma.rule.findMany({
        where: {
          enabled: true,
          OR: [
            // 全选：对该账号所有源生效
            { scopeMode: "ALL" },
            // 多选：勾选的源里有属于该账号的启用源
            {
              scopeMode: "SELECTED",
              sources: { some: { accountId, enabled: true } },
            },
          ],
        },
        include: { sources: { select: { id: true } } },
      }),
    ]);

    const sourcesByChatId = new Map<string, CachedSource>();
    for (const s of sources) {
      sourcesByChatId.set(s.tgChatId, {
        id: s.id,
        tgChatId: s.tgChatId,
        enabled: s.enabled,
        username: s.username,
        type: s.type,
      });
    }

    const ruleLikes: RuleLike[] = rules.map((r) => ({
      id: r.id,
      keyword: r.keyword,
      matchType: r.matchType,
      caseSensitive: r.caseSensitive,
      senderFilter: r.senderFilter,
      mediaOnly: r.mediaOnly,
      scopeMode: r.scopeMode,
      sourceIds: r.sources.map((s) => s.id),
    }));

    const entry: AccountCache = { sourcesByChatId, rules: ruleLikes };
    this.cache.set(accountId, entry);
    return entry;
  }

  get(accountId: string): AccountCache | undefined {
    return this.cache.get(accountId);
  }
}
