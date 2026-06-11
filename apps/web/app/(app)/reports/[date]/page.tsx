import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { prisma } from "@tgdog/db";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/avatar";
import type { QuoteItem, QuoteStats } from "@/lib/report";
import {
  CHART_COLORS,
  CHART_REST,
  ChartCard,
  MinPriceChart,
  QuoteDonut,
  TopSourcesChart,
} from "./charts";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ scope?: string }>;
}

interface Stats {
  messageCount?: number;
  sourceCount?: number;
  topSources?: { title: string; count: number }[];
  quotes?: QuoteStats;
}

function ymd(d: Date): string {
  const dt = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** 报价表：showProduct 用于「无法比价」列表（品类混排需要标明产品） */
function QuoteTable({
  items,
  showProduct = false,
}: {
  items: QuoteItem[];
  showProduct?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
            {showProduct && <th className="px-2.5 py-1.5 font-medium">产品</th>}
            <th className="px-2.5 py-1.5 font-medium">报价</th>
            <th className="px-2.5 py-1.5 font-medium">折合¥</th>
            <th className="px-2.5 py-1.5 font-medium">渠道</th>
            <th className="px-2.5 py-1.5 font-medium">发言人</th>
            <th className="px-2.5 py-1.5 font-medium">群/频道</th>
            <th className="px-2.5 py-1.5 font-medium">原消息</th>
          </tr>
        </thead>
        <tbody>
          {items.map((q, i) => (
            <tr
              key={`${q.product}-${q.seller}-${q.priceText}-${i}`}
              className="border-b border-border last:border-0"
            >
              {showProduct && (
                <td className="px-2.5 py-1.5 font-medium">{q.product}</td>
              )}
              <td className="whitespace-nowrap px-2.5 py-1.5 font-medium tabular-nums">
                {q.priceText}
                {!showProduct && i === 0 && (
                  <span className="ml-1.5 rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">
                    最低
                  </span>
                )}
              </td>
              <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums text-muted-foreground">
                {q.priceCNY !== null ? `¥${q.priceCNY}` : "—"}
              </td>
              <td className="px-2.5 py-1.5">{q.channel}</td>
              <td className="px-2.5 py-1.5">
                <span className="flex items-center gap-1.5">
                  <Avatar
                    avatarKey={q.sellerAvatarKey}
                    name={q.seller}
                    size={18}
                  />
                  {q.sellerUsername ? (
                    <a
                      href={`https://t.me/${q.sellerUsername}`}
                      target="_blank"
                      rel="noreferrer"
                      className="max-w-32 truncate hover:text-primary hover:underline"
                    >
                      {q.seller}
                    </a>
                  ) : (
                    <span className="max-w-32 truncate">{q.seller}</span>
                  )}
                </span>
              </td>
              <td className="px-2.5 py-1.5">
                <span className="flex items-center gap-1.5">
                  <Avatar
                    avatarKey={q.sourceAvatarKey}
                    name={q.sourceTitle}
                    size={18}
                  />
                  {q.sourceLink ? (
                    <a
                      href={q.sourceLink}
                      target="_blank"
                      rel="noreferrer"
                      className="max-w-40 truncate hover:text-primary hover:underline"
                    >
                      {q.sourceTitle}
                    </a>
                  ) : (
                    <span className="max-w-40 truncate">{q.sourceTitle}</span>
                  )}
                </span>
              </td>
              <td className="whitespace-nowrap px-2.5 py-1.5">
                {q.messageLink ? (
                  <a
                    href={q.messageLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    查看 ↗
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
      {sub && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
      )}
    </div>
  );
}

function GroupHeader({
  product,
  count,
  min,
  color,
}: {
  product: string;
  count: number;
  min: number | undefined;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="h-3.5 w-[3px] shrink-0 rounded-full"
          style={{ background: color }}
        />
        <span className="truncate text-sm font-semibold">{product}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {count} 条报价
        </span>
      </span>
      {min !== undefined && (
        <span className="shrink-0 text-xs font-semibold tabular-nums text-success">
          最低 ¥{min}
        </span>
      )}
    </div>
  );
}

const EXPANDED_GROUPS = 2; // 报价最多的前 N 个品类直接展开，其余折叠

export default async function ReportDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { date } = await params;
  const { scope = "global" } = await searchParams;

  const day = new Date(`${date}T00:00:00`);
  if (Number.isNaN(day.getTime())) notFound();

  const report = await prisma.report.findUnique({
    where: { date_scope: { date: day, scope } },
  });
  if (!report) notFound();

  const [prev, next] = await Promise.all([
    prisma.report.findFirst({
      where: { scope, date: { lt: day } },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    prisma.report.findFirst({
      where: { scope, date: { gt: day } },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
  ]);

  const stats = (report.stats as Stats) ?? {};
  const quotes = stats.quotes;
  const groups = quotes?.groups ?? [];
  const others = quotes?.others ?? [];
  const quoteTotal =
    groups.reduce((s, g) => s + g.items.length, 0) + others.length;

  const groupColor = (i: number) => CHART_COLORS[i % CHART_COLORS.length];
  const groupMin = (items: QuoteItem[]) =>
    items.find((it) => it.priceCNY !== null)?.priceCNY ?? undefined;

  const minPriceItems = groups
    .map((g) => ({ product: g.product, min: groupMin(g.items) }))
    .filter((x): x is { product: string; min: number } => x.min !== undefined)
    .slice(0, 6);

  const donutSegments = [
    ...groups.map((g, i) => ({
      label: g.product,
      count: g.items.length,
      color: groupColor(i),
    })),
    ...(others.length > 0
      ? [{ label: "其他/未比价", count: others.length, color: CHART_REST }]
      : []),
  ];

  const reportDate = new Date(report.date);
  const genTime = new Date(report.createdAt).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dayLink = (d: Date) =>
    `/reports/${ymd(d)}${scope !== "global" ? `?scope=${scope}` : ""}`;

  const summaryRowClass =
    "flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-border px-3.5 py-2.5 transition-colors hover:bg-muted/40 [&::-webkit-details-marker]:hidden";

  return (
    <div className="space-y-5">
      {/* 页头 */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/reports" className="hover:text-primary hover:underline">
            ← 报告列表
          </Link>
          <span>/</span>
          <span className="text-foreground">{date}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold">
              {reportDate.getMonth() + 1}月{reportDate.getDate()}日 日报
            </h1>
            <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              <span className="size-1.5 rounded-full bg-primary" />
              {scope === "global" ? "全局报告" : "来源报告"}
            </span>
            <span className="text-xs text-muted-foreground">
              生成于 {genTime}
              {report.model ? ` · 模型 ${report.model}` : ""}
            </span>
          </div>
          <div className="flex items-center overflow-hidden rounded-lg border border-border bg-card text-sm">
            {prev ? (
              <Link
                href={dayLink(prev.date)}
                className="px-2.5 py-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                ‹
              </Link>
            ) : (
              <span className="px-2.5 py-1.5 text-border">‹</span>
            )}
            <span className="px-1.5 text-xs font-medium tabular-nums">
              {date}
            </span>
            {next ? (
              <Link
                href={dayLink(next.date)}
                className="px-2.5 py-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                ›
              </Link>
            ) : (
              <span className="px-2.5 py-1.5 text-border">›</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
        {/* 左列：概览 + 图表 */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="消息数" value={stats.messageCount ?? 0} />
            <Kpi label="活跃源" value={stats.sourceCount ?? 0} />
            <Kpi
              label="报价条数"
              value={quoteTotal}
              sub={groups.length > 0 ? `覆盖 ${groups.length} 个品类` : undefined}
            />
            <Kpi
              label="未比价报价"
              value={others.length}
              sub="无法换算，原样列出"
            />
          </div>

          {minPriceItems.length > 0 && (
            <ChartCard
              title="品类最低价对比"
              sub="折合人民币最低报价，刀/U 按 ≈¥7.2 粗算"
            >
              <MinPriceChart items={minPriceItems} />
            </ChartCard>
          )}

          {donutSegments.length > 0 && (
            <ChartCard title="报价品类分布" sub="当日报价按品类占比">
              <QuoteDonut segments={donutSegments} />
            </ChartCard>
          )}

          {stats.topSources && stats.topSources.length > 0 && (
            <ChartCard title="活跃来源 Top" sub="按当日消息条数排序">
              <TopSourcesChart sources={stats.topSources.slice(0, 6)} />
            </ChartCard>
          )}
        </div>

        {/* 右列：报价行情 + AI 总结 */}
        <div className="min-w-0 space-y-5">
          {quotes && (groups.length > 0 || others.length > 0) && (
            <Card>
              <CardContent className="pt-4">
                <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold">💰 今日报价行情</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {quoteTotal} 条 · {groups.length} 品类
                  </span>
                  <span className="text-xs text-muted-foreground">
                    同品类按折合人民币升序，最便宜在前
                  </span>
                </div>
                <div className="space-y-4">
                  {groups.slice(0, EXPANDED_GROUPS).map((g, i) => (
                    <div key={g.product} className="space-y-1.5">
                      <GroupHeader
                        product={g.product}
                        count={g.items.length}
                        min={groupMin(g.items)}
                        color={groupColor(i)}
                      />
                      <QuoteTable items={g.items} />
                    </div>
                  ))}

                  {groups.slice(EXPANDED_GROUPS).map((g, j) => (
                    <details key={g.product} className="group">
                      <summary className={summaryRowClass}>
                        <span className="min-w-0 flex-1">
                          <GroupHeader
                            product={g.product}
                            count={g.items.length}
                            min={groupMin(g.items)}
                            color={groupColor(j + EXPANDED_GROUPS)}
                          />
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-180">
                          ▾
                        </span>
                      </summary>
                      <div className="mt-2">
                        <QuoteTable items={g.items} />
                      </div>
                    </details>
                  ))}

                  {others.length > 0 && (
                    <details className="group">
                      <summary className={summaryRowClass}>
                        <span className="text-sm text-muted-foreground">
                          未能换算比价的报价（原样列出）
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                          {others.length} 条
                          <span className="transition-transform group-open:rotate-180">
                            ▾
                          </span>
                        </span>
                      </summary>
                      <div className="mt-2">
                        <QuoteTable items={others} showProduct />
                      </div>
                    </details>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="prose-report pt-4">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">✨ AI 当日总结</span>
                    {report.model && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {report.model}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="group-open:hidden">展开阅读</span>
                    <span className="hidden group-open:inline">收起</span>
                    <span className="transition-transform group-open:rotate-180">
                      ▾
                    </span>
                  </span>
                </summary>
                <article className="markdown mt-3 space-y-3 border-t border-border pt-3 text-sm leading-relaxed">
                  <ReactMarkdown>{report.summaryMarkdown}</ReactMarkdown>
                </article>
              </details>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
