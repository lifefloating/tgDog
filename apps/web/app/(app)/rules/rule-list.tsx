"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  applyRuleKeyword,
  deleteRule,
  optimizeRuleFromMessages,
  toggleRule,
  updateRule,
} from "./actions";

interface SourceOption {
  id: string;
  title: string;
}

interface RuleItem {
  id: string;
  name: string;
  keyword: string | null;
  matchType: string;
  enabled: boolean;
  mediaOnly: boolean;
  caseSensitive: boolean;
  scopeMode: string;
  sourceIds: string[];
  sourceTitles: string[];
  hitCount: number;
}

const matchLabel: Record<string, string> = {
  PARTIAL: "模糊",
  EXACT: "精确",
  REGEX: "正则",
};

function scopeText(scopeMode: string, titles: string[]): string {
  if (scopeMode === "ALL") return "全部源";
  if (titles.length === 0) return "未选源";
  if (titles.length <= 2) return titles.join("、");
  return `${titles.slice(0, 2).join("、")} 等 ${titles.length} 个`;
}

/** 单条规则的内联编辑表单 */
function RuleEditForm({
  rule,
  sources,
  onClose,
}: {
  rule: RuleItem;
  sources: SourceOption[];
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(rule.name);
  const [keyword, setKeyword] = useState(rule.keyword ?? "");
  const [matchType, setMatchType] = useState<"PARTIAL" | "EXACT" | "REGEX">(
    (rule.matchType as "PARTIAL" | "EXACT" | "REGEX") ?? "PARTIAL",
  );
  const [scopeMode, setScopeMode] = useState<"ALL" | "SELECTED">(
    (rule.scopeMode as "ALL" | "SELECTED") ?? "ALL",
  );
  const [sourceIds, setSourceIds] = useState<string[]>(rule.sourceIds);
  const [mediaOnly, setMediaOnly] = useState(rule.mediaOnly);
  const [caseSensitive, setCaseSensitive] = useState(rule.caseSensitive);
  const [error, setError] = useState<string | null>(null);

  function toggleSource(id: string) {
    setSourceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function save() {
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
        await updateRule(rule.id, {
          name: name.trim(),
          keyword: keyword.trim() || undefined,
          matchType,
          caseSensitive,
          scopeMode,
          sourceIds,
          mediaOnly,
        });
        onClose();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">名称</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">
            关键词（英文 | 分隔多组，+ 组合必须同时出现；留空 = 全部消息）
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
            onChange={(e) => setScopeMode(e.target.value as "ALL" | "SELECTED")}
            className="h-9 w-full rounded-md border border-border bg-muted px-2 text-sm"
          >
            <option value="ALL">全部启用源</option>
            <option value="SELECTED">指定频道 / 对话（多选）</option>
          </select>
        </label>
      </div>

      {scopeMode === "SELECTED" ? (
        <div className="space-y-1.5 rounded-lg border border-border bg-card p-3">
          <span className="text-xs text-muted-foreground">
            勾选要应用此规则的频道 / 对话（已选 {sourceIds.length}）
          </span>
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
      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          取消
        </Button>
      </div>
    </div>
  );
}

/** AI 优化建议面板：展示根据已采集消息抽取的新关键词，确认后才写库 */
function RuleAiSuggestion({
  rule,
  suggestion,
  hitSampleCount,
  missSampleCount,
  onClose,
}: {
  rule: RuleItem;
  suggestion: string;
  hitSampleCount: number;
  missSampleCount: number;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function apply() {
    setError(null);
    startTransition(async () => {
      try {
        await applyRuleKeyword(rule.id, suggestion);
        onClose();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">
        AI 基于已采集消息（{hitSampleCount} 条命中 + {missSampleCount}{" "}
        条未命中样本）建议的关键词：
      </p>
      <p className="break-all rounded bg-card px-2 py-1.5 font-mono text-xs">
        {suggestion}
      </p>
      <p className="break-all text-xs text-muted-foreground">
        当前关键词：{rule.keyword || "（无）"}
      </p>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={apply} disabled={pending}>
          {pending ? "应用中…" : "应用"}
        </Button>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          取消
        </Button>
      </div>
    </div>
  );
}

export function RuleList({
  rules,
  sources,
}: {
  rules: RuleItem[];
  sources: SourceOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [aiPending, startAiTransition] = useTransition();
  const [aiTargetId, setAiTargetId] = useState<string | null>(null);
  const [aiError, setAiError] = useState<{
    ruleId: string;
    message: string;
  } | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<{
    ruleId: string;
    suggestion: string;
    hitSampleCount: number;
    missSampleCount: number;
  } | null>(null);

  function optimize(ruleId: string) {
    setAiTargetId(ruleId);
    setAiError(null);
    setAiSuggestion(null);
    startAiTransition(async () => {
      try {
        const res = await optimizeRuleFromMessages(ruleId);
        setAiSuggestion({ ruleId, ...res });
      } catch (e) {
        setAiError({ ruleId, message: (e as Error).message });
      } finally {
        setAiTargetId(null);
      }
    });
  }

  if (rules.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        还没有规则。添加一个开始采集。
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rules.map((r) => (
        <div
          key={r.id}
          className="rounded-lg border border-border bg-card px-4 py-2.5"
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{r.name}</span>
                <Badge>{matchLabel[r.matchType] ?? r.matchType}</Badge>
                {r.mediaOnly ? <Badge>媒体</Badge> : null}
                <Badge>{scopeText(r.scopeMode, r.sourceTitles)}</Badge>
                {r.hitCount > 0 ? (
                  <Link href={`/?ruleId=${r.id}`}>
                    <Badge className="border-success/40 text-success hover:bg-success/10">
                      命中 {r.hitCount} 条
                    </Badge>
                  </Link>
                ) : (
                  <Badge>未命中</Badge>
                )}
              </div>
              {r.keyword && (
                <div className="truncate text-xs text-muted-foreground">
                  关键词：{r.keyword}
                </div>
              )}
            </div>
            <button
              disabled={pending}
              onClick={() =>
                setEditingId(editingId === r.id ? null : r.id)
              }
              className="text-xs text-primary hover:underline"
            >
              {editingId === r.id ? "收起" : "编辑"}
            </button>
            <button
              disabled={pending || aiPending}
              onClick={() => optimize(r.id)}
              className="text-xs text-primary hover:underline disabled:opacity-50"
              title="用 AI 根据已采集消息优化关键词"
            >
              {aiPending && aiTargetId === r.id ? "优化中…" : "AI优化"}
            </button>
            <button
              disabled={pending}
              onClick={() =>
                startTransition(() =>
                  toggleRule(r.id, !r.enabled).then(() => {}),
                )
              }
              className={`rounded-md px-2 py-1 text-xs ${
                r.enabled
                  ? "bg-success/20 text-success"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {r.enabled ? "启用中" : "已停用"}
            </button>
            <button
              disabled={pending}
              onClick={() =>
                startTransition(() => deleteRule(r.id).then(() => {}))
              }
              className="text-xs text-danger hover:underline"
            >
              删除
            </button>
          </div>
          {editingId === r.id && (
            <RuleEditForm
              rule={r}
              sources={sources}
              onClose={() => setEditingId(null)}
            />
          )}
          {aiError?.ruleId === r.id && (
            <p className="mt-1.5 text-xs text-danger">{aiError.message}</p>
          )}
          {aiSuggestion?.ruleId === r.id && (
            <RuleAiSuggestion
              rule={r}
              suggestion={aiSuggestion.suggestion}
              hitSampleCount={aiSuggestion.hitSampleCount}
              missSampleCount={aiSuggestion.missSampleCount}
              onClose={() => setAiSuggestion(null)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
