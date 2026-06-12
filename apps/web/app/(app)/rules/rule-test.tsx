"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  testRuleText,
  backtestRecentMessages,
  backfillHistory,
  exportRulesData,
  type RuleTestResult,
  type BacktestSource,
} from "./actions";

/** 回测命中时间格式（模块级复用，避免每条记录新建格式化器） */
const hitTimeFmt = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** 触发浏览器下载一个文本文件 */
function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 文件名用的本地日期戳，如 20260612 */
function dateStamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 内联转圈图标，用于回填等长耗时操作的进行态 */
function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

/** 规则命中测试：示例文本即时测试 + 用各源最近消息回测 */
export function RuleTest() {
  const [text, setText] = useState("");
  const [results, setResults] = useState<RuleTestResult[] | null>(null);
  const [backtest, setBacktest] = useState<BacktestSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, startTest] = useTransition();
  const [backtesting, startBacktest] = useTransition();
  const [backfilling, startBackfill] = useTransition();
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [backfillLimit, setBackfillLimit] = useState(200);
  const [backfillElapsed, setBackfillElapsed] = useState(0);
  const backfillTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [exporting, startExport] = useTransition();

  // 回填进行中每秒推进一次已用时计数；结束/卸载时清掉定时器
  useEffect(() => {
    if (backfilling) {
      setBackfillElapsed(0);
      const startedAt = Date.now();
      backfillTimer.current = setInterval(() => {
        setBackfillElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    } else if (backfillTimer.current) {
      clearInterval(backfillTimer.current);
      backfillTimer.current = null;
    }
    return () => {
      if (backfillTimer.current) {
        clearInterval(backfillTimer.current);
        backfillTimer.current = null;
      }
    };
  }, [backfilling]);

  function runTest() {
    setError(null);
    startTest(async () => {
      try {
        setResults(await testRuleText(text));
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function runBacktest() {
    setError(null);
    startBacktest(async () => {
      try {
        const data = await backtestRecentMessages(50);
        setBacktest(data.sources);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function runBackfill() {
    setError(null);
    setBackfillResult(null);
    startBackfill(async () => {
      try {
        const r = await backfillHistory(backfillLimit);
        setBackfillResult(
          `扫描 ${r.scanned} 条，入库 ${r.saved} 条` +
            (r.errors.length ? `（${r.errors.length} 个源拉取失败）` : "") +
            "。去「消息流」页查看。",
        );
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  /** 下载全部规则关键词：fmt=txt 人读，fmt=json 可备份/复用 */
  function runExport(fmt: "txt" | "json") {
    setError(null);
    startExport(async () => {
      try {
        const rules = await exportRulesData();
        if (rules.length === 0) {
          setError("还没有任何规则可导出");
          return;
        }
        if (fmt === "json") {
          downloadText(
            `规则关键词-${dateStamp()}.json`,
            JSON.stringify(rules, null, 2),
            "application/json",
          );
        } else {
          const body = rules
            .map((r) => `${r.name}: ${r.keyword ?? "（无关键词）"}`)
            .join("\n");
          downloadText(
            `规则关键词-${dateStamp()}.txt`,
            body + "\n",
            "text/plain;charset=utf-8",
          );
        }
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  const matchedCount = results?.filter((r) => r.matched).length ?? 0;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="text-sm font-semibold">规则命中测试</div>

      <label className="space-y-1">
        <span className="text-xs text-muted-foreground">
          粘贴一条消息文本，测试会命中哪些启用中的规则（只测关键词，不含发送人/媒体/范围过滤）
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="如：出kiro pro 80一个。有谷歌账密。"
          className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm"
        />
      </label>

      <div className="flex items-center gap-2">
        <Button onClick={runTest} disabled={testing || !text.trim()}>
          {testing ? "测试中…" : "测试匹配"}
        </Button>
        <Button
          variant="outline"
          onClick={runBacktest}
          disabled={backtesting}
          title="拉取各监控源最近 50 条消息跑一遍规则（不入库）"
        >
          {backtesting ? "回测中…" : "用最近消息回测"}
        </Button>
        <select
          value={backfillLimit}
          onChange={(e) => setBackfillLimit(Number(e.target.value))}
          disabled={backfilling}
          title="每个源回填多少条历史消息（GramJS 自动翻页，条数越大耗时越长）"
          className="rounded-md border border-border bg-muted px-2 py-1.5 text-sm"
        >
          <option value={50}>50 条/源</option>
          <option value={200}>200 条/源</option>
          <option value={500}>500 条/源</option>
          <option value={1000}>1000 条/源</option>
        </select>
        <Button
          variant="outline"
          onClick={runBackfill}
          disabled={backfilling}
          title="把各监控源最近 N 条历史消息走完整入库管线，命中规则的会出现在消息流"
        >
          {backfilling ? (
            <span className="flex items-center gap-1.5">
              <Spinner />
              回填中 {backfillElapsed}s…
            </span>
          ) : (
            "回填历史消息"
          )}
        </Button>
        <Button
          variant="outline"
          onClick={() => runExport("txt")}
          disabled={exporting}
          title="下载全部规则的「名称: 关键词」文本，方便查阅"
        >
          下载关键词 .txt
        </Button>
        <Button
          variant="outline"
          onClick={() => runExport("json")}
          disabled={exporting}
          title="下载全部规则的完整数据（含匹配类型等），用于备份 / 复用"
        >
          .json
        </Button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
      {backfilling && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
          <Spinner className="mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <div className="font-medium text-foreground">
              正在回填历史（每源 {backfillLimit} 条）· 已用 {backfillElapsed}s
            </div>
            <div className="text-muted-foreground">
              逐源拉取，源越多 / 条数越大耗时越长，期间请勿关闭或刷新本页。
              回填在服务端进行，完成后这里会显示结果。
            </div>
          </div>
        </div>
      )}
      {backfillResult && (
        <p className="text-xs text-muted-foreground">{backfillResult}</p>
      )}

      {results && (
        <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3">
          <div className="text-xs text-muted-foreground">
            命中 {matchedCount} / {results.length} 条规则
          </div>
          {results.length === 0 ? (
            <p className="text-xs text-muted-foreground">没有启用中的规则。</p>
          ) : (
            results.map((r) => (
              <div key={r.ruleId} className="flex items-center gap-2 text-sm">
                <span>{r.matched ? "✅" : "—"}</span>
                <span className={r.matched ? "" : "text-muted-foreground"}>
                  {r.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {r.keyword ?? "（无关键词 = 全部消息）"}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {backtest && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <div className="text-xs text-muted-foreground">
            各源最近消息回测（共命中{" "}
            {backtest.reduce((n, s) => n + s.hits.length, 0)} 条）
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {backtest.map((s) => (
              <div key={s.tgChatId} className="text-xs">
                <div className="font-medium">
                  {s.username ? `@${s.username}` : s.tgChatId}
                  <span className="ml-2 text-muted-foreground">
                    {s.error
                      ? `拉取失败：${s.error.split("\n")[0]}`
                      : `${s.fetched} 条里命中 ${s.hits.length}`}
                  </span>
                </div>
                {s.hits.slice(0, 5).map((h) => (
                  <div
                    key={h.tgMessageId}
                    className="ml-3 truncate text-muted-foreground"
                  >
                    {h.date ? `${hitTimeFmt.format(new Date(h.date))} ` : ""}
                    {h.text}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
