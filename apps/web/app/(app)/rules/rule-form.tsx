"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createRule, polishRuleKeyword } from "./actions";

interface SourceOption {
  id: string;
  title: string;
}

export function RuleForm({ sources }: { sources: SourceOption[] }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [matchType, setMatchType] = useState<"PARTIAL" | "EXACT" | "REGEX">(
    "PARTIAL",
  );
  const [scopeMode, setScopeMode] = useState<"ALL" | "SELECTED">("ALL");
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [mediaOnly, setMediaOnly] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polishing, startPolish] = useTransition();

  function toggleSource(id: string) {
    setSourceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  /** AI 根据主题名称生成/优化关键词组合 */
  function polishKeyword() {
    if (!name.trim()) {
      setError("先填写规则名称（监控主题），AI 才知道要捕获什么");
      return;
    }
    setError(null);
    startPolish(async () => {
      try {
        const suggestion = await polishRuleKeyword({
          name: name.trim(),
          keyword: keyword.trim() || undefined,
        });
        setKeyword(suggestion);
        if (matchType === "REGEX") setMatchType("PARTIAL");
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function submit() {
    if (!name.trim()) {
      setError("请填写规则名称");
      return;
    }
    if (scopeMode === "SELECTED" && sourceIds.length === 0) {
      setError("请至少勾选一个频道/对话，或改为全选");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await createRule({
          name: name.trim(),
          keyword: keyword.trim() || undefined,
          matchType,
          caseSensitive,
          scopeMode,
          sourceIds,
          mediaOnly,
        });
        setName("");
        setKeyword("");
        setMediaOnly(false);
        setScopeMode("ALL");
        setSourceIds([]);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="text-sm font-semibold">新建规则 / 主题</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">名称</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：空投、融资新闻"
          />
        </label>
        <label className="space-y-1">
          <span className="flex items-center justify-between text-xs text-muted-foreground">
            <span>关键词（| 分隔多组，+ 组合必须同时出现；留空 = 全部消息）</span>
            <button
              type="button"
              onClick={polishKeyword}
              disabled={polishing}
              className="shrink-0 text-primary hover:underline disabled:opacity-50"
            >
              {polishing ? "生成中…" : "✨ AI 润色"}
            </button>
          </span>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="如：gemini+拼车|出kiro|卡网"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">匹配方式</span>
          <select
            value={matchType}
            onChange={(e) =>
              setMatchType(e.target.value as "PARTIAL" | "EXACT" | "REGEX")
            }
            className="h-9 w-full rounded-md border border-border bg-muted px-2 text-sm"
          >
            <option value="PARTIAL">模糊包含</option>
            <option value="EXACT">精确</option>
            <option value="REGEX">正则</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">作用范围</span>
          <select
            value={scopeMode}
            onChange={(e) =>
              setScopeMode(e.target.value as "ALL" | "SELECTED")
            }
            className="h-9 w-full rounded-md border border-border bg-muted px-2 text-sm"
          >
            <option value="ALL">全部启用源</option>
            <option value="SELECTED">指定频道 / 对话（多选）</option>
          </select>
        </label>
      </div>

      {/* 多选频道/对话列表（仅 SELECTED 时显示）*/}
      {scopeMode === "SELECTED" ? (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              勾选要应用此规则的频道 / 对话（已选 {sourceIds.length}）
            </span>
            <button
              type="button"
              onClick={() =>
                setSourceIds(
                  sourceIds.length === sources.length
                    ? []
                    : sources.map((s) => s.id),
                )
              }
              className="text-xs text-primary hover:underline"
            >
              {sourceIds.length === sources.length ? "全不选" : "全选"}
            </button>
          </div>
          {sources.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              还没有监控源，先去「监控源」页添加。
            </p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {sources.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={sourceIds.includes(s.id)}
                    onChange={() => toggleSource(s.id)}
                  />
                  <span className="truncate">{s.title}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={mediaOnly}
            onChange={(e) => setMediaOnly(e.target.checked)}
          />
          仅带媒体
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          区分大小写
        </label>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <Button onClick={submit} disabled={pending}>
        {pending ? "保存中…" : "添加规则"}
      </Button>
    </div>
  );
}
