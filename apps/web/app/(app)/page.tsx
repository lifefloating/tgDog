import Link from "next/link";
import { prisma } from "@tgdog/db";
import { MessageStream } from "@/components/message-stream";
import { Card, CardContent } from "@/components/ui/card";
import {
  getDashboardStats,
  getEnabledSources,
  getMessages,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    sourceId?: string;
    accountId?: string;
    ruleId?: string;
    keyword?: string;
    page?: string;
  }>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const page = sp.page ? Number.parseInt(sp.page, 10) : 1;
  // 在查询前取时间作为 SSE 初始游标，避免漏掉「查询 → SSE 建连」之间的消息
  const renderedAt = new Date().toISOString();
  const filters = {
    sourceId: sp.sourceId,
    accountId: sp.accountId,
    ruleId: sp.ruleId,
    keyword: sp.keyword,
  };

  const [{ messages, totalPages, total }, sources, stats, accounts, rules] =
    await Promise.all([
      getMessages({ ...filters, page }),
      getEnabledSources(),
      getDashboardStats(),
      prisma.account.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, label: true },
      }),
      prisma.rule.findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true },
      }),
    ]);

  const qs = (next: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const merged = { ...sp, ...next };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    return `?${params.toString()}`;
  };

  // SSE 订阅带上同样的过滤条件（不带 page）
  const streamParams = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v) streamParams.set(k, v);
  }
  const streamQuery = streamParams.size > 0 ? `?${streamParams}` : "";
  const hasFilter = Object.values(filters).some(Boolean);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="近 24h 消息" value={stats.today} />
        <Stat label="监控源" value={stats.sources} />
        <Stat label="启用规则" value={stats.rules} />
      </div>

      {/* 过滤栏 */}
      <form className="flex flex-wrap items-center gap-2" action="/" method="get">
        {accounts.length > 1 && (
          <select
            name="accountId"
            defaultValue={sp.accountId ?? ""}
            className="h-9 rounded-md border border-border bg-muted px-2 text-sm"
          >
            <option value="">全部账号</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        )}
        <select
          name="sourceId"
          defaultValue={sp.sourceId ?? ""}
          className="h-9 rounded-md border border-border bg-muted px-2 text-sm"
        >
          <option value="">全部来源</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <select
          name="ruleId"
          defaultValue={sp.ruleId ?? ""}
          className="h-9 rounded-md border border-border bg-muted px-2 text-sm"
        >
          <option value="">全部规则</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <input
          name="keyword"
          defaultValue={sp.keyword ?? ""}
          placeholder="搜索关键词…"
          className="h-9 w-44 rounded-md border border-border bg-muted px-3 text-sm placeholder:text-muted-foreground"
        />
        <button className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
          筛选
        </button>
        {hasFilter && (
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            清除
          </Link>
        )}
      </form>

      {/* 实时消息流（筛选/翻页变化时用 key 重挂载，重置客户端列表状态） */}
      <MessageStream
        key={`${streamQuery}|${page}`}
        initial={messages}
        streamQuery={streamQuery}
        since={renderedAt}
        live={page === 1}
        showAccount={accounts.length > 1}
      />

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2 text-sm">
          {page > 1 && (
            <Link href={qs({ page: page - 1 })} className="text-primary hover:underline">
              ← 上一页
            </Link>
          )}
          <span className="text-muted-foreground">
            {page} / {totalPages}（共 {total}）
          </span>
          {page < totalPages && (
            <Link href={qs({ page: page + 1 })} className="text-primary hover:underline">
              下一页 →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
