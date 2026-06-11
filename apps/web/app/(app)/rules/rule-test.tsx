"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  testRuleText,
  backtestRecentMessages,
  backfillHistory,
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
        const r = await backfillHistory(50);
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
        <Button
          variant="outline"
          onClick={runBackfill}
          disabled={backfilling}
          title="把各监控源最近 50 条历史消息走完整入库管线，命中规则的会出现在消息流"
        >
          {backfilling ? "回填中…" : "回填历史消息"}
        </Button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
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
