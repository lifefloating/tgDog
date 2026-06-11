/** 报告详情页的纯展示图表（服务端渲染，无依赖） */

export const CHART_COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#f43f5e",
  "#8b5cf6",
];
export const CHART_REST = "#c3c9d6";

export function ChartCard({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <div className="text-sm font-semibold">{title}</div>
        {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

/** 品类最低价对比：横向条形图 */
export function MinPriceChart({
  items,
}: {
  items: { product: string; min: number }[];
}) {
  const max = Math.max(...items.map((i) => i.min));
  const cheapest = Math.min(...items.map((i) => i.min));
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div key={it.product} className="flex items-center gap-2">
          <span className="w-[128px] shrink-0 truncate text-xs text-muted-foreground">
            {it.product}
          </span>
          <span className="h-[16px] flex-1 overflow-hidden rounded bg-muted">
            <span
              className="block h-full rounded-l"
              style={{
                width: `${Math.max(6, (it.min / max) * 100)}%`,
                background: it.min === cheapest ? "#10b981" : "#2563eb",
              }}
            />
          </span>
          <span className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums">
            ¥{it.min}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 报价品类分布：SVG 环形图 + 图例 */
export function QuoteDonut({
  segments,
}: {
  segments: { label: string; count: number; color: string }[];
}) {
  const total = segments.reduce((s, x) => s + x.count, 0);
  const R = 48;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <div className="relative size-[132px] shrink-0">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90">
          {segments.map((s) => {
            const len = (s.count / total) * C;
            const el = (
              <circle
                key={s.label}
                cx="60"
                cy="60"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth="14"
                strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${C}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold tabular-nums">{total}</span>
          <span className="text-[10px] text-muted-foreground">条报价</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-xs">
            <span
              className="size-2 shrink-0 rounded-[3px]"
              style={{ background: s.color }}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {s.label}
            </span>
            <span className="font-semibold tabular-nums">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 活跃来源 Top：排名 + 细进度条 */
export function TopSourcesChart({
  sources,
}: {
  sources: { title: string; count: number }[];
}) {
  const max = Math.max(...sources.map((s) => s.count));
  return (
    <div className="space-y-3">
      {sources.map((s, i) => (
        <div key={s.title} className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={`flex size-[18px] shrink-0 items-center justify-center rounded text-[10px] font-bold tabular-nums ${
                i < 3 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {s.title}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {s.count} 条
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-sky-500"
              style={{ width: `${Math.max(4, (s.count / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
