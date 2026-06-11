"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@tgdog/db";
import type { MatchType, ScopeMode } from "@tgdog/db";
import { matchesKeyword } from "@tgdog/core";
import { loadAiConfig, complete } from "@/lib/ai";
import { collector } from "@/lib/collector";

export interface RuleInput {
  name: string;
  keyword?: string;
  matchType: MatchType;
  caseSensitive: boolean;
  scopeMode: ScopeMode;
  sourceIds: string[]; // scopeMode=SELECTED 时生效
  mediaOnly: boolean;
  senderFilter?: { mode: "whitelist" | "blacklist"; ids: string[] } | null;
}

export async function createRule(input: RuleInput) {
  await prisma.rule.create({
    data: {
      name: input.name,
      keyword: input.keyword || null,
      matchType: input.matchType,
      caseSensitive: input.caseSensitive,
      scopeMode: input.scopeMode,
      sources:
        input.scopeMode === "SELECTED" && input.sourceIds.length > 0
          ? { connect: input.sourceIds.map((id) => ({ id })) }
          : undefined,
      mediaOnly: input.mediaOnly,
      senderFilter: input.senderFilter ?? undefined,
      enabled: true,
    },
  });
  revalidatePath("/rules");
}

/** 更新规则（senderFilter 暂无编辑入口，保持原值不动） */
export async function updateRule(id: string, input: RuleInput) {
  await prisma.rule.update({
    where: { id },
    data: {
      name: input.name,
      keyword: input.keyword || null,
      matchType: input.matchType,
      caseSensitive: input.caseSensitive,
      scopeMode: input.scopeMode,
      mediaOnly: input.mediaOnly,
      sources: {
        set:
          input.scopeMode === "SELECTED"
            ? input.sourceIds.map((sid) => ({ id: sid }))
            : [],
      },
    },
  });
  revalidatePath("/rules");
}

export async function toggleRule(id: string, enabled: boolean) {
  await prisma.rule.update({ where: { id }, data: { enabled } });
  revalidatePath("/rules");
}

export async function deleteRule(id: string) {
  await prisma.rule.delete({ where: { id } });
  revalidatePath("/rules");
}

const KEYWORD_SYSTEM = `你是 Telegram 监控规则专家。监控目标是群/频道里的资源交易类消息（如「gemini 12个月 xx钱」「出kiro 25块」「联系卡网」）。
关键词语法：
- 用 | 分隔多组词，任意一组命中即算命中（OR）
- 组内用 + 连接多个词，要求同时出现（AND）
- 例：gemini+拼车|出kiro|卡网

用户会给你规则主题和（可选的）现有关键词。请生成一组能准确捕获该主题消息的关键词组合：
- 覆盖常见说法、同义词、简写（中英文都要考虑）
- 避免过于宽泛导致误报的单字词
- 控制在 12 组以内
只输出关键词组合本身（一行，| 分隔），不要任何解释。`;

/** AI 润色：根据规则主题生成/优化关键词组合 */
export async function polishRuleKeyword(input: {
  name: string;
  keyword?: string;
}): Promise<string> {
  const cfg = await loadAiConfig();
  if (!cfg) throw new Error("AI 未配置，请先在「设置」页填写 AI 接口");
  if (!input.name.trim()) throw new Error("请先填写规则名称（监控主题）");

  const user = [
    `规则主题：${input.name.trim()}`,
    input.keyword?.trim() ? `现有关键词：${input.keyword.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const suggestion = (await complete(cfg, KEYWORD_SYSTEM, user)).trim();
  if (!suggestion) throw new Error("AI 返回为空，请稍后重试");
  // 防止 AI 包了引号/代码块
  return suggestion.replace(/^[`"'\s]+|[`"'\s]+$/g, "");
}

const OPTIMIZE_SYSTEM = `你是 Telegram 监控规则专家。监控目标是群/频道里的资源交易类消息（如「gemini 12个月 xx钱」「出kiro 25块」「联系卡网」）。
关键词语法：
- 用 | 分隔多组词，任意一组命中即算命中（OR）
- 组内用 + 连接多个词，要求同时出现（AND）
- 例：gemini+拼车|出kiro|卡网

用户会给你：规则主题、现有关键词、一批已命中该规则的消息样本、一批最近采集但未命中的消息样本。
请基于这些真实消息优化关键词组合，目标是命中更多与主题相关的消息：
- 从未命中样本里找出与主题相关但被漏掉的说法、同义词、简写（中英文都要考虑），补进关键词
- 保留现有关键词中仍然有效的组
- 避免过于宽泛导致误报的单字词，与主题无关的消息不要为了命中而加词
- 控制在 12 组以内
只输出关键词组合本身（一行，| 分隔），不要任何解释。`;

export interface OptimizeRuleResult {
  suggestion: string;
  hitSampleCount: number;
  missSampleCount: number;
}

/** AI 优化：根据已采集的消息（命中样本 + 未命中样本）重新抽取关键词，返回建议（不直接落库） */
export async function optimizeRuleFromMessages(
  ruleId: string,
): Promise<OptimizeRuleResult> {
  const [cfg, rule] = await Promise.all([
    loadAiConfig(),
    prisma.rule.findUnique({
      where: { id: ruleId },
      include: { sources: { select: { id: true } } },
    }),
  ]);
  if (!cfg) throw new Error("AI 未配置，请先在「设置」页填写 AI 接口");
  if (!rule) throw new Error("规则不存在");

  // SELECTED 时只取该规则作用范围内的消息作为语料
  const scopeFilter =
    rule.scopeMode === "SELECTED" && rule.sources.length > 0
      ? { sourceId: { in: rule.sources.map((s) => s.id) } }
      : {};

  const [hits, misses] = await Promise.all([
    prisma.message.findMany({
      where: { ...scopeFilter, text: { not: "" }, ruleHits: { some: { ruleId } } },
      orderBy: { timestamp: "desc" },
      take: 20,
      select: { text: true },
    }),
    prisma.message.findMany({
      where: { ...scopeFilter, text: { not: "" }, ruleHits: { none: { ruleId } } },
      orderBy: { timestamp: "desc" },
      take: 100,
      select: { text: true },
    }),
  ]);
  if (hits.length + misses.length === 0)
    throw new Error("还没有采集到消息，无法基于消息优化，可先用「历史回填」拉取历史消息");

  const clip = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 180);
  const list = (ms: { text: string }[]) =>
    ms.map((m) => `- ${clip(m.text)}`).join("\n");

  const user = [
    `规则主题：${rule.name}`,
    rule.keyword ? `现有关键词：${rule.keyword}` : "现有关键词：（无）",
    hits.length
      ? `\n已命中该规则的消息样本（${hits.length} 条）：\n${list(hits)}`
      : "",
    misses.length
      ? `\n最近采集但未命中的消息样本（${misses.length} 条，从中找漏掉的相关说法）：\n${list(misses)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const suggestion = (await complete(cfg, OPTIMIZE_SYSTEM, user))
    .trim()
    // 防止 AI 包了引号/代码块
    .replace(/^[`"'\s]+|[`"'\s]+$/g, "");
  if (!suggestion) throw new Error("AI 返回为空，请稍后重试");
  return {
    suggestion,
    hitSampleCount: hits.length,
    missSampleCount: misses.length,
  };
}

/** 应用 AI 优化建议：只更新关键词，其余字段不动 */
export async function applyRuleKeyword(id: string, keyword: string) {
  const kw = keyword.trim();
  if (!kw) throw new Error("关键词不能为空");
  await prisma.rule.update({ where: { id }, data: { keyword: kw } });
  revalidatePath("/rules");
}

export interface RuleTestResult {
  ruleId: string;
  name: string;
  keyword: string | null;
  matched: boolean;
}

/**
 * 规则命中测试：把一段示例文本对所有启用规则跑关键词匹配。
 * 只测关键词（发送人/媒体/作用域过滤与具体消息上下文相关，此处不参与）。
 */
export async function testRuleText(text: string): Promise<RuleTestResult[]> {
  const sample = text.trim();
  if (!sample) throw new Error("请输入要测试的消息文本");
  const rules = await prisma.rule.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "desc" },
  });
  return rules.map((r) => ({
    ruleId: r.id,
    name: r.name,
    keyword: r.keyword,
    matched: matchesKeyword(
      {
        id: r.id,
        keyword: r.keyword,
        matchType: r.matchType,
        caseSensitive: r.caseSensitive,
        senderFilter: null,
        mediaOnly: false,
        scopeMode: "ALL",
        sourceIds: [],
      },
      sample,
    ),
  }));
}

export interface BacktestSource {
  tgChatId: string;
  username: string | null;
  fetched: number;
  chatIdMismatch: string | null;
  hits: {
    tgMessageId: string;
    ruleIds: string[];
    text: string;
    date: string | null;
  }[];
  error?: string;
}

/** 用各监控源最近历史消息回测规则（走 collector 在线客户端，不入库） */
export async function backtestRecentMessages(limit = 50): Promise<{
  rules: { id: string; keyword: string | null }[];
  sources: BacktestSource[];
}> {
  const account = await prisma.account.findFirst({
    where: { status: "ACTIVE", sessionEnc: { not: null } },
  });
  if (!account) throw new Error("没有已连接的账号，请先在「账号」页登录");
  return collector.backtest(account.id, limit);
}

/** 历史回填：把各监控源最近历史消息走完整入库管线（命中规则才入库） */
export async function backfillHistory(limit = 50): Promise<{
  scanned: number;
  saved: number;
  errors: string[];
}> {
  const account = await prisma.account.findFirst({
    where: { status: "ACTIVE", sessionEnc: { not: null } },
  });
  if (!account) throw new Error("没有已连接的账号，请先在「账号」页登录");
  const result = await collector.backfill(account.id, limit);
  revalidatePath("/");
  return result;
}
